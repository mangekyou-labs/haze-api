import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCredential, generateSecret } from '@zk-credits/shared/base';
import {
  buildPaymentRequired, buildPaymentRequirements, decodeHeader, encodeHeader,
  PAYMENT_REQUIRED_HEADER, PAYMENT_RESPONSE_HEADER, PAYMENT_SIGNATURE_HEADER,
  type PaymentPayload,
} from '@zk-credits/x402-zk-prepaid';
import { createSidecarRuntime, RuntimeCredentialError } from './sidecar-runtime.js';
import type { CredentialStore } from './credential-store.js';
import { writeRpcConfig } from './rpc-config.js';
import { writeSetupConfig } from './setup-config.js';
import { buildBaseRegisteredTrialRequestBody } from './base-registered-trial.js';
import { createLocalX402Agent } from './local-x402-agent.js';
import { sidecarStatePaths } from './sidecar-config.js';

const adapters = vi.hoisted(() => ({ proofFactory: vi.fn(), events: vi.fn() }));
vi.mock('./proof-coordinator.js', () => ({ createPinnedBaseProofGenerator: adapters.proofFactory }));
vi.mock('./base-event-sync.js', () => ({ createBaseEventWitnessProvider: adapters.events }));

const target = 'https://api.test/v1/chat/completions';
const body = buildBaseRegisteredTrialRequestBody();
const witness = {
  root: '123', pathElements: Array.from({ length: 20 }, () => '0'),
  pathIndices: Array.from({ length: 20 }, () => 0),
};

describe('assembled Sidecar runtime', () => {
  let directory: string;
  let store: CredentialStore;
  let environment: NodeJS.ProcessEnv;
  let expiry: number;
  let proofFailure: boolean;

  beforeEach(async () => {
    vi.clearAllMocks();
    directory = await mkdtemp(join(tmpdir(), 'sidecar-runtime-'));
    expiry = Math.floor(Date.now() / 1000) + 3600;
    const credential = await createCredential(generateSecret(), 0, expiry, '84532');
    store = { read: async () => JSON.stringify({ version: 1, credential }), write: async () => {} };
    const witnessPath = join(directory, 'witness.json');
    await writeFile(witnessPath, JSON.stringify(witness));
    environment = { ZK_CREDITS_ARTIFACT_DIR: join(directory, 'artifacts'), ZK_CREDITS_WITNESS_PATH: witnessPath };
    proofFailure = false;
    adapters.events.mockReturnValue({ witnessForCredential: async () => witness });
    adapters.proofFactory.mockImplementation(async ({ metrics }) => async (_input: unknown, context: { expectedPublicSignals: string[] }) => {
      metrics.recordAttempt({ outcome: proofFailure ? 'failure' : 'success', durationMs: 10, ...(proofFailure ? { category: 'self_verify_failed' } : {}) });
      if (proofFailure) throw new Error('Local proof self-check failed');
      return { proof: { pi_a: ['1'], pi_b: [['1']], pi_c: ['1'] }, publicSignals: [...context.expectedPublicSignals] };
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(directory, { recursive: true, force: true });
  });

  async function open(options = {}) {
    return createSidecarRuntime({ environment, credentialStore: store, stateDirectory: directory, ...options });
  }

  function gateway() {
    const accepted = buildPaymentRequirements({
      payTo: '0x00000000000000000000000000000000000000b2',
      contract: '0x00000000000000000000000000000000000000a1',
      deploymentDomain: '84532', circuitId: 'private-credit-spend-bn254-v1',
      verifyingKeyId: 'dev-sepolia-v1', issuedAt: Math.floor(Date.now() / 1000),
    });
    const payments: PaymentPayload[] = [];
    const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const encodedPayment = new Headers(init?.headers).get(PAYMENT_SIGNATURE_HEADER);
      if (!encodedPayment) return new Response(null, {
        status: 402, headers: { [PAYMENT_REQUIRED_HEADER]: encodeHeader(buildPaymentRequired(target, accepted)) },
      });
      payments.push(decodeHeader<PaymentPayload>(encodedPayment));
      return new Response('{"ok":true}', {
        status: 200, headers: { [PAYMENT_RESPONSE_HEADER]: encodeHeader({ success: true, transaction: '', network: accepted.network }) },
      });
    });
    vi.stubGlobal('fetch', fetcher);
    return { fetcher, payments };
  }

  it.each(['client', 'founder'] as const)('assembles a successful %s exchange and restores committed slots after restart', async mode => {
    const { fetcher, payments } = gateway();
    const runtime = await open();
    const before = runtime.snapshot();
    expect(await runtime.witnessRoot()).toBe('123');
    if (mode === 'client') {
      expect((await runtime.client.fetch(target, { method: 'POST', body })).status).toBe(200);
    } else {
      let displayed = '';
      const result = await runtime.runFounderTrial({ url: target, body, onResponse: async response => { displayed = await response.text(); } });
      expect(result).toMatchObject({ challengeReceived: true, proofPrepared: true, paymentSignatureSent: true,
        paymentResponseConfirmed: true, responseSucceeded: true, committedSlotDelta: 1 });
      expect(result.failurePhase).toBeUndefined();
      expect(displayed).toBe('{"ok":true}');
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(payments).toHaveLength(1);
    expect(payments[0].payload).not.toHaveProperty('secret');
    expect(payments[0].payload).not.toHaveProperty('commitment');
    expect(runtime.snapshot()).toMatchObject({ slots: { committed: 1, provisional: 0 }, metrics: {
      attempts: 1, successes: 1, exchange: { challengesReceived: 1, paymentsPrepared: 1, settlementsConfirmed: 1, exchangeSuccesses: 1 },
    } });
    expect(before.slots.committed).toBe(0);
    expect(before.metrics.attempts).toBe(0);
    await runtime.close();
    const reopened = await open();
    expect(reopened.snapshot().slots.committed).toBe(1);
    const saved = JSON.parse(await readFile(join(directory, 'base-slots.json'), 'utf8'));
    expect(saved.committed).toEqual([0]);
    // Callers cannot mutate runtime state through snapshots or obtain the secret.
    const snapshot = reopened.snapshot();
    (snapshot.slots as { committed: number }).committed = 200;
    snapshot.metrics.failuresByCategory.timeout = 200;
    snapshot.metrics.hotProve.samples = 200;
    expect(reopened.snapshot().slots.committed).toBe(1);
    expect(reopened.snapshot().metrics.failuresByCategory.timeout).toBe(0);
    expect(reopened.snapshot().metrics.hotProve.samples).toBe(0);
    expect(JSON.stringify(snapshot)).not.toContain('secret');
  });

  it.each(['client', 'founder'] as const)('keeps the slot reusable after a %s proof failure', async mode => {
    const { payments } = gateway();
    const runtime = await open();
    proofFailure = true;
    if (mode === 'client') await expect(runtime.client.fetch(target, { method: 'POST', body })).rejects.toThrow();
    else expect(await runtime.runFounderTrial({ url: target, body })).toMatchObject({ failurePhase: 'proof_generation', committedSlotDelta: 0 });
    expect(payments).toHaveLength(0);
    expect(runtime.snapshot().slots).toMatchObject({ committed: 0, provisional: 0 });
    proofFailure = false;
    expect(await runtime.runFounderTrial({ url: target, body })).toMatchObject({ responseSucceeded: true, committedSlotDelta: 1 });
  });

  it('preserves the reusable client trial limit without applying it to the founder exchange', async () => {
    const { payments } = gateway();
    const runtime = await open({ internalTrialOneProof: true });
    proofFailure = true;
    await expect(runtime.client.fetch(target, { method: 'POST', body })).rejects.toThrow();
    proofFailure = false;
    await expect(runtime.client.fetch(target, { method: 'POST', body })).rejects.toThrow('internal_trial_limit_reached');
    expect(payments).toHaveLength(0);
    expect(await runtime.runFounderTrial({ url: target, body })).toMatchObject({ responseSucceeded: true });
    expect(runtime.snapshot().slots.committed).toBe(1);
  });

  it.each(['expired', 'wrong-domain'] as const)('rejects a %s credential before loading proof artifacts or spending', async reason => {
    const credential = await createCredential(generateSecret(), 0, reason === 'expired' ? Math.floor(Date.now() / 1000) - 1 : expiry,
      reason === 'wrong-domain' ? '1' : '84532');
    store = { read: async () => JSON.stringify({ version: 1, credential }), write: async () => {} };
    await expect(open()).rejects.toBeInstanceOf(RuntimeCredentialError);
    expect(adapters.proofFactory).not.toHaveBeenCalled();
    await expect(readFile(join(directory, 'base-slots.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects malformed witnesses before returning a usable client', async () => {
    await writeFile(environment.ZK_CREDITS_WITNESS_PATH!, JSON.stringify({ ...witness, pathElements: ['0'] }));
    await expect(open()).rejects.toThrow('Base membership witness is malformed');
    await expect(readFile(join(directory, 'base-slots.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('stops on a pinned artifact failure without spending or publishing server state', async () => {
    adapters.proofFactory.mockRejectedValueOnce(new Error('Pinned proving bundle hash mismatch'));
    await expect(createLocalX402Agent({ environment, credentialStore: store, stateDirectory: directory, port: 0 }))
      .rejects.toThrow('Pinned proving bundle hash mismatch');
    await expect(readFile(join(directory, 'base-slots.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(sidecarStatePaths(directory).tokenPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['explicit', 'saved', 'legacy'] as const)('preserves %s RPC precedence and applies saved configuration to the supplied environment', async source => {
    await writeSetupConfig(join(directory, 'config.json'), {
      version: 1, artifactDirectory: join(directory, 'saved-artifacts'),
      witness: { kind: 'base-events', rpcUrl: 'https://legacy.test/',
        contractAddress: '0x00000000000000000000000000000000000000a1', deploymentBlock: '10', confirmations: '3' },
    });
    if (source !== 'legacy') await writeRpcConfig(directory, 'https://saved.test/');
    environment = source === 'explicit' ? { BASE_RPC_URL: 'https://explicit.test/', ZK_CREDITS_ARTIFACT_DIR: join(directory, 'override-artifacts') } : {};
    const runtime = await open();
    expect(await runtime.witnessRoot()).toBe('123');
    expect(environment.BASE_RPC_URL).toBe(`https://${source}.test/`);
    expect(environment.BASE_DEPLOYMENT_BLOCK).toBe('10');
    expect(adapters.events).toHaveBeenCalledWith(expect.objectContaining({ rpcUrl: environment.BASE_RPC_URL,
      deploymentBlock: 10n, confirmations: 3n, cachePath: join(directory, 'base-event-sync.json') }));
    expect(adapters.proofFactory).toHaveBeenCalledWith(expect.objectContaining({ artifactDirectory:
      join(directory, source === 'explicit' ? 'override-artifacts' : 'saved-artifacts') }));
  });

  it('prefers an explicit witness file over saved Base events', async () => {
    await writeSetupConfig(join(directory, 'config.json'), {
      version: 1, artifactDirectory: join(directory, 'saved-artifacts'),
      witness: { kind: 'base-events', rpcUrl: 'https://legacy.test/', contractAddress: '0x00000000000000000000000000000000000000a1' },
    });
    expect(await (await open()).witnessRoot()).toBe('123');
    expect(adapters.events).not.toHaveBeenCalled();
  });

  it('keeps saved configuration and spent slots under the supplied home directory', async () => {
    const stateDirectory = join(directory, '.zk-credits');
    await writeSetupConfig(join(stateDirectory, 'config.json'), {
      version: 1, artifactDirectory: environment.ZK_CREDITS_ARTIFACT_DIR!,
      witness: { kind: 'file', path: environment.ZK_CREDITS_WITNESS_PATH! },
    });
    environment = {};
    gateway();
    const runtime = await open({ stateDirectory: undefined, homeDirectory: directory });
    expect((await runtime.client.fetch(target, { method: 'POST', body })).status).toBe(200);
    expect(JSON.parse(await readFile(join(stateDirectory, 'base-slots.json'), 'utf8')).committed).toEqual([0]);
    await expect(readFile(join(directory, 'base-slots.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await runtime.close();
    expect((await open({ stateDirectory: undefined, homeDirectory: directory })).snapshot().slots.committed).toBe(1);
  });

  it('launches the own-agent caller with authenticated metrics from the shared runtime and closes its server', async () => {
    // Keep real loopback HTTP separate from the controlled gateway transport.
    const agent = await createLocalX402Agent({ environment, credentialStore: store, stateDirectory: directory, port: 0 });
    try {
      expect((await fetch(agent.metricsUrl)).status).toBe(401);
      const token = (await readFile(sidecarStatePaths(directory).tokenPath, 'utf8')).trim();
      const response = await fetch(agent.metricsUrl, { headers: { authorization: `Bearer ${token}` } });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ attempts: 0, exchange: { paymentsPrepared: 0 } });
    } finally { await agent.close(); }
    await expect(fetch(agent.metricsUrl)).rejects.toThrow();
  });
});
