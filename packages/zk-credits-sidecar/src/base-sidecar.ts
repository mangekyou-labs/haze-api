/**
 * Base Sepolia client for the experimental x402 v2 `zk-prepaid` scheme.
 *
 * The credential, witness, slot, Groth16 proof, and response key are handled
 * locally. Only the proof payload and request-bound public signals cross the
 * gateway boundary.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createDecipheriv, generateKeyPair as generateKeyPairCallback, privateDecrypt, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import {
  BASE_MEMBERSHIP_TREE_CAPACITY,
  canonicalizeBaseJson,
  computeCreditLeaf,
  computeNullifier,
  computeShare,
  computeSlotBlinding,
  deriveRequestSignal,
  deriveSparseCreditWitness,
  secretFromBase64Url,
  secretToField,
  type CreditCredential,
} from '@zk-credits/shared/base';
import {
  buildPaymentPayload,
  createZkPrepaidClient,
  decodeHeader,
  type PaymentPayload,
  type PaymentRequirements,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  type ZkPrepaidClient,
  type ZkPrepaidLifecycleObserver,
} from '@zk-credits/x402-zk-prepaid';
import type { BaseSlotLedger } from './slot-ledger.js';

const generateKeyPair = promisify(generateKeyPairCallback);
const TREE_DEPTH = 20;
const FIELD_ORDER = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const REPLAY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PENDING_PAYMENTS = 64;

export interface BaseCreditWitness {
  root: string;
  pathElements: string[];
  pathIndices: number[];
  /** Exact expiry emitted by BundleFunded. The contract, not Stripe time, is authoritative. */
  expiry?: number;
}

export interface BaseWitnessProvider {
  witnessForCredential(credential: CreditCredential): Promise<BaseCreditWitness>;
}

export interface BaseProofInput {
  secret: string;
  tier_id: string;
  expiry: string;
  slot: string;
  merkle_path_elements: string[];
  merkle_path_indices: string[];
  root_in: string;
  timestamp_in: string;
  domain_in: string;
  request_signal_in: string;
}

export interface BaseProofResult {
  proof: Record<string, unknown>;
  publicSignals: string[];
}

export interface BaseProofContext {
  requirements: PaymentRequirements;
  credential: CreditCredential;
  /**
   * The six canonical public signals this payment must carry, in order:
   * root, timestamp, domain, requestSignal, nullifier, share.
   */
  expectedPublicSignals: readonly string[];
}

export type BaseProofGenerator = (input: BaseProofInput, context: BaseProofContext) => Promise<BaseProofResult>;

export interface BasePrepaidClientOptions {
  credential: CreditCredential;
  witnessProvider: BaseWitnessProvider;
  prove: BaseProofGenerator;
  fetch?: typeof fetch;
  /**
   * Durable local slot ledger. A slot is provisional until the proof passes
   * local self-verification and is committed immediately before the payment
   * can leave the process.
   */
  slotLedger?: BaseSlotLedger;
  /**
   * Optional fixed-shape exchange observer. It sees closed lifecycle enums
   * only, so the loopback aggregate counters never carry a request, a proof,
   * a public signal, or a credential identifier.
   */
  lifecycle?: ZkPrepaidLifecycleObserver;
}

export interface BasePrepaidClient {
  client: ZkPrepaidClient;
  /** Slots committed locally; a committed slot is never reused. */
  committedSlots(): number[];
}

function field(value: string, label: string): string {
  if (!/^\d+$/u.test(value)) throw new Error(`Invalid ${label}`);
  const parsed = BigInt(value);
  if (parsed < 0n || parsed >= FIELD_ORDER) throw new Error(`Invalid ${label}`);
  return parsed.toString();
}

function assertWitness(witness: BaseCreditWitness): BaseCreditWitness {
  if (
    typeof witness.root !== 'string'
    || witness.pathElements.length !== TREE_DEPTH
    || witness.pathIndices.length !== TREE_DEPTH
    || !witness.pathElements.every((value) => /^\d+$/u.test(value))
    || !witness.pathIndices.every((value) => value === 0 || value === 1)
  ) {
    throw new Error('Base membership witness is malformed');
  }
  if (witness.expiry !== undefined && (!Number.isSafeInteger(witness.expiry) || witness.expiry <= 0)) {
    throw new Error('Base membership witness expiry is malformed');
  }
  return {
    root: field(witness.root, 'membership root'),
    pathElements: witness.pathElements.map((value) => field(value, 'membership path element')),
    pathIndices: [...witness.pathIndices],
    ...(witness.expiry === undefined ? {} : { expiry: witness.expiry }),
  };
}

interface ResponseKeyPair {
  publicKey: string;
  privateKey: string;
}

async function responseKey(): Promise<ResponseKeyPair> {
  const pair = await generateKeyPair('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  if (typeof pair.publicKey !== 'string' || typeof pair.privateKey !== 'string') throw new Error('Response key generation failed');
  return { publicKey: pair.publicKey, privateKey: pair.privateKey };
}

function randomNonce(): string {
  return randomBytes(24).toString('base64url');
}

function requestBodyBytes(body: unknown): Uint8Array {
  if (body instanceof Uint8Array) return body;
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body == null) return new Uint8Array();
  throw new Error('The Base x402 sidecar requires the exact request-body bytes');
}

interface ReplayEnvelope {
  version: 1;
  algorithm: 'RSA-OAEP-256/AES-256-GCM';
  key: string;
  iv: string;
  tag: string;
  ciphertext: string;
  expiresAt: number;
  contentType: string;
  status: number;
}

interface PendingPayment {
  payment: PaymentPayload;
  expiresAt: number;
}

function decryptReplay(envelopeValue: string, privateKey: string, paymentResponse: string | null): Response | null {
  try {
    const envelope = JSON.parse(envelopeValue) as Partial<ReplayEnvelope>;
    if (
      envelope.version !== 1
      || envelope.algorithm !== 'RSA-OAEP-256/AES-256-GCM'
      || typeof envelope.key !== 'string'
      || typeof envelope.iv !== 'string'
      || typeof envelope.tag !== 'string'
      || typeof envelope.ciphertext !== 'string'
      || typeof envelope.expiresAt !== 'number'
      || envelope.expiresAt <= Date.now()
      || typeof envelope.contentType !== 'string'
      || !Number.isInteger(envelope.status)
    ) return null;
    const aesKey = privateDecrypt({ key: privateKey, oaepHash: 'sha256' }, Buffer.from(envelope.key, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', aesKey, Buffer.from(envelope.iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    const body = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final()]);
    const headers = new Headers({ 'content-type': envelope.contentType });
    if (paymentResponse) headers.set(PAYMENT_RESPONSE_HEADER, paymentResponse);
    return new Response(body, { status: envelope.status, headers });
  } catch {
    return null;
  }
}

/** Builds the reusable client adapter used by the loopback proxy. */
export function createBasePrepaidClient(options: BasePrepaidClientOptions): BasePrepaidClient {
  const secret = secretFromBase64Url(options.credential.secret);
  const fetcher = options.fetch ?? fetch;
  const replayKeys = new Map<string, { privateKey: string; expiresAt: number }>();
  const pendingPayments = new Map<string, PendingPayment>();
  const pendingByNonce = new Map<string, string>();
  const paymentPromises = new Map<string, Promise<PaymentPayload>>();

  const removePending = (requestKey: string): void => {
    const pending = pendingPayments.get(requestKey);
    if (!pending) return;
    pendingPayments.delete(requestKey);
    pendingByNonce.delete(pending.payment.payload.nonce);
    replayKeys.delete(pending.payment.payload.nonce);
  };

  const removePendingForNonce = (nonce: string): void => {
    const requestKey = pendingByNonce.get(nonce);
    if (requestKey) removePending(requestKey);
    else replayKeys.delete(nonce);
  };

  const prunePending = (): void => {
    const now = Date.now();
    for (const [requestKey, pending] of pendingPayments) {
      if (pending.expiresAt <= now) removePending(requestKey);
    }
    for (const [nonce, key] of replayKeys) {
      if (key.expiresAt <= now && !pendingByNonce.has(nonce)) replayKeys.delete(nonce);
    }
    while (pendingPayments.size > MAX_PENDING_PAYMENTS) {
      const oldest = pendingPayments.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      removePending(oldest);
    }
  };

  const requestKey = (method: string, url: string, body: unknown, requirements: PaymentRequirements): string => canonicalizeBaseJson({
    body: Buffer.from(requestBodyBytes(body)).toString('base64url'),
    method: method.toUpperCase(),
    requirements,
    url,
  });

  const trackPaymentResponse = (response: Response, init?: RequestInit): Response => {
    if (response.status === 402) return response;
    const encodedPayment = new Headers(init?.headers).get(PAYMENT_SIGNATURE_HEADER);
    if (!encodedPayment) return response;
    let payment: PaymentPayload;
    try {
      payment = decodeHeader<PaymentPayload>(encodedPayment);
    } catch {
      return response;
    }
    const nonce = payment.payload.nonce;
    if (!pendingByNonce.has(nonce)) return response;
    if (!response.body) {
      removePendingForNonce(nonce);
      return response;
    }
    const reader = response.body.getReader();
    const trackedBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const result = await reader.read();
          if (result.done) {
            reader.releaseLock();
            removePendingForNonce(nonce);
            controller.close();
          } else {
            controller.enqueue(result.value);
          }
        } catch (error) {
          // Keep the encrypted replay key when the response is interrupted.
          // The gateway can then return the committed response on an exact retry.
          controller.error(error);
        }
      },
      async cancel(reason) {
        await reader.cancel(reason);
      },
    });
    return new Response(trackedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    });
  };

  const fetchWithReplay = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    prunePending();
    const response = await fetcher(input, init);
    if (response.status !== 409) return trackPaymentResponse(response, init);
    let replayAvailable = false;
    try {
      const body = await response.clone().json() as { replay?: unknown };
      replayAvailable = body.replay === true;
    } catch {
      return response;
    }
    if (!replayAvailable) return response;
    const encodedPayment = new Headers(init?.headers).get(PAYMENT_SIGNATURE_HEADER);
    if (!encodedPayment) return response;
    let payment: PaymentPayload;
    try {
      payment = decodeHeader<PaymentPayload>(encodedPayment);
    } catch {
      return response;
    }
    const key = replayKeys.get(payment.payload.nonce);
    if (!key || key.expiresAt <= Date.now()) {
      removePendingForNonce(payment.payload.nonce);
      return response;
    }
    const sourceUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    let replayUrl = '/x402/replay';
    try { replayUrl = new URL('/x402/replay', sourceUrl).toString(); } catch { /* relative test URLs use the same origin */ }
    const replayResponse = await fetcher(replayUrl, {
      method: 'POST',
      headers: { [PAYMENT_SIGNATURE_HEADER]: encodedPayment, accept: 'application/json' },
    });
    if (!replayResponse.ok) return response;
    let replayBody: { encryptedReplay?: unknown };
    try { replayBody = await replayResponse.json() as { encryptedReplay?: unknown }; } catch { return response; }
    if (typeof replayBody.encryptedReplay !== 'string') return response;
    const decrypted = decryptReplay(replayBody.encryptedReplay, key.privateKey, response.headers.get(PAYMENT_RESPONSE_HEADER));
    if (!decrypted) return response;
    removePendingForNonce(payment.payload.nonce);
    return decrypted;
  };

  const client = createZkPrepaidClient({
    fetch: fetchWithReplay,
    ...(options.lifecycle ? { lifecycle: options.lifecycle } : {}),
    createPayload: async ({ method, url, body, requirements }): Promise<PaymentPayload> => {
      if (requirements.extra.deploymentDomain !== options.credential.deploymentDomain) {
        throw new Error('Credential deployment domain does not match the gateway challenge');
      }
      prunePending();
      const key = requestKey(method, url, body, requirements);
      const cached = pendingPayments.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.payment;
      if (cached) removePending(key);
      const inFlight = paymentPromises.get(key);
      if (inFlight) return inFlight;

      const paymentPromise = (async (): Promise<PaymentPayload> => {
        const slotLedger = options.slotLedger;
        if (!slotLedger) throw new Error('A durable slot ledger is required for the Base pilot');
        const selectedSlot = slotLedger.allocateProvisional();
        try {
          const nonce = randomNonce();
          const responseKeys = await responseKey();
          const requestSignal = await deriveRequestSignal({
            method,
            url,
            body: requestBodyBytes(body),
            requirements,
            nonce,
            responseKey: responseKeys.publicKey,
          });
          const witness = assertWitness(await options.witnessProvider.witnessForCredential(options.credential));
          const expiry = witness.expiry ?? options.credential.expiry;
          if (!Number.isSafeInteger(expiry) || expiry <= 0) throw new Error('Invalid Base credential expiry');
          const slotBlinding = await computeSlotBlinding(secret, selectedSlot, options.credential.deploymentDomain);
          const nullifier = await computeNullifier(slotBlinding);
          const share = await computeShare(secret, requestSignal.field, slotBlinding);
          const timestamp = String(requirements.extra.issuedAt);
          const expectedPublicSignals = [
            witness.root,
            timestamp,
            options.credential.deploymentDomain,
            requestSignal.field,
            nullifier,
            share,
          ];
          const proof = await options.prove({
            secret: secretToField(secret),
            tier_id: String(options.credential.tierId),
            expiry: String(expiry),
            slot: String(selectedSlot),
            merkle_path_elements: witness.pathElements,
            merkle_path_indices: witness.pathIndices.map(String),
            root_in: witness.root,
            timestamp_in: timestamp,
            domain_in: options.credential.deploymentDomain,
            request_signal_in: requestSignal.field,
          }, { requirements, credential: options.credential, expectedPublicSignals });
          if (
            !Array.isArray(proof.publicSignals)
            || proof.publicSignals.length !== expectedPublicSignals.length
            || !proof.publicSignals.every((value, index) => value === expectedPublicSignals[index])
          ) {
            throw new Error('Proof public signals do not match the canonical statement');
          }
          await slotLedger.commit(selectedSlot);
          const payment = buildPaymentPayload({
            requirements,
            proof: proof.proof,
            publicSignals: [...proof.publicSignals],
            nonce,
            responseKey: responseKeys.publicKey,
          });
          const expiresAt = Date.now() + REPLAY_TTL_MS;
          replayKeys.set(nonce, { privateKey: responseKeys.privateKey, expiresAt });
          pendingPayments.set(key, { payment, expiresAt });
          pendingByNonce.set(nonce, key);
          prunePending();
          return payment;
        } catch (error) {
          slotLedger.release(selectedSlot);
          throw error;
        }
      })();
      paymentPromises.set(key, paymentPromise);
      try {
        return await paymentPromise;
      } finally {
        if (paymentPromises.get(key) === paymentPromise) paymentPromises.delete(key);
      }
    },
  });

  return { client, committedSlots: () => options.slotLedger?.committedSlots() ?? [] };
}

interface PublicTreeArtifact {
  leaves: ReadonlyMap<number, string>;
  expiries: ReadonlyMap<number, number>;
  root?: string;
}

function parsePublicTreeArtifact(value: unknown): PublicTreeArtifact | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { leaves?: unknown; root?: unknown };
  if (!Array.isArray(candidate.leaves)) return undefined;
  const leaves = new Map<number, string>();
  const expiries = new Map<number, number>();
  for (const entry of candidate.leaves) {
    const record = Array.isArray(entry)
      ? { index: entry[0], leaf: entry[1], expiry: entry[2] }
      : entry && typeof entry === 'object'
        ? entry as { index?: unknown; leaf?: unknown; expiry?: unknown }
        : undefined;
    if (!record) throw new Error('Public tree artifact contains a malformed leaf entry');
    const index = Number(record.index);
    if (!Number.isSafeInteger(index) || index < 0 || index >= BASE_MEMBERSHIP_TREE_CAPACITY) {
      throw new Error('Public tree artifact contains an out-of-range leaf index');
    }
    if (typeof record.leaf !== 'string' || !/^\d+$/u.test(record.leaf)) {
      throw new Error('Public tree artifact contains a malformed leaf');
    }
    leaves.set(index, record.leaf);
    if (record.expiry !== undefined) {
      const expiry = Number(record.expiry);
      if (!Number.isSafeInteger(expiry) || expiry <= 0) throw new Error('Public tree artifact contains a malformed expiry');
      expiries.set(index, expiry);
    }
  }
  return {
    leaves,
    expiries,
    ...(typeof candidate.root === 'string' ? { root: candidate.root } : {}),
  };
}

/**
 * Reads a depth-20 witness from a local artifact: either a prepared witness or
 * a public tree of `BundleFunded` leaves. Nothing is fetched, and no gateway
 * endpoint serves a path for a named leaf or commitment.
 */
export function createFileWitnessProvider(value: unknown): BaseWitnessProvider {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const prepared = candidate.witness && typeof candidate.witness === 'object' ? candidate.witness as Record<string, unknown> : candidate;
  const tree = parsePublicTreeArtifact(value);
  return {
    async witnessForCredential(credential: CreditCredential): Promise<BaseCreditWitness> {
      if (prepared && Array.isArray(prepared.pathElements) && Array.isArray(prepared.pathIndices) && typeof prepared.root === 'string') {
        return {
          root: prepared.root,
          pathElements: prepared.pathElements.map(String),
          pathIndices: prepared.pathIndices.map(Number),
          ...(prepared.expiry === undefined ? {} : { expiry: Number(prepared.expiry) }),
        };
      }
      if (!tree) throw new Error('Witness artifact is missing a prepared witness or a public tree');
      const leaf = await computeCreditLeaf(credential.commitment, credential.tierId, credential.expiry);
      const entry = [...tree.leaves.entries()].find(([, candidateLeaf]) => candidateLeaf === leaf);
      if (!entry) throw new Error('No funded Base bundle was found for this credential');
      const witness = await deriveSparseCreditWitness(tree.leaves, entry[0]);
      if (tree.root !== undefined && await field(tree.root, 'public tree root') !== witness.root) {
        throw new Error('Public tree artifact root does not match the derived membership root');
      }
      const expiry = tree.expiries.get(entry[0]) ?? credential.expiry;
      return {
        root: witness.root,
        pathElements: witness.pathElements,
        pathIndices: witness.pathIndices,
        expiry,
      };
    },
  };
}
