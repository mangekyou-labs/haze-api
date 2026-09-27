/**
 * Canonical HTTP resource server for x402 v2's experimental zk-prepaid
 * scheme. The endpoint authorizes a prepaid private credit; it never sends a
 * per-request blockchain transaction.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import express, { type Request, type Response as ExpressResponse } from 'express';
import cors from 'cors';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  buildPaymentRequired,
  buildPaymentRequirements,
  CODING_DEEPSEEK_V4_FLASH_V1,
  createZkPrepaidFacilitator,
  decodeHeader,
  encodeHeader,
  ClaimCommitAmbiguousError,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  PUBLIC_SIGNAL_INDEX,
  isClaimLifecycleConflict,
  requirementsEqual,
  type ClaimLifecycle,
  type ClaimStore,
  type PaymentPayload,
  type PaymentRequirements,
  type SettlementResponse,
  type VerificationResponse,
} from '@zk-credits/x402-zk-prepaid';
import { deriveRequestSignal } from '@zk-credits/shared';
import { OpenRouterAdapter, type ProviderAdapter } from './providerAdapter.js';
import { claimStoreErrorCode, LocalClaimStore } from './claim-store.js';
import {
  MAX_REQUEST_BYTES,
  normalizeServiceClassRequest,
  PROVIDER_TIMEOUT_MS,
} from './service-class.js';
import {
  InvalidPauseReasonError,
  MAX_PAUSE_REASON_LENGTH,
  type LaunchControl,
} from './launch-control.js';
import type { LaunchMetrics } from './metrics.js';
import { checkReadiness } from './readiness.js';
import type { PilotInviteService } from './pilot-invites.js';
import type { PilotFundingService } from './pilot-funding.js';
import { createClaimCompletion, ClaimCompletionError, type BufferedResponse } from './claim-completion.js';

const ISSUED_AT_MAX_AGE_SECONDS = 300;
const ISSUED_AT_MAX_FUTURE_SKEW_SECONDS = 5;
const DEFAULT_CONTRACT = '0x0000000000000000000000000000000000000001';
const DEFAULT_TREASURY = '0x0000000000000000000000000000000000000002';
const DEFAULT_DOMAIN = '84532';
const FIELD_ORDER = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export interface GatewayConfig {
  contractAddress: string;
  treasuryAddress: string;
  deploymentDomain: string;
  circuitId: string;
  verifyingKeyId: string;
  requirementsVersion: string;
  publicBaseUrl?: string;
  openRouterApiKey?: string;
  network?: string;
  facilitatorServiceToken?: string;
  /** Snapshot synchronized from the immutable Base contract/event indexer. */
  currentRoot?: string;
  knownRoots?: string[];
}

export interface GatewayRootSnapshot {
  currentRoot?: string;
  knownRoots?: string[];
  /** Latest finalized block already folded into this snapshot. */
  lastScannedBlock?: bigint;
}

export interface ZkPrepaidGatewayOptions {
  config?: Partial<GatewayConfig>;
  claimStore?: ClaimStore;
  provider?: ProviderAdapter;
  verifyProof?: (payment: PaymentPayload, requirements: PaymentRequirements) => Promise<VerificationResponse>;
  now?: () => number;
  /** Used by focused tests only; production uses the configured VK. */
  allowUnverifiedProofs?: boolean;
  facilitatorServiceToken?: string;
  operatorToken?: string;
  providerTimeoutMs?: number;
  /** Reads the latest finalized root set maintained by the Base event indexer. */
  rootSnapshot?: () => GatewayRootSnapshot | Promise<GatewayRootSnapshot>;
  /** Control-plane invites; absent means the pilot endpoints fail closed. */
  pilotInvites?: PilotInviteService;
  /** Provisioning-plane detached funding; absent means the pilot endpoints fail closed. */
  pilotFunding?: PilotFundingService;
  /** Internal service token for control-plane calls. Defaults to BILLING_INTERNAL_TOKEN. */
  internalServiceToken?: string;
  /** Durable kill switch and provider-spend caps. Absent disables both gates. */
  launchControl?: LaunchControl;
  /** Bounded aggregate counters. Absent disables metric recording. */
  metrics?: LaunchMetrics;
  /** Readiness probes beyond the ones the gateway already knows. */
  readiness?: {
    database?: () => Promise<void>;
    baseHead?: () => Promise<bigint>;
    verifierAssets?: () => Promise<void>;
    maxRootLagBlocks?: bigint;
    /** Public, non-secret deployment pins and their on-chain linkage. */
    v2Compatibility?: () => Promise<Record<string, unknown>>;
  };
  /** Durable, unlinked count of claims per state. */
  claimCounts?: () => Promise<Record<string, number>>;
}

interface RequestWithRawBody extends Request {
  rawBody?: Uint8Array;
}

type ParsedPayment =
  | { kind: 'missing' }
  | { kind: 'malformed' }
  | { kind: 'valid'; payment: PaymentPayload };

class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

function gatewayConfig(options: ZkPrepaidGatewayOptions): GatewayConfig {
  const env = process.env;
  const configuredKnownRoots = env.BASE_KNOWN_ROOTS
    ?.split(',')
    .map((root) => root.trim())
    .filter(Boolean);
  return {
    contractAddress: options.config?.contractAddress ?? env.BASE_PRIVATE_CREDIT_BOND_ADDRESS ?? DEFAULT_CONTRACT,
    treasuryAddress: options.config?.treasuryAddress ?? env.BASE_TREASURY_ADDRESS ?? DEFAULT_TREASURY,
    deploymentDomain: options.config?.deploymentDomain ?? env.BASE_DEPLOYMENT_DOMAIN ?? DEFAULT_DOMAIN,
    circuitId: options.config?.circuitId ?? env.ZK_PREPAID_CIRCUIT_ID ?? 'private-credit-spend-bn254-dev',
    verifyingKeyId: options.config?.verifyingKeyId ?? env.ZK_PREPAID_VERIFYING_KEY_ID ?? 'private-credit-spend-vk-dev',
    requirementsVersion: options.config?.requirementsVersion ?? env.ZK_PREPAID_REQUIREMENTS_VERSION ?? 'zk-prepaid-v1',
    publicBaseUrl: options.config?.publicBaseUrl ?? env.PUBLIC_GATEWAY_URL,
    openRouterApiKey: options.config?.openRouterApiKey ?? env.OPENROUTER_API_KEY,
    network: options.config?.network,
    facilitatorServiceToken: options.facilitatorServiceToken
      ?? options.config?.facilitatorServiceToken
      ?? env.FACILITATOR_SERVICE_TOKEN
      ?? env.X402_FACILITATOR_SERVICE_TOKEN,
    currentRoot: options.config?.currentRoot ?? env.BASE_CURRENT_ROOT,
    knownRoots: options.config?.knownRoots ?? configuredKnownRoots,
  };
}

function paymentRequirements(config: GatewayConfig, issuedAt = Math.floor(Date.now() / 1000)): PaymentRequirements {
  return buildPaymentRequirements({
    asset: CODING_DEEPSEEK_V4_FLASH_V1,
    contract: config.contractAddress,
    payTo: config.treasuryAddress,
    deploymentDomain: config.deploymentDomain,
    circuitId: config.circuitId,
    verifyingKeyId: config.verifyingKeyId,
    requirementsVersion: config.requirementsVersion,
    network: config.network,
    issuedAt,
  });
}

function requestUrl(req: Request, config: GatewayConfig): string {
  if (config.publicBaseUrl) return `${config.publicBaseUrl.replace(/\/$/u, '')}${req.originalUrl}`;
  const forwardedProto = req.header('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProto || req.protocol || 'http';
  return `${protocol}://${req.get('host') ?? 'localhost'}${req.originalUrl}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asPaymentPayload(value: unknown): PaymentPayload | null {
  if (!isRecord(value)) return null;
  if (value.x402Version !== 2 || !isRecord(value.accepted) || !isRecord(value.payload)) return null;
  return value as unknown as PaymentPayload;
}

function parsePaymentHeader(req: Request): ParsedPayment {
  const encoded = req.header(PAYMENT_SIGNATURE_HEADER);
  if (!encoded) return { kind: 'missing' };
  try {
    const decoded = decodeHeader<unknown>(encoded);
    const payment = asPaymentPayload(decoded);
    return payment ? { kind: 'valid', payment } : { kind: 'malformed' };
  } catch {
    return { kind: 'malformed' };
  }
}

function signalHash(payment: PaymentPayload): string {
  return createHash('sha256')
    .update(payment.payload.publicSignals[PUBLIC_SIGNAL_INDEX.signal] ?? '')
    .digest('hex');
}

function normalizeField(value: string | undefined): string | null {
  if (!value || !/^(?:\d+|0x[0-9a-fA-F]{1,64})$/u.test(value)) return null;
  try {
    const field = BigInt(value);
    if (field < 0n || field >= FIELD_ORDER) return null;
    return field.toString();
  } catch {
    return null;
  }
}

async function loadGroth16Verifier(
  config: GatewayConfig,
  clock: () => number,
  readRoots: () => GatewayRootSnapshot | Promise<GatewayRootSnapshot>,
): Promise<ZkPrepaidGatewayOptions['verifyProof']> {
  const vkPath = process.env.ZK_PREPAID_VERIFYING_KEY_PATH;
  if (!vkPath) return async () => ({ isValid: false, invalidReason: 'verifier_not_configured' });
  try {
    const { groth16 } = await import('snarkjs');
    const vk = JSON.parse(await readFile(vkPath, 'utf8')) as object;
    const expectedDomain = normalizeField(config.deploymentDomain);
    return async (payment) => {
      const roots = await readRoots();
      const knownRoots = new Set(
        [...(roots.knownRoots ?? []), roots.currentRoot]
          .map((root) => normalizeField(root))
          .filter((root): root is string => root !== null),
      );
      const publicSignals = payment.payload.publicSignals;
      const root = normalizeField(publicSignals[PUBLIC_SIGNAL_INDEX.root]);
      const timestamp = normalizeField(publicSignals[PUBLIC_SIGNAL_INDEX.timestamp]);
      const domain = normalizeField(publicSignals[PUBLIC_SIGNAL_INDEX.domain]);
      if (knownRoots.size === 0) return { isValid: false, invalidReason: 'contract_root_not_configured' };
      if (!root || !knownRoots.has(root)) return { isValid: false, invalidReason: 'unknown_contract_root' };
      if (!expectedDomain || domain !== expectedDomain) return { isValid: false, invalidReason: 'deployment_domain_mismatch' };
      // The gateway window (paid path, facilitator routes) and the scheme's
      // structural check already bind this challenge. This repeats the window
      // through the same helper so the off-chain prover can never accept a
      // timestamp the resource server would reject.
      if (!timestamp || !issuedAtInWindow(BigInt(timestamp), currentSeconds(clock))) {
        return { isValid: false, invalidReason: 'stale_or_future_proof_timestamp' };
      }
      const valid = await groth16.verify(vk, payment.payload.publicSignals, payment.payload.proof);
      return valid ? { isValid: true } : { isValid: false, invalidReason: 'proof_invalid' };
    };
  } catch {
    return async () => ({ isValid: false, invalidReason: 'verifier_unavailable' });
  }
}

function bodyForSignal(req: Request): Uint8Array {
  const raw = (req as RequestWithRawBody).rawBody;
  return raw ? new Uint8Array(raw) : new Uint8Array();
}

function requirementsForAccepted(config: GatewayConfig, accepted: unknown): PaymentRequirements | undefined {
  if (!isRecord(accepted) || !isRecord(accepted.extra)) return undefined;
  const issuedAt = accepted.extra.issuedAt;
  if (!Number.isSafeInteger(issuedAt) || (issuedAt as number) < 0) return undefined;
  try {
    const expected = paymentRequirements(config, issuedAt as number);
    return requirementsEqual(accepted as PaymentRequirements, expected) ? expected : undefined;
  } catch {
    return undefined;
  }
}

function currentSeconds(clock: () => number): bigint {
  return BigInt(Math.floor(clock() / 1000));
}

/**
 * The single freshness window for a gateway challenge. The paid path, the
 * facilitator routes, and the real Groth16 verifier all read it here, so the
 * off-chain prover cannot accept a timestamp the resource server would reject.
 */
function issuedAtInWindow(issuedAt: bigint, nowSeconds: bigint): boolean {
  return issuedAt >= nowSeconds - BigInt(ISSUED_AT_MAX_AGE_SECONDS)
    && issuedAt <= nowSeconds + BigInt(ISSUED_AT_MAX_FUTURE_SKEW_SECONDS);
}

function issuedAtFresh(requirements: PaymentRequirements, clock: () => number): boolean {
  return issuedAtInWindow(BigInt(requirements.extra.issuedAt), currentSeconds(clock));
}

function sendBuffered(res: ExpressResponse, result: BufferedResponse, paymentResponse?: SettlementResponse): void {
  if (res.destroyed) return;
  if (paymentResponse) res.setHeader(PAYMENT_RESPONSE_HEADER, encodeHeader(paymentResponse));
  res.status(result.status);
  res.setHeader('Content-Type', result.contentType);
  res.end(Buffer.from(result.body));
}

function sendPaymentRequired(
  res: ExpressResponse,
  url: string,
  requirements: PaymentRequirements,
  metrics: LaunchMetrics | undefined,
  reason?: string,
): void {
  const required = buildPaymentRequired(url, requirements, reason);
  metrics?.increment('challenge_issued');
  res.setHeader(PAYMENT_REQUIRED_HEADER, encodeHeader(required));
  res.status(402).json({ error: 'payment_required' });
}

function jsonError(res: ExpressResponse, status: number, error: string): void {
  res.status(status).json({ error });
}

const PILOT_ERROR_STATUS: Record<string, number> = {
  invalid_invite_code: 400,
  invalid_invite_request: 400,
  invalid_github_account: 400,
  invalid_funding_request: 400,
  invalid_funding_token: 400,
  invalid_commitment: 400,
  invite_account_mismatch: 403,
  invite_already_redeemed: 409,
  funding_commitment_conflict: 409,
  funding_in_progress: 409,
  funding_reconciliation_pending: 409,
  invite_expired: 410,
  invite_revoked: 410,
  funding_capability_expired: 410,
  funding_unavailable: 503,
};

/** Maps pilot domain errors onto HTTP without echoing storage internals. */
function pilotError(res: ExpressResponse, error: unknown, fallback = 'pilot_request_failed'): void {
  const code = error instanceof Error ? error.message : '';
  const status = PILOT_ERROR_STATUS[code];
  if (!status) {
    jsonError(res, 500, fallback);
    return;
  }
  jsonError(res, status, code);
}

async function claimCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const code = claimStoreErrorCode(error);
    if (error instanceof ClaimCommitAmbiguousError) throw new GatewayError('claim_commit_ambiguous', 503);
    if (isClaimLifecycleConflict(code)) throw new GatewayError(code, 409);
    throw new GatewayError('claim_store_unavailable', 503);
  }
}

function settlementPhaseInjected(body: unknown): boolean {
  if (!isRecord(body)) return false;
  return ['phase', 'settlementPhase', 'settlement_phase', 'settlement-phase']
    .some((key) => Object.prototype.hasOwnProperty.call(body, key));
}

function serviceAuthorized(req: Request, token: string | undefined): boolean {
  return Boolean(token) && req.header('authorization') === `Bearer ${token}`;
}

function operationError(error: unknown): { status: number; code: string } {
  if (error instanceof GatewayError || error instanceof ClaimCompletionError) return { status: error.status, code: error.message };
  return { status: 502, code: 'provider_request_failed' };
}

/** Creates the active gateway Express application. */
export async function createZkPrepaidGateway(options: ZkPrepaidGatewayOptions = {}) {
  const config = gatewayConfig(options);
  const now = options.now ?? Date.now;
  let lastChallengeIssuedAt = Math.floor(now() / 1000) - 1;
  const freshChallenge = (): PaymentRequirements => {
    const current = Math.floor(now() / 1000);
    const issuedAt = Math.max(current, lastChallengeIssuedAt + 1);
    lastChallengeIssuedAt = issuedAt;
    return paymentRequirements(config, issuedAt);
  };
  const requirements = freshChallenge();
  const claimStore = options.claimStore ?? new LocalClaimStore({ operatorToken: options.operatorToken });
  const provider = options.provider ?? new OpenRouterAdapter();
  const providerTimeoutMs = Number.isFinite(options.providerTimeoutMs) && (options.providerTimeoutMs ?? 0) > 0
    ? Math.floor(options.providerTimeoutMs!)
    : PROVIDER_TIMEOUT_MS;
  const launchControl = options.launchControl;
  const metrics = options.metrics;
  // The real OpenRouter adapter needs a credential. An injected provider (the
  // focused-test mock) and the explicit test-only bypass do not, so readiness
  // and the dispatch gate ask the same question: can this deployment dispatch?
  const providerConfigured = options.allowUnverifiedProofs === true
    || provider.id !== 'openrouter'
    || Boolean(config.openRouterApiKey);
  const readRoots = async (): Promise<GatewayRootSnapshot> => options.rootSnapshot
    ? await options.rootSnapshot()
    : { currentRoot: config.currentRoot, knownRoots: config.knownRoots };
  const proofVerifier = options.verifyProof ?? await loadGroth16Verifier(config, now, readRoots);
  const facilitator = createZkPrepaidFacilitator({ claimStore, verifyProof: proofVerifier, now, hashSignal: signalHash });
  const claimLifecycle: ClaimLifecycle = facilitator.claimLifecycle;
  const pilotInvites = options.pilotInvites;
  const pilotFunding = options.pilotFunding;
  const claimCompletion = createClaimCompletion({
    lifecycle: claimLifecycle,
    provider,
    providerConfigured,
    providerAuth: config.openRouterApiKey ?? '',
    providerTimeoutMs,
    now,
    launchControl,
    metrics,
  });
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(cors({ origin: false }));
  app.use(express.json({
    limit: MAX_REQUEST_BYTES,
    verify: (req, _res, buf) => {
      (req as RequestWithRawBody).rawBody = new Uint8Array(buf);
    },
  }));

  /** Liveness: the process is up. Never depends on a downstream dependency. */
  app.get('/health', (_req, res) => {
    res.json({ service: 'zk-credits-gateway', status: 'ok', network: requirements.network, scheme: requirements.scheme });
  });

  /**
   * Readiness: the service can honestly accept new work. A paused launch, a
   * missing root, stale Base data, absent verifier assets, or an unconfigured
   * provider all report `503` so nothing routes new traffic to a service that
   * would fail closed anyway.
   */
  app.get('/ready', async (_req, res) => {
    try {
      const report = await checkReadiness({
        launchControl,
        database: options.readiness?.database,
        baseHead: options.readiness?.baseHead,
        verifierAssets: options.readiness?.verifierAssets,
        maxRootLagBlocks: options.readiness?.maxRootLagBlocks,
        rootSnapshot: () => readRoots(),
        providerConfigured,
      });
      let v2Compatibility: Record<string, unknown> | undefined;
      try {
        v2Compatibility = await options.readiness?.v2Compatibility?.();
      } catch {
        v2Compatibility = { status: 'failed' };
      }
      res.status(report.ready ? 200 : 503).json({
        ...report,
        ...(v2Compatibility ? { v2Compatibility } : {}),
      });
    } catch {
      res.status(503).json({ ready: false, launchControl: 'unknown', checks: [], generatedAt: new Date(now()).toISOString() });
    }
  });

  // Discovery is intentionally public. Mutating facilitator operations below
  // require a service token and never accept client-supplied settlement phase.
  app.get('/x402/facilitator/supported', (_req, res) => res.json(facilitator.supported()));

  app.post('/x402/facilitator/verify', async (req, res) => {
    try {
      const body = isRecord(req.body) ? req.body : {};
      const payment = asPaymentPayload(body.paymentPayload ?? body.payment ?? body);
      const accepted = body.paymentRequirements ?? body.requirements;
      if (!payment || !isRecord(accepted)) {
        res.json({ isValid: false, invalidReason: 'invalid_facilitator_request' });
        return;
      }
      const requestedRequirements = requirementsForAccepted(config, accepted);
      if (!requestedRequirements) {
        res.json({ isValid: false, invalidReason: 'requirements_mismatch' });
        return;
      }
      if (!issuedAtFresh(requestedRequirements, now)) {
        res.json({ isValid: false, invalidReason: 'stale_issued_at' });
        return;
      }
      res.json(await facilitator.verify(payment, requestedRequirements));
    } catch {
      res.json({ isValid: false, invalidReason: 'verification_failed' });
    }
  });

  app.post('/x402/facilitator/settle', async (req, res) => {
    if (!serviceAuthorized(req, config.facilitatorServiceToken)) {
      jsonError(res, 401, 'facilitator_service_auth_required');
      return;
    }
    if (settlementPhaseInjected(req.body)) {
      jsonError(res, 400, 'settlement_phase_forbidden');
      return;
    }
    try {
      const body = isRecord(req.body) ? req.body : {};
      const action = body.action ?? body.operation ?? 'reserve';
      if (action === 'commit' || action === 'cancel') {
        if (typeof body.reservationId !== 'string' || body.reservationId.length === 0 || body.reservationId.length > 128) {
          jsonError(res, 400, 'reservation_id_required');
          return;
        }
        const result = action === 'commit'
          ? await facilitator.commit(body.reservationId, requirements.network)
          : await facilitator.cancel(body.reservationId, requirements.network);
        res.status(result.success ? 200 : 409).json(result);
        return;
      }
      if (action !== 'reserve') {
        jsonError(res, 400, 'invalid_settlement_action');
        return;
      }
      const payment = asPaymentPayload(body.paymentPayload ?? body.payment ?? body);
      const accepted = body.paymentRequirements ?? body.requirements;
      if (!payment || !isRecord(accepted)) {
        jsonError(res, 400, 'invalid_facilitator_request');
        return;
      }
      const requestedRequirements = requirementsForAccepted(config, accepted);
      if (!requestedRequirements || !issuedAtFresh(requestedRequirements, now)) {
        jsonError(res, 402, 'invalid_or_stale_authorization');
        return;
      }
      const result = await facilitator.settle(payment, requestedRequirements);
      res.status(result.success ? 200 : result.errorReason === 'claim_store_unavailable' ? 503 : 409).json(result);
    } catch {
      jsonError(res, 503, 'claim_store_unavailable');
    }
  });

  app.post('/x402/facilitator/dispatch-budget/reset', async (req, res) => {
    if (!serviceAuthorized(req, config.facilitatorServiceToken)) {
      jsonError(res, 401, 'facilitator_service_auth_required');
      return;
    }
    const body = isRecord(req.body) ? req.body : {};
    const reservationId = body.reservationId;
    const operatorToken = req.header('x-claim-operator-token');
    if (typeof reservationId !== 'string' || !operatorToken) {
      jsonError(res, 400, 'operator_reset_fields_required');
      return;
    }
    try {
      const record = await claimCall(() => claimLifecycle.lookupByReservation(reservationId, now()));
      if (!record) { jsonError(res, 404, 'reservation_not_found'); return; }
      const updated = await claimCall(() => claimLifecycle.resetDispatchBudget(record, operatorToken, now()));
      res.json({ success: true, transaction: '', network: requirements.network, reservationId: updated.reservationId });
    } catch (error) {
      const mapped = operationError(error);
      jsonError(res, mapped.status, mapped.code === 'operator_auth_required' ? mapped.code : 'dispatch_budget_reset_failed');
    }
  });

  /**
   * Returns a client-encrypted replay for an already committed claim. The
   * endpoint never decrypts or logs the response; possession of the original
   * payment payload is required and the sidecar alone has the private key.
   */
  app.post('/x402/replay', async (req, res) => {
    const parsed = parsePaymentHeader(req);
    if (parsed.kind !== 'valid') { jsonError(res, 400, 'invalid_replay_request'); return; }
    const payment = parsed.payment;
    const accepted = requirementsForAccepted(config, payment.accepted);
    if (!accepted) { jsonError(res, 404, 'replay_not_found'); return; }
    try {
      const verified = await facilitator.verify(payment, accepted);
      if (!verified.isValid) { jsonError(res, 404, 'replay_not_found'); return; }
      const nullifier = payment.payload.publicSignals[PUBLIC_SIGNAL_INDEX.nullifier];
      if (!nullifier) { jsonError(res, 404, 'replay_not_found'); return; }
      const record = await claimCall(() => claimLifecycle.lookup(nullifier, signalHash(payment), now()));
      if (!record) {
        jsonError(res, 404, 'replay_not_found');
        return;
      }
      const disposition = claimLifecycle.classify(record);
      const encryptedReplay = record.encryptedReplay;
      if (disposition.kind !== 'committed' || !disposition.replayAvailable || !encryptedReplay) {
        jsonError(res, 404, 'replay_not_found');
        return;
      }
      res.json({ encryptedReplay });
    } catch {
      jsonError(res, 404, 'replay_not_found');
    }
  });

  app.get('/v1/contract-status', async (_req, res) => {
    const roots = await readRoots();
    res.json({
      network: requirements.network,
      contract: requirements.extra.contract,
      treasury: requirements.payTo,
      deploymentDomain: requirements.extra.deploymentDomain,
      root: roots.currentRoot ?? null,
      currentRoot: roots.currentRoot ?? null,
      knownRoots: roots.knownRoots ?? [],
      generatedAt: new Date(now()).toISOString(),
    });
  });

  /**
   * Guards control-plane calls. Real checkout and Stripe billing routes were
   * removed from the unpaid pilot runtime; only invite redemption remains.
   */
  function internalAuthorized(req: Request): boolean {
    const configured = options.internalServiceToken ?? process.env.BILLING_INTERNAL_TOKEN;
    if (!configured) return process.env.NODE_ENV !== 'production';
    return req.header('authorization') === `Bearer ${configured}`;
  }

  /**
   * The kill switch gate for new work. Funding and inference are refused while
   * paused; health, readiness, the public bundle lookup, the committed-claim
   * replay, and the authenticated admin routes stay reachable for recovery.
   */
  async function refuseWhenPaused(res: ExpressResponse): Promise<boolean> {
    if (!launchControl) return false;
    try {
      if (!(await launchControl.isPaused())) return false;
    } catch {
      // An unreadable launch state is not permission to keep spending.
      jsonError(res, 503, 'launch_control_unavailable');
      return true;
    }
    metrics?.increment('paused_rejected');
    jsonError(res, 503, 'pilot_paused');
    return true;
  }

  /** Authenticated aggregate monitoring: counts, spend headroom, Base lag. */
  app.get('/v1/admin/status', async (req, res) => {
    if (!internalAuthorized(req)) { jsonError(res, 401, 'internal_auth_required'); return; }
    try {
      const [launch, spend, roots] = await Promise.all([
        launchControl ? launchControl.status() : Promise.resolve(undefined),
        launchControl ? launchControl.spend() : Promise.resolve(undefined),
        readRoots(),
      ]);
      let lagBlocks: bigint | undefined;
      if (options.readiness?.baseHead && roots.lastScannedBlock !== undefined) {
        try {
          const head = await options.readiness.baseHead();
          lagBlocks = head > roots.lastScannedBlock ? head - roots.lastScannedBlock : 0n;
        } catch {
          lagBlocks = undefined;
        }
      }
      res.json({
        launchControl: launch
          ? { state: launch.state, reason: launch.reason, updatedAt: new Date(launch.updatedAt).toISOString() }
          : { state: 'disabled', reason: null, updatedAt: null },
        network: requirements.network,
        spend: spend
          ? {
              utcDayMicroUsd: spend.utcDayMicroUsd.toString(),
              rolling30dMicroUsd: spend.rolling30dMicroUsd.toString(),
              dailyCapMicroUsd: spend.dailyCapMicroUsd.toString(),
              rollingCapMicroUsd: spend.rollingCapMicroUsd.toString(),
              dailyHeadroomMicroUsd: spend.dailyHeadroomMicroUsd.toString(),
              rollingHeadroomMicroUsd: spend.rollingHeadroomMicroUsd.toString(),
              debits: spend.debits,
            }
          : null,
        metrics: metrics?.snapshot() ?? null,
        claims: options.claimCounts ? await options.claimCounts().catch(() => null) : null,
        base: {
          currentRoot: roots.currentRoot ?? null,
          knownRootCount: (roots.knownRoots ?? []).length,
          lastScannedBlock: roots.lastScannedBlock?.toString() ?? null,
          lagBlocks: lagBlocks?.toString() ?? null,
        },
        // Proving happens only inside an operator's sidecar, so the gateway has
        // no latency to report. Aggregate hot-prove time is participant-reported
        // through the weekly export and is never derived here.
        provingLatency: { source: 'participant-reported', value: null },
        generatedAt: new Date(now()).toISOString(),
      });
    } catch {
      jsonError(res, 503, 'launch_control_unavailable');
    }
  });

  /** Checks a public Merkle root against the gateway's current known-root set without returning roots. */
  app.post('/v1/admin/root-known', async (req, res) => {
    if (!internalAuthorized(req)) { jsonError(res, 401, 'internal_auth_required'); return; }
    const body = isRecord(req.body) ? req.body : {};
    const requestedRoot = normalizeField(typeof body.root === 'string' ? body.root : undefined);
    if (!requestedRoot) { jsonError(res, 400, 'invalid_root'); return; }
    try {
      const roots = await readRoots();
      const knownRoots = new Set(
        [...(roots.knownRoots ?? []), roots.currentRoot]
          .map((root) => normalizeField(root))
          .filter((root): root is string => root !== null),
      );
      res.json({ known: knownRoots.has(requestedRoot) });
    } catch {
      jsonError(res, 503, 'root_index_unavailable');
    }
  });

  app.post('/v1/admin/pause', async (req, res) => {
    if (!internalAuthorized(req)) { jsonError(res, 401, 'internal_auth_required'); return; }
    if (!launchControl) { jsonError(res, 503, 'launch_control_unavailable'); return; }
    const body = isRecord(req.body) ? req.body : {};
    const reason = typeof body.reason === 'string' ? body.reason : '';
    if (reason.trim().length === 0 || reason.trim().length > MAX_PAUSE_REASON_LENGTH) {
      jsonError(res, 400, 'invalid_pause_reason');
      return;
    }
    try {
      const status = await launchControl.pause(reason);
      res.json({ state: status.state, reason: status.reason, updatedAt: new Date(status.updatedAt).toISOString() });
    } catch (error) {
      jsonError(res, 503, error instanceof InvalidPauseReasonError ? 'invalid_pause_reason' : 'launch_control_unavailable');
    }
  });

  app.post('/v1/admin/resume', async (req, res) => {
    if (!internalAuthorized(req)) { jsonError(res, 401, 'internal_auth_required'); return; }
    if (!launchControl) { jsonError(res, 503, 'launch_control_unavailable'); return; }
    try {
      const status = await launchControl.resume();
      res.json({ state: status.state, reason: status.reason, updatedAt: new Date(status.updatedAt).toISOString() });
    } catch {
      jsonError(res, 503, 'launch_control_unavailable');
    }
  });

  /**
   * Internal control-plane redemption. The GitHub account is supplied by the
   * authenticated web session, never by the browser, and the response carries
   * a one-time detached funding token instead of any credential material.
   */
  app.post('/v1/pilot/invites/redeem', async (req, res) => {
    if (!internalAuthorized(req)) { jsonError(res, 401, 'internal_auth_required'); return; }
    if (await refuseWhenPaused(res)) return;
    if (!pilotInvites) { jsonError(res, 503, 'pilot_store_unavailable'); return; }
    const body = isRecord(req.body) ? req.body : {};
    if (typeof body.code !== 'string' || typeof body.githubAccountId !== 'string') {
      jsonError(res, 400, 'invalid_invite_request');
      return;
    }
    try {
      const redeemed = await pilotInvites.redeem({ code: body.code, githubAccountId: body.githubAccountId });
      res.json({ fundingToken: redeemed.fundingToken, expiresAt: redeemed.expiresAt });
    } catch (error) {
      pilotError(res, error);
    }
  });

  /**
   * Sessionless detached funding. The capability token in the body is the only
   * authorization: the endpoint accepts no session, no cookie, and no account
   * identifier, and it never receives a GitHub identity.
   */
  app.post('/v1/pilot/funding', async (req, res) => {
    if (await refuseWhenPaused(res)) return;
    if (!pilotFunding) { jsonError(res, 503, 'pilot_store_unavailable'); return; }
    const body = isRecord(req.body) ? req.body : {};
    if (typeof body.fundingToken !== 'string' || typeof body.commitment !== 'string') {
      jsonError(res, 400, 'invalid_funding_request');
      return;
    }
    try {
      res.json(await pilotFunding.fund({ fundingToken: body.fundingToken, commitment: body.commitment }));
    } catch (error) {
      pilotError(res, error, 'funding_failed');
    }
  });

  /** Public recovery lookup: immutable funding metadata for one commitment. */
  app.get('/v1/pilot/bundles/:commitment', async (req, res) => {
    if (!pilotFunding) { jsonError(res, 503, 'pilot_store_unavailable'); return; }
    try {
      const bundle = await pilotFunding.lookupByCommitment(req.params.commitment);
      if (!bundle) { jsonError(res, 404, 'bundle_not_found'); return; }
      res.json(bundle);
    } catch (error) {
      pilotError(res, error);
    }
  });

  const handleCompletion = async (req: Request, res: ExpressResponse): Promise<void> => {
    // The kill switch is checked first: a paused pilot refuses new inference
    // before any challenge, reservation, or provider cost exists.
    if (await refuseWhenPaused(res)) return;

    const normalized = normalizeServiceClassRequest(req.body);
    if (!normalized.ok) {
      metrics?.increment('request_rejected');
      jsonError(res, 400, normalized.error);
      return;
    }

    const url = requestUrl(req, config);
    const parsed = parsePaymentHeader(req);
    if (parsed.kind === 'missing') {
      sendPaymentRequired(res, url, freshChallenge(), metrics);
      return;
    }
    if (parsed.kind === 'malformed') {
      jsonError(res, 400, 'malformed_payment_envelope');
      return;
    }
    const payment = parsed.payment;
    const candidateRequirements = requirementsForAccepted(config, payment.accepted);
    if (!candidateRequirements || !issuedAtFresh(candidateRequirements, now)) {
      sendPaymentRequired(res, url, freshChallenge(), metrics, 'invalid_or_stale_authorization');
      return;
    }

    let expectedSignal: string;
    try {
      expectedSignal = (await deriveRequestSignal({
        method: req.method,
        url,
        body: bodyForSignal(req),
        requirements: candidateRequirements,
        nonce: payment.payload.nonce,
        responseKey: payment.payload.responseKey,
      })).field;
    } catch {
      sendPaymentRequired(res, url, freshChallenge(), metrics, 'invalid_request_binding');
      return;
    }

    let structural: VerificationResponse;
    try {
      structural = await facilitator.verify(payment, candidateRequirements, expectedSignal);
    } catch {
      structural = { isValid: false, invalidReason: 'verification_failed' };
    }
    if (!structural.isValid) {
      metrics?.increment('proof_invalid');
      sendPaymentRequired(res, url, freshChallenge(), metrics, structural.invalidReason);
      return;
    }
    metrics?.increment('proof_valid');

    const nullifier = payment.payload.publicSignals[PUBLIC_SIGNAL_INDEX.nullifier]!;
    const hash = signalHash(payment);
    const paymentResponse: SettlementResponse = { success: true, transaction: '', network: candidateRequirements.network };
    try {
      const result = await claimCompletion.complete({ payment, nullifier, signalHash: hash, request: normalized.request });
      if (result.kind === 'response') {
        sendBuffered(res, result.response, paymentResponse);
      } else if (result.kind === 'payment_required') {
        sendPaymentRequired(res, url, freshChallenge(), metrics, result.reason);
      } else if (result.kind === 'committed') {
        res.setHeader(PAYMENT_RESPONSE_HEADER, encodeHeader(paymentResponse));
        if (result.encryptedReplay) {
          res.status(409).json({ error: 'claim_already_committed', replay: true, encryptedReplay: result.encryptedReplay });
        } else {
          res.status(409).json({ error: 'claim_already_committed', replay: false });
        }
      } else {
        jsonError(res, 409, result.code);
      }
    } catch (error) {
      const mapped = operationError(error);
      if (res.headersSent || res.destroyed) {
        if (!res.destroyed) res.destroy();
      } else {
        jsonError(res, mapped.status, mapped.code);
      }
    }
  };

  app.post('/v1/chat/completions', handleCompletion);
  app.post('/v1/responses', (req, res) => jsonError(res, 400, 'unsupported_endpoint'));

  app.use((_req, res) => jsonError(res, 404, 'not_found'));
  app.use((error: unknown, _req: Request, res: ExpressResponse, _next: (error?: unknown) => void) => {
    const parserError = error as { type?: string };
    if (parserError.type === 'entity.too.large') {
      jsonError(res, 400, 'request_too_large');
      return;
    }
    jsonError(res, 400, 'malformed_json');
  });
  return { app, requirements, claimStore };
}
