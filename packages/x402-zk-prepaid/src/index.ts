/**
 * Custom x402 v2 `zk-prepaid` adapter for private prepaid API credits.
 *
 * This package implements one scheme against the published @x402/core v2
 * interfaces. It is intentionally not a general x402 or Bazaar compatibility
 * layer.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type {
  AssetAmount,
  FacilitatorContext,
  Network,
  PaymentPayload as CorePaymentPayload,
  PaymentPayloadContext,
  PaymentRequired as CorePaymentRequired,
  PaymentRequirements as CorePaymentRequirements,
  Price,
  ResourceInfo as CoreResourceInfo,
  SchemeNetworkClient,
  SchemeNetworkFacilitator,
  SchemeNetworkServer,
  SettleContext,
  SettleResponse as CoreSettleResponse,
  SupportedKind,
  VerifyResponse as CoreVerifyResponse,
} from '@x402/core/types';
import type { x402Client } from '@x402/core/client';
import type { x402Facilitator } from '@x402/core/facilitator';
import type { FacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { lifecycleFailure, lifecycleStage, type ZkPrepaidLifecycleEvent, type ZkPrepaidLifecycleObserver } from './lifecycle.js';

export * from './lifecycle.js';

export const X402_VERSION = 2 as const;
export const ZK_PREPAID_SCHEME = 'zk-prepaid' as const;
export const BASE_SEPOLIA_NETWORK = 'eip155:84532' as const;
export const CODING_DEEPSEEK_V4_FLASH_V1 = 'coding-deepseek-v4-flash-v1' as const;
export const PRIVATE_CREDIT_AMOUNT = '1' as const;
export const PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED';
export const PAYMENT_SIGNATURE_HEADER = 'PAYMENT-SIGNATURE';
export const PAYMENT_RESPONSE_HEADER = 'PAYMENT-RESPONSE';
export const PUBLIC_SIGNAL_INDEX = Object.freeze({ root: 0, timestamp: 1, domain: 2, signal: 3, nullifier: 4, share: 5 });

const FIELD_ORDER = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const FORBIDDEN_KEYS = new Set(['account', 'commitment', 'order', 'secret', 'tier', 'wallet', 'payer', 'user', 'subject', 'phase', 'settlementphase']);
const PAYMENT_KEYS = new Set(['x402Version', 'accepted', 'payload', 'resource', 'extensions']);
const PAYLOAD_KEYS = new Set(['nonce', 'proof', 'publicSignals', 'responseKey']);
const PROOF_KEYS = new Set(['pi_a', 'pi_b', 'pi_c']);
const RESOURCE_KEYS = new Set(['url', 'description', 'mimeType', 'serviceName', 'tags', 'iconUrl']);
const SETTLEMENT_PHASE = Symbol('zk-prepaid.settlementPhase');

export type ResourceInfo = CoreResourceInfo;

export interface ZkPrepaidExtra {
  assetTransferMethod: 'prepaid-claim';
  paymentFlow: 'escrow';
  circuit: string;
  verifyingKey: string;
  deploymentDomain: string;
  contract: string;
  requirementsVersion: string;
  issuedAt: number;
  [key: string]: unknown;
}

export type PaymentRequirements = Omit<CorePaymentRequirements, 'scheme' | 'network' | 'amount' | 'asset' | 'extra'> & {
  scheme: typeof ZK_PREPAID_SCHEME;
  network: typeof BASE_SEPOLIA_NETWORK;
  amount: typeof PRIVATE_CREDIT_AMOUNT;
  asset: typeof CODING_DEEPSEEK_V4_FLASH_V1;
  extra: ZkPrepaidExtra;
};

export type PaymentRequired = Omit<CorePaymentRequired, 'x402Version' | 'accepts'> & {
  x402Version: typeof X402_VERSION;
  accepts: PaymentRequirements[];
};

export interface ZkPrepaidPayload {
  proof: Record<string, unknown>;
  publicSignals: string[];
  nonce: string;
  responseKey: string;
  [key: string]: unknown;
}

export type PaymentPayload = Omit<CorePaymentPayload, 'x402Version' | 'accepted' | 'payload' | 'resource'> & {
  x402Version: typeof X402_VERSION;
  resource?: ResourceInfo;
  accepted: PaymentRequirements;
  payload: ZkPrepaidPayload;
};

export type SettlementResponse = Omit<CoreSettleResponse, 'payer' | 'transaction' | 'network'> & {
  transaction: '';
  network: Network;
  reservationId?: string;
  payer?: never;
};

export type VerificationResponse = CoreVerifyResponse;

export interface SupportedResponse {
  kinds: Array<SupportedKind>;
  extensions: string[];
  signers: Record<string, string[]>;
}

export interface PaymentRequirementsOptions {
  /** Kept for source compatibility; only the fixed credit asset is accepted. */
  asset?: string;
  payTo: string;
  contract: string;
  deploymentDomain: string;
  circuitId: string;
  verifyingKeyId: string;
  requirementsVersion?: string;
  maxTimeoutSeconds?: number;
  network?: string;
  issuedAt?: number;
}

function assertNonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) throw new Error(`${label} is required`);
  return value;
}

function assertIssuedAt(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('issuedAt must be a non-negative integer');
  return value;
}

export function buildPaymentRequirements(options: PaymentRequirementsOptions): PaymentRequirements {
  const network = options.network ?? BASE_SEPOLIA_NETWORK;
  if (network !== BASE_SEPOLIA_NETWORK) throw new Error(`zk-prepaid is not enabled on ${network}`);
  if (options.asset !== undefined && options.asset !== CODING_DEEPSEEK_V4_FLASH_V1) throw new Error('zk-prepaid asset is fixed');
  if (!Number.isInteger(options.maxTimeoutSeconds ?? 300) || (options.maxTimeoutSeconds ?? 300) <= 0) throw new Error('Invalid max timeout');
  return {
    scheme: ZK_PREPAID_SCHEME,
    network: BASE_SEPOLIA_NETWORK,
    amount: PRIVATE_CREDIT_AMOUNT,
    asset: CODING_DEEPSEEK_V4_FLASH_V1,
    payTo: assertNonEmpty(options.payTo, 'payTo'),
    maxTimeoutSeconds: options.maxTimeoutSeconds ?? 300,
    extra: {
      assetTransferMethod: 'prepaid-claim',
      paymentFlow: 'escrow',
      circuit: assertNonEmpty(options.circuitId, 'circuit id'),
      verifyingKey: assertNonEmpty(options.verifyingKeyId, 'verifying key'),
      deploymentDomain: assertNonEmpty(options.deploymentDomain, 'deployment domain'),
      contract: assertNonEmpty(options.contract, 'contract'),
      requirementsVersion: options.requirementsVersion ?? 'zk-prepaid-v1',
      issuedAt: assertIssuedAt(options.issuedAt ?? Math.floor(Date.now() / 1000)),
    },
  };
}

export function buildPaymentRequired(url: string, requirements: PaymentRequirements, error?: string): PaymentRequired {
  return {
    x402Version: X402_VERSION,
    ...(error ? { error } : {}),
    resource: { url, description: 'One private prepaid API credit', mimeType: 'application/json' },
    accepts: [structuredClone(requirements)],
  };
}

export interface PaymentPayloadOptions {
  requirements: PaymentRequirements;
  proof: Record<string, unknown>;
  publicSignals: string[];
  nonce: string;
  responseKey: string;
  resource?: ResourceInfo;
  extensions?: Record<string, unknown>;
}

export function buildPaymentPayload(options: PaymentPayloadOptions): PaymentPayload {
  return {
    x402Version: X402_VERSION,
    ...(options.resource ? { resource: structuredClone(options.resource) } : {}),
    accepted: structuredClone(options.requirements),
    payload: {
      proof: structuredClone(options.proof),
      publicSignals: [...options.publicSignals],
      nonce: options.nonce,
      responseKey: options.responseKey,
    },
    ...(options.extensions ? { extensions: structuredClone(options.extensions) } : {}),
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) throw new Error('Invalid Base64 header');
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export function encodeHeader(value: unknown): string {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(value)));
}

export function decodeHeader<T>(value: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(base64ToBytes(value))) as T;
  } catch {
    throw new Error('Invalid x402 Base64 JSON header');
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  throw new Error('Unsupported x402 value');
}

export function canonicalRequirementsDigest(requirements: PaymentRequirements): string { return canonical(requirements); }
export function requirementsEqual(left: PaymentRequirements, right: PaymentRequirements): boolean { return canonicalRequirementsDigest(left) === canonicalRequirementsDigest(right); }

function hasForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, item]) => FORBIDDEN_KEYS.has(key.toLowerCase()) || hasForbiddenKey(item));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Every object in the envelope carries exactly the published wire fields.
 * Anything else — an unknown field, a nested object, or an identifying label —
 * is a rejection, so no private spend metadata can ride along in an
 * unvalidated corner of the payload.
 */
function hasUnknownFields(value: unknown, allowed: ReadonlySet<string>): boolean {
  if (!isRecord(value)) return true;
  return Object.keys(value).some((key) => !allowed.has(key));
}

function hasUnknownExtension(value: unknown): boolean {
  if (value === undefined) return false;
  if (!isRecord(value)) return true;
  // The pilot advertises no extensions: any declared extension would be
  // unvalidated private spend metadata.
  return Object.keys(value).length > 0;
}

function validField(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) return false;
  try { const field = BigInt(value); return field >= 0n && field < FIELD_ORDER; }
  catch { return false; }
}

function validRequirements(requirements: PaymentRequirements): boolean {
  return requirements.scheme === ZK_PREPAID_SCHEME && requirements.network === BASE_SEPOLIA_NETWORK && requirements.amount === PRIVATE_CREDIT_AMOUNT && requirements.asset === CODING_DEEPSEEK_V4_FLASH_V1 && typeof requirements.extra?.contract === 'string' && Number.isSafeInteger(requirements.extra?.issuedAt) && requirements.extra.issuedAt >= 0;
}

export async function validateZkPrepaidPayload(payment: unknown, requirements: PaymentRequirements, expectedSignal?: string): Promise<VerificationResponse> {
  if (!validRequirements(requirements)) return { isValid: false, invalidReason: 'requirements_mismatch' };
  if (!payment || typeof payment !== 'object') return { isValid: false, invalidReason: 'invalid_payload' };
  const candidate = payment as Partial<PaymentPayload>;
  if (candidate.x402Version !== X402_VERSION || !candidate.accepted) return { isValid: false, invalidReason: 'requirements_mismatch' };
  try { if (!requirementsEqual(candidate.accepted, requirements)) return { isValid: false, invalidReason: 'requirements_mismatch' }; }
  catch { return { isValid: false, invalidReason: 'requirements_mismatch' }; }
  if (!candidate.payload || typeof candidate.payload !== 'object') return { isValid: false, invalidReason: 'invalid_payload' };
  if (hasForbiddenKey(candidate)) return { isValid: false, invalidReason: 'identifying_field' };
  if (!isRecord(candidate)) return { isValid: false, invalidReason: 'invalid_payload' };
  if (Object.keys(candidate).some((key) => !PAYMENT_KEYS.has(key))) return { isValid: false, invalidReason: 'invalid_payload_fields' };
  if (candidate.resource !== undefined && hasUnknownFields(candidate.resource, RESOURCE_KEYS)) return { isValid: false, invalidReason: 'invalid_payload_fields' };
  if (hasUnknownExtension(candidate.extensions)) return { isValid: false, invalidReason: 'invalid_payload_fields' };
  const payload = candidate.payload as Partial<ZkPrepaidPayload>;
  if (hasUnknownFields(payload, PAYLOAD_KEYS)) return { isValid: false, invalidReason: 'invalid_payload_fields' };
  if (!payload.proof || typeof payload.proof !== 'object' || Array.isArray(payload.proof) || !Array.isArray(payload.publicSignals) || payload.publicSignals.length !== 6 || !payload.publicSignals.every(validField)) return { isValid: false, invalidReason: 'invalid_public_signals' };
  if (hasUnknownFields(payload.proof, PROOF_KEYS)) return { isValid: false, invalidReason: 'invalid_payload_fields' };
  if (typeof payload.nonce !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/u.test(payload.nonce)) return { isValid: false, invalidReason: 'invalid_nonce' };
  if (typeof payload.responseKey !== 'string' || payload.responseKey.length < 8 || payload.responseKey.length > 4096) return { isValid: false, invalidReason: 'invalid_response_key' };
  if (payload.publicSignals[PUBLIC_SIGNAL_INDEX.timestamp] !== String(requirements.extra.issuedAt)) return { isValid: false, invalidReason: 'issued_at_mismatch' };
  if (expectedSignal !== undefined && (!validField(expectedSignal) || payload.publicSignals[PUBLIC_SIGNAL_INDEX.signal] !== expectedSignal)) return { isValid: false, invalidReason: 'request_signal_mismatch' };
  return { isValid: true };
}

export interface ZkPrepaidClientContext { url: string; method: string; body: unknown; requirements: PaymentRequirements; }
export interface ZkPrepaidClientOptions {
  fetch?: typeof fetch;
  createPayload: (context: ZkPrepaidClientContext) => Promise<PaymentPayload>;
  now?: () => number;
  /**
   * Optional fixed-shape exchange observer. It receives closed enums only, so
   * an operator can count lifecycle transitions without learning anything
   * about the request.
   */
  lifecycle?: ZkPrepaidLifecycleObserver;
}
export interface ZkPrepaidClient { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>; clearRequirements(url?: string): void; }

function requestUrl(input: RequestInfo | URL): string { return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url; }
function cloneInit(init?: RequestInit): RequestInit | undefined {
  if (!init) return undefined;
  if (init.body && typeof init.body !== 'string' && !(init.body instanceof Uint8Array) && !(init.body instanceof ArrayBuffer)) throw new Error('zk-prepaid client requires a replayable request body');
  return { ...init, headers: new Headers(init.headers) };
}
function setPaymentHeader(init: RequestInit | undefined, value: PaymentPayload): RequestInit { const next = cloneInit(init) ?? {}; const headers = new Headers(next.headers); headers.set(PAYMENT_SIGNATURE_HEADER, encodeHeader(value)); return { ...next, headers }; }
function issuedAtFresh(requirements: PaymentRequirements, nowMs: number): boolean { const now = Math.floor(nowMs / 1000); return requirements.extra.issuedAt >= now - 300 && requirements.extra.issuedAt <= now + 5; }
function ensureClientPayload(payment: PaymentPayload, requirements: PaymentRequirements): PaymentPayload {
  if (!requirementsEqual(payment.accepted, requirements) || payment.payload.publicSignals[PUBLIC_SIGNAL_INDEX.timestamp] !== String(requirements.extra.issuedAt)) throw new Error('zk_prepaid_payload_mismatch');
  return payment;
}

export function createZkPrepaidClient(options: ZkPrepaidClientOptions): ZkPrepaidClient {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, PaymentRequired>();
  const prefix = (method: string, url: string) => `${method.toUpperCase()}\u0000${url}\u0000`;
  const cacheKey = (method: string, url: string, requirements: PaymentRequirements) => `${prefix(method, url)}${canonicalRequirementsDigest(requirements)}`;
  const findCached = (method: string, url: string): PaymentRequirements | undefined => {
    const keyPrefix = prefix(method, url);
    for (const [key, required] of cache) {
      if (!key.startsWith(keyPrefix)) continue;
      const selected = required.accepts.find((item) => item.scheme === ZK_PREPAID_SCHEME);
      if (!selected || !issuedAtFresh(selected, now())) cache.delete(key);
      else return selected;
    }
    return undefined;
  };
  /**
   * An observer must never change an exchange, so a failing observer is
   * dropped rather than propagated into the request path.
   */
  const emit = (event: ZkPrepaidLifecycleEvent): void => {
    try { options.lifecycle?.(event); } catch { /* an observer is never an exchange error */ }
  };
  const send = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try { return await fetcher(input, init); }
    catch (error) { emit(lifecycleFailure('transport_failed')); throw error; }
  };
  const prepare = async (requirements: PaymentRequirements, context: ZkPrepaidClientContext): Promise<PaymentPayload> => {
    try {
      const payment = ensureClientPayload(await options.createPayload(context), requirements);
      emit(lifecycleStage('payment_prepared'));
      return payment;
    } catch (error) { emit(lifecycleFailure('payment_preparation_failed')); throw error; }
  };
  /** A paid exchange settles only when the response carries PAYMENT-RESPONSE. */
  const settle = (response: Response): Response => {
    if (response.status === 402) { emit(lifecycleFailure('payment_rejected')); return response; }
    if (response.headers.get(PAYMENT_RESPONSE_HEADER)) emit(lifecycleStage('settlement_confirmed'));
    else emit(lifecycleFailure('settlement_failed'));
    if (response.ok) emit(lifecycleStage('exchange_succeeded'));
    return response;
  };
  return {
    async fetch(input, init) {
      const url = requestUrl(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body ?? null;
      const cached = findCached(method, url);
      const response = cached ? await send(input, setPaymentHeader(init, await prepare(cached, { url, method, body, requirements: cached }))) : await send(input, cloneInit(init));
      if (response.status !== 402) return cached ? settle(response) : response;
      if (cached) emit(lifecycleFailure('payment_rejected'));
      const encoded = response.headers.get(PAYMENT_REQUIRED_HEADER);
      if (!encoded) { emit(lifecycleFailure('challenge_unsupported')); return response; }
      let required: PaymentRequired;
      try { required = decodeHeader<PaymentRequired>(encoded); }
      catch (error) { emit(lifecycleFailure('challenge_unreadable')); throw error; }
      const accepted = required.accepts?.find((item) => item.scheme === ZK_PREPAID_SCHEME);
      if (required.x402Version !== X402_VERSION || !accepted) { emit(lifecycleFailure('challenge_unsupported')); return response; }
      if (!issuedAtFresh(accepted, now())) { emit(lifecycleFailure('challenge_stale')); return response; }
      emit(lifecycleStage('challenge_received'));
      const keyPrefix = prefix(method, url);
      for (const key of cache.keys()) if (key.startsWith(keyPrefix)) cache.delete(key);
      cache.set(cacheKey(method, url, accepted), { ...required, accepts: [structuredClone(accepted)] });
      const payment = await prepare(accepted, { url, method, body, requirements: accepted });
      return settle(await send(input, setPaymentHeader(init, payment)));
    },
    clearRequirements(url) { if (!url) cache.clear(); else for (const key of cache.keys()) if (key.split('\u0000')[1] === url) cache.delete(key); },
  };
}

export interface ResourceServerRequest { url: string; paymentHeader?: string | null; }
export interface ResourceServerResult { authorized: boolean; status: 200 | 402; paymentRequired?: PaymentRequired; paymentResponse?: SettlementResponse; payment?: PaymentPayload; invalidReason?: string; }
export interface ZkPrepaidResourceServerOptions { requirements: PaymentRequirements; verify: (payment: PaymentPayload, requirements: PaymentRequirements) => Promise<VerificationResponse>; settle: (payment: PaymentPayload, requirements: PaymentRequirements) => Promise<SettlementResponse>; }

/** Framework-neutral manual adapter retained for the existing gateway routes. */
export function createZkPrepaidResourceServer(options: ZkPrepaidResourceServerOptions) {
  return {
    async handle(request: ResourceServerRequest): Promise<ResourceServerResult> {
      if (!request.paymentHeader) return { authorized: false, status: 402, paymentRequired: buildPaymentRequired(request.url, options.requirements) };
      let payment: PaymentPayload;
      try { payment = decodeHeader<PaymentPayload>(request.paymentHeader); }
      catch { return { authorized: false, status: 402, paymentRequired: buildPaymentRequired(request.url, options.requirements, 'invalid_payment_payload'), invalidReason: 'invalid_payment_payload' }; }
      const verified = await options.verify(payment, options.requirements);
      if (!verified.isValid) return { authorized: false, status: 402, paymentRequired: buildPaymentRequired(request.url, options.requirements, verified.invalidReason), invalidReason: verified.invalidReason };
      const settled = await options.settle(payment, options.requirements);
      if (!settled.success) return { authorized: false, status: 402, paymentRequired: buildPaymentRequired(request.url, options.requirements, settled.errorReason), invalidReason: settled.errorReason };
      return { authorized: true, status: 200, paymentResponse: settled, payment };
    },
  };
}

export type ClaimState = 'reserved' | 'ready' | 'committed' | 'cancelled';

export interface ClaimFence {
  reservationId: string;
  generation: number;
  fencingToken: string;
}

export interface ClaimRecord extends ClaimFence {
  nullifier: string;
  signalHash: string;
  state: ClaimState;
  createdAt: number;
  updatedAt: number;
  leaseExpiresAt: number;
  dispatchCount: number;
  encryptedReplay?: string;
  replayExpiresAt?: number;
  dispatchIdempotencyKey?: string;
  commitIdempotencyKey?: string;
}

export interface ClaimReservation {
  kind: 'new' | 'existing';
  record: ClaimRecord;
}

/**
 * Public spend-plane lifecycle. Every mutating operation carries the fence
 * returned by reserve; a stale worker can therefore never mutate a takeover.
 */
export interface ClaimStore {
  reserve(nullifier: string, signalHash: string, now?: number): Promise<ClaimReservation>;
  beginDispatch(fence: ClaimFence, idempotencyKey: string, now?: number): Promise<ClaimRecord>;
  stageReady(fence: ClaimFence, encryptedReplay: string, now?: number): Promise<ClaimRecord>;
  commit(fence: ClaimFence, idempotencyKey: string, now?: number): Promise<ClaimRecord>;
  cancel(fence: ClaimFence, now?: number): Promise<ClaimRecord>;
  resetDispatchBudget(fence: ClaimFence, operatorToken: string, now?: number): Promise<ClaimRecord>;
  lookup(nullifier: string, signalHash?: string, now?: number): Promise<ClaimRecord | undefined>;
  lookupByReservation(reservationId: string, now?: number): Promise<ClaimRecord | undefined>;
  /** Read-only compatibility alias; mutating callers must use a fence. */
  get(nullifier: string, now?: number): Promise<ClaimRecord | undefined>;
  expireReservations(before: number): Promise<number>;
}

const CLAIM_REPLAY_TTL_MS = 24 * 60 * 60 * 1000;
const CLAIM_LEASE_MS = 5 * 60 * 1000;
const MAX_DISPATCH_COUNT = 2;

function cloneClaim(record: ClaimRecord): ClaimRecord {
  return { ...record };
}

function newFence(previous: ClaimRecord | undefined): ClaimFence {
  return {
    reservationId: crypto.randomUUID(),
    generation: (previous?.generation ?? 0) + 1,
    fencingToken: crypto.randomUUID(),
  };
}

function fenceMatches(record: ClaimRecord, fence: ClaimFence): boolean {
  return record.reservationId === fence.reservationId
    && record.generation === fence.generation
    && record.fencingToken === fence.fencingToken;
}

function findByFence(records: Map<string, ClaimRecord>, fence: ClaimFence): ClaimRecord {
  const record = [...records.values()].find((candidate) => fenceMatches(candidate, fence));
  if (!record) throw new Error('stale_fence');
  return record;
}

function enforceReplayExpiry(record: ClaimRecord, now: number): void {
  if (record.replayExpiresAt !== undefined && record.replayExpiresAt <= now) {
    delete record.encryptedReplay;
    delete record.replayExpiresAt;
  }
}

export interface InMemoryClaimStoreOptions {
  operatorToken?: string;
}

export class InMemoryClaimStore implements ClaimStore {
  private readonly records = new Map<string, ClaimRecord>();
  private readonly operatorToken: string;

  constructor(options: InMemoryClaimStoreOptions = {}) {
    this.operatorToken = options.operatorToken ?? 'operator-only';
  }

  async reserve(nullifier: string, signalHash: string, now = Date.now()): Promise<ClaimReservation> {
    const current = this.records.get(nullifier);
    if (current) {
      enforceReplayExpiry(current, now);
      if (current.signalHash !== signalHash) throw new Error('conflicting_signal');
      const takeover = (current.state === 'cancelled' && current.dispatchCount < MAX_DISPATCH_COUNT)
        || (current.state === 'reserved' && current.leaseExpiresAt <= now && current.dispatchCount < MAX_DISPATCH_COUNT);
      if (takeover) {
        const fence = newFence(current);
        const record: ClaimRecord = {
          ...current,
          ...fence,
          state: 'reserved',
          updatedAt: now,
          leaseExpiresAt: now + CLAIM_LEASE_MS,
          encryptedReplay: undefined,
          replayExpiresAt: undefined,
          dispatchIdempotencyKey: undefined,
          commitIdempotencyKey: undefined,
        };
        this.records.set(nullifier, record);
        return { kind: 'new', record: cloneClaim(record) };
      }
      return { kind: 'existing', record: cloneClaim(current) };
    }
    const fence = newFence(undefined);
    const record: ClaimRecord = {
      ...fence,
      nullifier,
      signalHash,
      state: 'reserved',
      createdAt: now,
      updatedAt: now,
      leaseExpiresAt: now + CLAIM_LEASE_MS,
      dispatchCount: 0,
    };
    this.records.set(nullifier, record);
    return { kind: 'new', record: cloneClaim(record) };
  }

  async beginDispatch(fence: ClaimFence, idempotencyKey: string, now = Date.now()): Promise<ClaimRecord> {
    const record = findByFence(this.records, fence);
    if (record.state !== 'reserved') {
      if (record.dispatchIdempotencyKey === idempotencyKey && (record.state === 'ready' || record.state === 'committed')) return cloneClaim(record);
      throw new Error(record.state === 'cancelled' ? 'claim_cancelled' : 'claim_not_dispatchable');
    }
    if (record.leaseExpiresAt <= now) throw new Error('reservation_lease_expired');
    if (record.dispatchIdempotencyKey === idempotencyKey) return cloneClaim(record);
    if (record.dispatchIdempotencyKey) throw new Error('dispatch_in_progress');
    if (record.dispatchCount >= MAX_DISPATCH_COUNT) throw new Error('dispatch_budget_exhausted');
    record.dispatchCount += 1;
    record.dispatchIdempotencyKey = idempotencyKey;
    record.updatedAt = now;
    record.leaseExpiresAt = now + CLAIM_LEASE_MS;
    return cloneClaim(record);
  }

  async stageReady(fence: ClaimFence, encryptedReplay: string, now = Date.now()): Promise<ClaimRecord> {
    const record = findByFence(this.records, fence);
    if (record.state === 'ready' || record.state === 'committed') {
      if (record.encryptedReplay !== encryptedReplay) throw new Error('idempotency_conflict');
      return cloneClaim(record);
    }
    if (record.state !== 'reserved') throw new Error('claim_not_stageable');
    if (record.leaseExpiresAt <= now) throw new Error('reservation_lease_expired');
    if (!record.dispatchIdempotencyKey) throw new Error('dispatch_not_started');
    record.state = 'ready';
    record.encryptedReplay = encryptedReplay;
    record.replayExpiresAt = now + CLAIM_REPLAY_TTL_MS;
    record.updatedAt = now;
    return cloneClaim(record);
  }

  async commit(fence: ClaimFence, idempotencyKey: string, now = Date.now()): Promise<ClaimRecord> {
    const record = findByFence(this.records, fence);
    if (record.state === 'committed') {
      if (record.commitIdempotencyKey && record.commitIdempotencyKey !== idempotencyKey) throw new Error('idempotency_conflict');
      return cloneClaim(record);
    }
    if (record.state !== 'ready') throw new Error(record.state === 'cancelled' ? 'claim_cancelled' : 'commit_requires_ready');
    record.state = 'committed';
    record.commitIdempotencyKey = idempotencyKey;
    record.updatedAt = now;
    return cloneClaim(record);
  }

  async cancel(fence: ClaimFence, now = Date.now()): Promise<ClaimRecord> {
    const record = findByFence(this.records, fence);
    if (record.state === 'cancelled') return cloneClaim(record);
    if (record.state !== 'reserved') throw new Error('claim_not_cancellable');
    if (record.leaseExpiresAt <= now) throw new Error('reservation_lease_expired');
    record.state = 'cancelled';
    record.updatedAt = now;
    return cloneClaim(record);
  }

  async resetDispatchBudget(fence: ClaimFence, operatorToken: string, now = Date.now()): Promise<ClaimRecord> {
    if (operatorToken !== this.operatorToken) throw new Error('operator_auth_required');
    const record = findByFence(this.records, fence);
    if (record.state === 'ready' || record.state === 'committed') throw new Error('claim_already_ready');
    const nextFence = newFence(record);
    const reset: ClaimRecord = {
      ...record,
      ...nextFence,
      state: 'cancelled',
      dispatchCount: 0,
      dispatchIdempotencyKey: undefined,
      commitIdempotencyKey: undefined,
      encryptedReplay: undefined,
      replayExpiresAt: undefined,
      updatedAt: now,
      leaseExpiresAt: now + CLAIM_LEASE_MS,
    };
    this.records.set(record.nullifier, reset);
    return cloneClaim(reset);
  }

  async lookup(nullifier: string, signalHash?: string, now = Date.now()): Promise<ClaimRecord | undefined> {
    const record = this.records.get(nullifier);
    if (!record) return undefined;
    enforceReplayExpiry(record, now);
    if (signalHash !== undefined && record.signalHash !== signalHash) throw new Error('conflicting_signal');
    return cloneClaim(record);
  }

  async get(nullifier: string, now = Date.now()): Promise<ClaimRecord | undefined> {
    return this.lookup(nullifier, undefined, now);
  }

  async lookupByReservation(reservationId: string, now = Date.now()): Promise<ClaimRecord | undefined> {
    const record = [...this.records.values()].find((candidate) => candidate.reservationId === reservationId);
    if (!record) return undefined;
    enforceReplayExpiry(record, now);
    return cloneClaim(record);
  }

  async expireReservations(before: number): Promise<number> {
    let count = 0;
    for (const record of this.records.values()) {
      if (record.state === 'reserved' && record.leaseExpiresAt <= before) {
        record.state = 'cancelled';
        record.updatedAt = before;
        count += 1;
      }
    }
    return count;
  }
}

export interface ZkPrepaidFacilitatorOptions { claimStore?: ClaimStore; verifyProof?: (payment: PaymentPayload, requirements: PaymentRequirements) => Promise<VerificationResponse>; hashSignal?: (payment: PaymentPayload) => string; now?: () => number; }
function phaseOf(payment: PaymentPayload): 'before-handler' | 'after-handler' | 'cancel' | undefined { return (payment.payload as unknown as Record<PropertyKey, unknown>)[SETTLEMENT_PHASE] as 'before-handler' | 'after-handler' | 'cancel' | undefined; }

const SAFE_SETTLEMENT_ERRORS = new Set([
  'conflicting_signal',
  'stale_fence',
  'claim_cancelled',
  'claim_not_dispatchable',
  'dispatch_in_progress',
  'dispatch_budget_exhausted',
  'reservation_lease_expired',
  'dispatch_not_started',
  'claim_not_stageable',
  'idempotency_conflict',
  'commit_requires_ready',
  'claim_not_cancellable',
  'claim_already_ready',
  'operator_auth_required',
  'reservation_not_found',
  'claim_not_found_after_reservation',
  'invalid_public_signals',
  'verification_failed',
  'zk_prepaid_payload_mismatch',
  'zk_prepaid_requirements_mismatch',
]);

function safeSettlementError(error: unknown, fallback = 'claim_store_unavailable'): string {
  const code = error instanceof Error ? error.message : '';
  return SAFE_SETTLEMENT_ERRORS.has(code) ? code : fallback;
}

export function createZkPrepaidFacilitator(options: ZkPrepaidFacilitatorOptions = {}) {
  const claimStore = options.claimStore ?? new InMemoryClaimStore(); const now = options.now ?? Date.now; const hashSignal = options.hashSignal ?? ((payment) => encodeHeader(payment.payload.publicSignals[PUBLIC_SIGNAL_INDEX.signal]));
  const idempotencyKey = (record: ClaimRecord, phase: string): string => `${record.nullifier}:${record.signalHash}:${record.generation}:${phase}`;
  const fenceOf = (record: ClaimRecord): ClaimFence => ({ reservationId: record.reservationId, generation: record.generation, fencingToken: record.fencingToken });
  const verify = async (payment: PaymentPayload, requirements: PaymentRequirements, expectedSignal?: string): Promise<VerificationResponse> => { const suppliedSignal = payment?.payload?.publicSignals?.[PUBLIC_SIGNAL_INDEX.signal]; if (typeof suppliedSignal !== 'string') return { isValid: false, invalidReason: 'invalid_public_signals' }; const structural = await validateZkPrepaidPayload(payment, requirements, expectedSignal ?? suppliedSignal); if (!structural.isValid) return structural; return options.verifyProof ? options.verifyProof(payment, requirements) : { isValid: true }; };
  const failure = (network: Network, errorReason: string): SettlementResponse => ({ success: false, transaction: '', network, errorReason });
  return {
    supported(): SupportedResponse { return { kinds: [{ x402Version: X402_VERSION, scheme: ZK_PREPAID_SCHEME, network: BASE_SEPOLIA_NETWORK, extra: { assetTransferMethod: 'prepaid-claim', paymentFlow: 'escrow', requirementsVersion: 'zk-prepaid-v1' } }], extensions: [], signers: {} }; },
    verify,
    async settle(payment: PaymentPayload, requirements: PaymentRequirements, _context?: FacilitatorContext): Promise<SettlementResponse> {
      const phase = phaseOf(payment) ?? 'before-handler'; const nullifier = payment?.payload?.publicSignals?.[PUBLIC_SIGNAL_INDEX.nullifier]; if (typeof nullifier !== 'string') return failure(requirements.network, 'invalid_public_signals');
      const signal = hashSignal(payment);
      if (phase === 'before-handler') { const checked = await verify(payment, requirements); if (!checked.isValid) return failure(requirements.network, checked.invalidReason ?? 'verification_failed'); try { const reservation = await claimStore.reserve(nullifier, signal, now()); if (reservation.record.state === 'cancelled') return failure(requirements.network, 'reservation_cancelled'); return { success: true, transaction: '', network: requirements.network, reservationId: reservation.record.reservationId }; } catch (error) { return failure(requirements.network, safeSettlementError(error)); } }
      let record: ClaimRecord | undefined;
      try { record = await claimStore.lookup(nullifier, signal, now()); }
      catch (error) { return failure(requirements.network, safeSettlementError(error)); }
      if (!record) return failure(requirements.network, 'reservation_not_found');
      try {
        if (phase === 'cancel') {
          const updated = await claimStore.cancel(fenceOf(record), now());
          return { success: true, transaction: '', network: requirements.network, reservationId: updated.reservationId };
        }
        const dispatch = record.state === 'reserved'
          ? await claimStore.beginDispatch(fenceOf(record), idempotencyKey(record, 'dispatch'), now())
          : record;
        const ready = dispatch.state === 'ready' || dispatch.state === 'committed'
          ? dispatch
          : await claimStore.stageReady(fenceOf(dispatch), '', now());
        const updated = await claimStore.commit(fenceOf(ready), idempotencyKey(ready, 'commit'), now());
        return { success: true, transaction: '', network: requirements.network, reservationId: updated.reservationId };
      } catch (error) { return failure(requirements.network, safeSettlementError(error)); }
    },
    async commit(reservationId: string, network: Network = BASE_SEPOLIA_NETWORK): Promise<SettlementResponse> {
      try {
        const record = await claimStore.lookupByReservation(reservationId, now());
        if (!record) return failure(network, 'reservation_not_found');
        const dispatch = record.state === 'reserved'
          ? await claimStore.beginDispatch(fenceOf(record), idempotencyKey(record, 'dispatch'), now())
          : record;
        const ready = dispatch.state === 'ready' || dispatch.state === 'committed'
          ? dispatch
          : await claimStore.stageReady(fenceOf(dispatch), '', now());
        const updated = await claimStore.commit(fenceOf(ready), idempotencyKey(ready, 'commit'), now());
        return { success: true, transaction: '', network, reservationId: updated.reservationId };
      } catch (error) { return failure(network, safeSettlementError(error)); }
    },
    async cancel(reservationId: string, network: Network = BASE_SEPOLIA_NETWORK): Promise<SettlementResponse> {
      try {
        const record = await claimStore.lookupByReservation(reservationId, now());
        if (!record) return failure(network, 'reservation_not_found');
        const updated = await claimStore.cancel(fenceOf(record), now());
        return { success: true, transaction: '', network, reservationId: updated.reservationId };
      } catch (error) { return failure(network, safeSettlementError(error)); }
    },
    claimStore,
  };
}

// Public aliases preserve the package's old names while now referring to the published @x402/core v2 contracts.
export type OfficialX402PaymentRequirements = CorePaymentRequirements;
export type OfficialX402SupportedKind = SupportedKind;
export type OfficialX402PaymentPayload = CorePaymentPayload;
export type OfficialX402PaymentPayloadContext = PaymentPayloadContext;
export type OfficialX402SchemeServer = SchemeNetworkServer;
export type OfficialX402SchemeClient = SchemeNetworkClient;
export type OfficialX402SchemeFacilitator = SchemeNetworkFacilitator;

function asOfficialRequirements(value: CorePaymentRequirements): PaymentRequirements { if (value.scheme !== ZK_PREPAID_SCHEME || value.network !== BASE_SEPOLIA_NETWORK || value.amount !== PRIVATE_CREDIT_AMOUNT || value.asset !== CODING_DEEPSEEK_V4_FLASH_V1 || !value.extra || typeof value.extra !== 'object') throw new Error('zk_prepaid_requirements_mismatch'); return value as unknown as PaymentRequirements; }
function asOfficialPayment(value: CorePaymentPayload): PaymentPayload { if (value.x402Version !== X402_VERSION || !value.accepted || !value.payload || typeof value.payload !== 'object') throw new Error('zk_prepaid_payload_mismatch'); return value as unknown as PaymentPayload; }

export function asOfficialX402SchemeServer(configuredRequirements: PaymentRequirements): OfficialX402SchemeServer {
  const configured = structuredClone(configuredRequirements);
  return {
    scheme: ZK_PREPAID_SCHEME,
    defaultAssetTransferMethod: 'prepaid-claim',
    paymentFlows: { 'prepaid-claim': { supported: ['escrow'], default: 'escrow' } },
    parsePrice: async (price: Price, network: Network): Promise<AssetAmount> => { if (network !== BASE_SEPOLIA_NETWORK) throw new Error(`zk-prepaid is not enabled on ${network}`); const requested = typeof price === 'object' && price !== null ? price.amount : price; if (requested !== undefined && String(requested) !== PRIVATE_CREDIT_AMOUNT) throw new Error('zk_prepaid_price_must_be_one_credit'); return { amount: PRIVATE_CREDIT_AMOUNT, asset: CODING_DEEPSEEK_V4_FLASH_V1, extra: structuredClone(configured.extra) }; },
    enrichSettlementPayload: async (context: SettleContext) => ({ [SETTLEMENT_PHASE]: context.phase } as unknown as Record<string, unknown>),
    settleOnCancel: async (_context) => structuredClone(configured),
    enhancePaymentRequirements: async (requirements) => { if (requirements.scheme !== ZK_PREPAID_SCHEME || requirements.network !== configured.network || requirements.asset !== CODING_DEEPSEEK_V4_FLASH_V1 || requirements.payTo !== configured.payTo) throw new Error('zk_prepaid_requirements_mismatch'); return { ...requirements, amount: PRIVATE_CREDIT_AMOUNT, extra: structuredClone(configured.extra) }; },
    getAssetDecimals: () => 0,
  };
}

export function asOfficialX402SchemeClient(proofFactory: (context: { requirements: PaymentRequirements; x402Version: number; extensions?: Record<string, unknown>; maxAmountPerPayment?: string }) => Promise<PaymentPayload>): OfficialX402SchemeClient {
  return { scheme: ZK_PREPAID_SCHEME, async createPaymentPayload(x402Version, requirements, context) { if (x402Version !== X402_VERSION) throw new Error('zk_prepaid_x402_version_mismatch'); const accepted = asOfficialRequirements(requirements); const payment = await proofFactory({ requirements: accepted, x402Version, extensions: context?.extensions, maxAmountPerPayment: context?.maxAmountPerPayment }); ensureClientPayload(payment, accepted); return { x402Version: payment.x402Version, payload: payment.payload, extensions: payment.extensions }; } };
}

export function asOfficialX402SchemeFacilitator(facilitator: ReturnType<typeof createZkPrepaidFacilitator>): OfficialX402SchemeFacilitator {
  return {
    scheme: ZK_PREPAID_SCHEME,
    caipFamily: 'eip155:*',
    getExtra: (network) => network === BASE_SEPOLIA_NETWORK ? { assetTransferMethod: 'prepaid-claim', paymentFlow: 'escrow', requirementsVersion: 'zk-prepaid-v1' } : undefined,
    getSigners: () => [],
    async verify(payment, requirements) { try { return await facilitator.verify(asOfficialPayment(payment), asOfficialRequirements(requirements)); } catch { return { isValid: false, invalidReason: 'zk_prepaid_payload_mismatch' }; } },
    async settle(payment, requirements, context) { try { return await facilitator.settle(asOfficialPayment(payment), asOfficialRequirements(requirements), context); } catch (error) { return { success: false, transaction: '', network: requirements.network, errorReason: safeSettlementError(error, 'zk_prepaid_settlement_failed') }; } },
  };
}

export function registerZkPrepaidClient(client: x402Client, proofFactory: Parameters<typeof asOfficialX402SchemeClient>[0]): x402Client { return client.register(BASE_SEPOLIA_NETWORK, asOfficialX402SchemeClient(proofFactory)); }
export function registerZkPrepaidResourceServer(server: x402ResourceServer, requirements: PaymentRequirements): x402ResourceServer { return server.register(BASE_SEPOLIA_NETWORK, asOfficialX402SchemeServer(requirements)); }
export function registerZkPrepaidFacilitator(facilitator: x402Facilitator, adapter: ReturnType<typeof createZkPrepaidFacilitator>): x402Facilitator { return facilitator.register(BASE_SEPOLIA_NETWORK, asOfficialX402SchemeFacilitator(adapter)); }
export function createLocalZkPrepaidFacilitatorClient(adapter: ReturnType<typeof createZkPrepaidFacilitator>): FacilitatorClient { return { verify: async (payment, requirements) => asOfficialX402SchemeFacilitator(adapter).verify(payment, requirements), settle: async (payment, requirements) => asOfficialX402SchemeFacilitator(adapter).settle(payment, requirements), getSupported: async () => adapter.supported() }; }
