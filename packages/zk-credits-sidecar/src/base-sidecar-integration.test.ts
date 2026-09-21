/**
 * Coding-agent sidecar fixture.
 *
 * Drives the real loopback sidecar and the real prepaid client through a real
 * HTTP exchange against a resource server that runs the package facilitator:
 * 402 challenge -> payment selection -> local proof -> PAYMENT-SIGNATURE ->
 * reserve/commit settlement -> PAYMENT-RESPONSE.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildPaymentRequired,
  buildPaymentRequirements,
  createZkPrepaidFacilitator,
  createZkPrepaidLifecycleMetrics,
  decodeHeader,
  encodeHeader,
  InMemoryClaimStore,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  validateZkPrepaidPayload,
  type PaymentPayload,
  type PaymentRequirements,
  type SettlementResponse,
} from '@zk-credits/x402-zk-prepaid';
import {
  computeCreditLeaf,
  createCredential,
  deriveRequestSignal,
  deriveSparseCreditWitness,
  generateSecret,
  poseidonHash,
} from '@zk-credits/shared/base';
import { createBasePrepaidClient, createFileWitnessProvider } from './base-sidecar.js';
import { parseCircuitManifest } from './artifact-bundle.js';
import { createPinnedBaseProofGenerator, PUBLIC_SIGNAL_COUNT } from './proof-coordinator.js';
import type { ProofWorkerRequest, ProofWorkerResult } from './proof-child.js';
import { createBaseProofMetrics } from './proof-metrics.js';
import { createSidecarServer } from './sidecar.js';
import { BaseSlotLedger } from './slot-ledger.js';

const FIELD_ORDER = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const OTHER_RAIL = 'exact';
const temporaryDirectories: string[] = [];
const runningServers: Server[] = [];

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  })));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function listen(server: Server): Promise<string> {
  runningServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function requirements(issuedAt: number): PaymentRequirements {
  return buildPaymentRequirements({
    payTo: '0x00000000000000000000000000000000000000b2',
    contract: '0x00000000000000000000000000000000000000a1',
    deploymentDomain: '84532',
    circuitId: 'private-credit-spend-bn254-dev',
    verifyingKeyId: 'private-credit-spend-vk-dev',
    issuedAt,
  });
}

/** The gateway hashes the request signal with SHA-256 before it reaches the claim store. */
function signalHash(payment: PaymentPayload): string {
  return createHash('sha256').update(payment.payload.publicSignals[3] ?? '').digest('hex');
}

/** A resource server that runs the real facilitator lifecycle over real HTTP. */
async function startResourceServer(options: { providerResponse: string; reorderAcceptances?: boolean }) {
  const clock = Date.now();
  const paymentRequirements = requirements(Math.floor(clock / 1000));
  const claimStore = new InMemoryClaimStore();
  const facilitator = createZkPrepaidFacilitator({ claimStore, hashSignal: signalHash });
  const seenBodies: string[] = [];
  const payments: PaymentPayload[] = [];
  let settleCalls = 0;

  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || !req.url?.startsWith('/v1/chat/completions')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"not_found"}');
      return;
    }
    const url = `http://${req.headers.host}${req.url}`;
    const body = await readBody(req).catch(() => '');
    const paymentHeader = req.headers[PAYMENT_SIGNATURE_HEADER.toLowerCase()];
    if (typeof paymentHeader !== 'string') {
      const challenge = buildPaymentRequired(url, paymentRequirements);
      if (options.reorderAcceptances) {
        challenge.accepts = [structuredClone(paymentRequirements), structuredClone(paymentRequirements)]
          .map((acceptance, index) => (index === 0 ? { ...acceptance, scheme: OTHER_RAIL } : acceptance)) as PaymentRequirements[];
      }
      res.writeHead(402, { 'Content-Type': 'application/json', [PAYMENT_REQUIRED_HEADER]: encodeHeader(challenge) });
      res.end('{"error":"payment_required"}');
      return;
    }
    const payment = decodeHeader<PaymentPayload>(paymentHeader);
    payments.push(payment);
    const signal = (await deriveRequestSignal({
      method: 'POST',
      url,
      body: new TextEncoder().encode(body),
      requirements: paymentRequirements,
      nonce: payment.payload.nonce,
      responseKey: payment.payload.responseKey,
    })).field;
    const verified = await validateZkPrepaidPayload(payment, paymentRequirements, signal);
    if (!verified.isValid) {
      res.writeHead(402, { 'Content-Type': 'application/json', [PAYMENT_REQUIRED_HEADER]: encodeHeader(buildPaymentRequired(url, paymentRequirements, verified.invalidReason)) });
      res.end('{"error":"payment_required"}');
      return;
    }
    const settled: SettlementResponse = await facilitator.settle(payment, paymentRequirements);
    if (!settled.success) {
      res.writeHead(402, { 'Content-Type': 'application/json', [PAYMENT_REQUIRED_HEADER]: encodeHeader(buildPaymentRequired(url, paymentRequirements, settled.errorReason)) });
      res.end('{"error":"payment_required"}');
      return;
    }
    const committed = await facilitator.commit(settled.reservationId!);
    if (!committed.success) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end('{"error":"settlement_failed"}');
      return;
    }
    settleCalls += 1;
    seenBodies.push(body);
    res.writeHead(200, { 'Content-Type': 'application/json', [PAYMENT_RESPONSE_HEADER]: encodeHeader(settled) });
    res.end(options.providerResponse);
  });
  const baseUrl = await listen(server);
  return {
    baseUrl,
    claimStore,
    facilitator,
    seenBodies,
    payments,
    settleCalls: () => settleCalls,
    requirements: paymentRequirements,
  };
}

/** A tiny artifact bundle whose manifest hashes match its bytes. */
async function fixtureArtifactDirectory(): Promise<{ directory: string; manifest: ReturnType<typeof parseCircuitManifest> }> {
  const directory = await mkdtemp(join(tmpdir(), 'zk-credits-fixture-artifacts-'));
  temporaryDirectories.push(directory);
  const files = {
    'private_credit_spend.wasm': 'fixture-wasm',
    'private_credit_spend.zkey': 'fixture-zkey',
    'verification_key_private_credit.json': JSON.stringify({ protocol: 'groth16', curve: 'bn128', nPublic: PUBLIC_SIGNAL_COUNT }),
  };
  await Promise.all(Object.entries(files).map(([file, content]) => writeFile(join(directory, file), content)));
  const manifest = parseCircuitManifest({
    version: 1,
    scheme: 'zk-prepaid',
    network: 'eip155:84532',
    circuit: {
      id: 'private-credit-spend-bn254-dev',
      depth: 20,
      wasm: 'private_credit_spend.wasm',
      zkey: 'private_credit_spend.zkey',
      verificationKey: 'verification_key_private_credit.json',
    },
    artifacts: Object.entries(files).map(([file, content]) => ({
      file,
      sha256: createHash('sha256').update(content).digest('hex'),
    })),
  });
  return { directory, manifest };
}

/** Computes the same six public signals the circuit would emit. */
async function fixtureProof(request: ProofWorkerRequest): Promise<ProofWorkerResult> {
  const input = request.input as Record<string, string>;
  const slotBlinding = await poseidonHash([input.secret!, input.slot!, input.domain_in!]);
  const nullifier = await poseidonHash([slotBlinding]);
  const share = ((BigInt(input.secret!) + BigInt(slotBlinding) * BigInt(input.request_signal_in!)) % FIELD_ORDER).toString();
  return {
    proof: { pi_a: ['1', '2', '1'], pi_b: [['3', '4'], ['5', '6'], ['1', '0']], pi_c: ['7', '8', '1'] },
    publicSignals: [input.root_in!, input.timestamp_in!, input.domain_in!, input.request_signal_in!, nullifier, share],
  };
}

describe('coding-agent sidecar fixture', () => {
  it('completes the real 402, proof, settlement, and response exchange', async () => {
    const resource = await startResourceServer({ providerResponse: '{"id":"chatcmpl-fixture","choices":[]}' });
    const { directory, manifest } = await fixtureArtifactDirectory();
    const metrics = createBaseProofMetrics();
    const exchangeMetrics = createZkPrepaidLifecycleMetrics();
    const credential = await createCredential(generateSecret(), 0, Math.floor(Date.now() / 1000) + 3600, '84532');
    const leaf = await computeCreditLeaf(credential.commitment, credential.tierId, credential.expiry);
    const tree = await deriveSparseCreditWitness(new Map([[5, leaf]]), 5);
    const prove = await createPinnedBaseProofGenerator({
      artifactDirectory: directory,
      manifest,
      metrics,
      workerFactory: (request) => ({ result: fixtureProof(request), terminate: async () => undefined }),
      verifyProof: async () => true,
    });
    const prepaid = createBasePrepaidClient({
      credential,
      slotLedger: await BaseSlotLedger.open({}),
      witnessProvider: createFileWitnessProvider({ root: tree.root, leaves: [{ index: 5, leaf, expiry: credential.expiry }] }),
      prove,
      lifecycle: exchangeMetrics.observe,
    });
    const sidecar = createSidecarServer({
      localToken: 'fixture-local-token',
      gatewayBaseUrl: resource.baseUrl,
      prepaidClient: prepaid.client,
      metrics: () => ({ ...metrics.snapshot(), exchange: exchangeMetrics.snapshot() }),
    });
    const loopback = await sidecar.listen(0);
    try {
      const rawRequest = '{ "model" : "openai/gpt-4o-mini" ,\n  "messages" : [ {"role":"user","content":"hi"} ] }';
      const response = await fetch(`${loopback}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: 'Bearer fixture-local-token', 'Content-Type': 'application/json' },
        body: rawRequest,
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ id: 'chatcmpl-fixture', choices: [] });

      const paymentResponse = decodeHeader<SettlementResponse>(response.headers.get(PAYMENT_RESPONSE_HEADER)!);
      expect(paymentResponse).toMatchObject({ success: true, network: 'eip155:84532' });
      expect(resource.settleCalls()).toBe(1);
      expect(resource.seenBodies).toEqual([rawRequest]);

      const payment = resource.payments[0]!;
      expect(payment.payload.publicSignals).toHaveLength(PUBLIC_SIGNAL_COUNT);
      expect(payment.accepted.scheme).toBe('zk-prepaid');
      const record = await resource.claimStore.lookup(payment.payload.publicSignals[4]!, signalHash(payment));
      expect(record?.state).toBe('committed');

      const snapshot = metrics.snapshot();
      expect(snapshot).toMatchObject({ attempts: 1, successes: 1, failures: 0 });
      expect(prepaid.committedSlots()).toEqual([0]);

      // The loopback aggregate carries the exchange lifecycle without any
      // request, proof, or credential value.
      expect(exchangeMetrics.snapshot()).toMatchObject({
        challengesReceived: 1,
        paymentsPrepared: 1,
        settlementsConfirmed: 1,
        exchangeSuccesses: 1,
        failures: 0,
      });
      expect(JSON.stringify(exchangeMetrics.snapshot())).not.toContain(credential.secret);
      expect(JSON.stringify(exchangeMetrics.snapshot())).not.toContain(payment.payload.nonce);
      expect(JSON.stringify(exchangeMetrics.snapshot())).not.toContain(payment.payload.publicSignals[4]!);

      const unauthorized = await fetch(`${loopback}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawRequest,
      });
      expect(unauthorized.status).toBe(401);
      expect(resource.settleCalls()).toBe(1);
    } finally {
      await sidecar.close();
    }
  });

  it('selects zk-prepaid by scheme when another rail is offered first', async () => {
    const resource = await startResourceServer({ providerResponse: '{"id":"chatcmpl-reordered"}', reorderAcceptances: true });
    const { directory, manifest } = await fixtureArtifactDirectory();
    const credential = await createCredential(generateSecret(), 0, Math.floor(Date.now() / 1000) + 3600, '84532');
    const prove = await createPinnedBaseProofGenerator({
      artifactDirectory: directory,
      manifest,
      workerFactory: (request) => ({ result: fixtureProof(request), terminate: async () => undefined }),
      verifyProof: async () => true,
    });
    const prepaid = createBasePrepaidClient({
      credential,
      slotLedger: await BaseSlotLedger.open({}),
      witnessProvider: {
        witnessForCredential: async () => ({
          root: '1',
          pathElements: Array.from({ length: 20 }, () => '0'),
          pathIndices: Array.from({ length: 20 }, () => 0),
        }),
      },
      prove,
    });
    const sidecar = createSidecarServer({
      localToken: 'fixture-local-token',
      gatewayBaseUrl: resource.baseUrl,
      prepaidClient: prepaid.client,
    });
    const loopback = await sidecar.listen(0);
    try {
      const response = await fetch(`${loopback}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: 'Bearer fixture-local-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'openai/gpt-4o-mini', messages: [] }),
      });
      expect(response.status).toBe(200);
      expect(resource.payments[0]!.accepted.scheme).toBe('zk-prepaid');
      expect(resource.settleCalls()).toBe(1);
    } finally {
      await sidecar.close();
    }
  });
});
