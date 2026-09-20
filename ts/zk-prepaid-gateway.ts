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
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  PUBLIC_SIGNAL_INDEX,
  requirementsEqual,
  type ClaimStore,
  type PaymentPayload,
  type PaymentRequirements,
  type SettlementResponse,
  type VerificationResponse,
} from '@zk-credits/x402-zk-prepaid';
import { deriveRequestSignal } from '@zk-credits/shared';
import { OpenRouterAdapter, type ProviderAdapter, type ProviderEndpoint } from './providerAdapter.js';
import { encryptResponseReplay, MAX_REPLAY_BYTES } from './response-replay.js';
import { LocalClaimStore } from './claim-store.js';
import { StripeBillingService, type TierId } from './stripe-billing.js';
import { MemoryWalletLinkStore, type WalletLinkStore } from './wallet-links.js';

const MAX_REQUEST_BYTES = 2_000_000;
const MAX_UPSTREAM_BYTES = 32 * 1024 * 1024;
const DEFAULT_CONTRACT = '0x0000000000000000000000000000000000000001';
const DEFAULT_TREASURY = '0x0000000000000000000000000000000000000002';
const DEFAULT_DOMAIN = '84532';

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
  /** Snapshot synchronized from the immutable Base contract/event indexer. */
  currentRoot?: string;
  knownRoots?: string[];
}

export interface GatewayRootSnapshot {
  currentRoot?: string;
  knownRoots?: string[];
}

export interface ZkPrepaidGatewayOptions {
  config?: Partial<GatewayConfig>;
  claimStore?: ClaimStore;
  provider?: ProviderAdapter;
  verifyProof?: (payment: PaymentPayload, requirements: PaymentRequirements) => Promise<VerificationResponse>;
  now?: () => number;
  /** Used by focused tests only; production uses the configured VK. */
  allowUnverifiedProofs?: boolean;
  billing?: StripeBillingService;
  walletLinks?: WalletLinkStore;
  /** Reads the latest finalized root set maintained by the Base event indexer. */
  rootSnapshot?: () => GatewayRootSnapshot | Promise<GatewayRootSnapshot>;
}

interface BufferedResponse {
  status: number;
  contentType: string;
  body: Uint8Array;
}

interface StreamDispatch {
  status: number;
  contentType: string;
  body?: ReadableStream<Uint8Array>;
  buffered: Promise<BufferedResponse>;
}

interface ReservationContext {
  payment: PaymentPayload;
  requirements: PaymentRequirements;
  nullifier: string;
  signalHash: string;
  reservationId: string;
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

function asPaymentPayload(value: unknown): PaymentPayload | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Partial<PaymentPayload>;
  if (payload.x402Version !== 2 || !payload.accepted || !payload.payload) return null;
  return payload as PaymentPayload;
}

function parsePaymentHeader(req: Request): PaymentPayload | null {
  const encoded = req.header(PAYMENT_SIGNATURE_HEADER);
  if (!encoded) return null;
  try {
    return asPaymentPayload(decodeHeader<unknown>(encoded));
  } catch {
    return null;
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
    if (field < 0n || field >= 21888242871839275222246405745257275088548364400416034343698204186575808495617n) return null;
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
      const nowSeconds = BigInt(Math.floor(clock() / 1000));
      if (!timestamp || BigInt(timestamp) > nowSeconds + 30n) return { isValid: false, invalidReason: 'future_proof_timestamp' };
      const valid = await groth16.verify(vk, payment.payload.publicSignals, payment.payload.proof);
      return valid ? { isValid: true } : { isValid: false, invalidReason: 'proof_invalid' };
    };
  } catch {
    return async () => ({ isValid: false, invalidReason: 'verifier_unavailable' });
  }
}

async function bufferResponse(response: globalThis.Response): Promise<BufferedResponse> {
  const reader = response.body?.getReader();
  if (!reader) {
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      body: new Uint8Array(),
    };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_UPSTREAM_BYTES) throw new Error('upstream_response_too_large');
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? 'application/json; charset=utf-8',
    body,
  };
}

function sendBuffered(res: ExpressResponse, result: BufferedResponse, paymentResponse?: SettlementResponse): void {
  if (paymentResponse) res.setHeader(PAYMENT_RESPONSE_HEADER, encodeHeader(paymentResponse));
  res.status(result.status);
  res.setHeader('Content-Type', result.contentType);
  res.end(Buffer.from(result.body));
}

async function sendStream(res: ExpressResponse, dispatch: StreamDispatch, paymentResponse?: SettlementResponse): Promise<void> {
  if (paymentResponse) res.setHeader(PAYMENT_RESPONSE_HEADER, encodeHeader(paymentResponse));
  res.status(dispatch.status);
  res.setHeader('Content-Type', dispatch.contentType);
  if (!dispatch.body) {
    res.end();
    return;
  }
  const reader = dispatch.body.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!res.write(Buffer.from(next.value)) && !res.destroyed) {
        await new Promise<void>((resolve) => {
          const finish = () => {
            res.off('drain', finish);
            res.off('close', finish);
            res.off('error', finish);
            resolve();
          };
          res.once('drain', finish);
          res.once('close', finish);
          res.once('error', finish);
        });
        if (res.destroyed) return;
      }
    }
    res.end();
  } finally {
    reader.releaseLock();
  }
}

function sendPaymentRequired(res: ExpressResponse, url: string, requirements: PaymentRequirements, reason?: string): void {
  const required = buildPaymentRequired(url, requirements, reason);
  res.setHeader(PAYMENT_REQUIRED_HEADER, encodeHeader(required));
  res.status(402).json({ error: 'payment_required' });
}

function jsonError(res: ExpressResponse, status: number, error: string): void {
  res.status(status).json({ error });
}

interface RequestWithRawBody extends Request {
  rawBody?: Uint8Array;
}

function bodyForSignal(req: Request): Uint8Array {
  const raw = (req as RequestWithRawBody).rawBody;
  return raw ? new Uint8Array(raw) : new Uint8Array();
}

function providerEndpoint(pathname: string): ProviderEndpoint {
  return pathname.endsWith('/responses') ? 'responses' : 'chat.completions';
}

/** Creates the active gateway Express application. */
export async function createZkPrepaidGateway(options: ZkPrepaidGatewayOptions = {}) {
  const config = gatewayConfig(options);
  const now = options.now ?? Date.now;
  const requirements = paymentRequirements(config, Math.floor(now() / 1000));
  const claimStore = options.claimStore ?? new LocalClaimStore();
  const provider = options.provider ?? new OpenRouterAdapter();
  const readRoots = async (): Promise<GatewayRootSnapshot> => options.rootSnapshot
    ? await options.rootSnapshot()
    : { currentRoot: config.currentRoot, knownRoots: config.knownRoots };
  const proofVerifier = options.verifyProof ?? await loadGroth16Verifier(config, now, readRoots);
  const facilitator = createZkPrepaidFacilitator({ claimStore, verifyProof: proofVerifier, now });
  const billing = options.billing ?? new StripeBillingService({ now });
  const walletLinks = options.walletLinks ?? new MemoryWalletLinkStore();
  const inFlight = new Map<string, Promise<StreamDispatch>>();
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

  app.get('/health', (_req, res) => {
    res.json({ service: 'zk-credits-gateway', status: 'ok', network: requirements.network, scheme: requirements.scheme });
  });

  app.get('/x402/facilitator/supported', (_req, res) => res.json(facilitator.supported()));

  app.post('/x402/facilitator/verify', async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const payment = asPaymentPayload(body.paymentPayload ?? body.payment ?? body);
      const accepted = body.paymentRequirements ?? body.requirements;
      if (!payment || !accepted || typeof accepted !== 'object') {
        res.json({ isValid: false, invalidReason: 'invalid_facilitator_request' });
        return;
      }
      const requestedRequirements = accepted as PaymentRequirements;
      if (!requirementsEqual(requestedRequirements, requirements)) {
        res.json({ isValid: false, invalidReason: 'requirements_mismatch' });
        return;
      }
      res.json(await facilitator.verify(payment, requestedRequirements));
    } catch {
      res.json({ isValid: false, invalidReason: 'verification_failed' });
    }
  });

  app.post('/x402/facilitator/settle', async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const action = body.action ?? body.operation ?? 'reserve';
      if (action === 'commit' || action === 'cancel') {
        if (typeof body.reservationId !== 'string' || body.reservationId.length === 0 || body.reservationId.length > 128) {
          res.json({ success: false, transaction: '', network: requirements.network, errorReason: 'reservation_id_required' });
          return;
        }
        res.json(action === 'commit'
          ? await facilitator.commit(body.reservationId, requirements.network)
          : await facilitator.cancel(body.reservationId, requirements.network));
        return;
      }
      if (action !== 'reserve') {
        res.json({ success: false, transaction: '', network: requirements.network, errorReason: 'invalid_settlement_action' });
        return;
      }
      const payment = asPaymentPayload(body.paymentPayload ?? body.payment ?? body);
      const accepted = body.paymentRequirements ?? body.requirements;
      if (!payment || !accepted || typeof accepted !== 'object') {
        res.json({ success: false, transaction: '', network: requirements.network, errorReason: 'invalid_facilitator_request' });
        return;
      }
      const requestedRequirements = accepted as PaymentRequirements;
      if (!requirementsEqual(requestedRequirements, requirements)) {
        res.json({ success: false, transaction: '', network: requirements.network, errorReason: 'requirements_mismatch' });
        return;
      }
      res.json(await facilitator.settle(payment, requestedRequirements));
    } catch {
      res.json({ success: false, transaction: '', network: requirements.network, errorReason: 'settlement_failed' });
    }
  });

  /**
   * Returns a client-encrypted replay for an already committed claim. The
   * endpoint never decrypts or logs the response; possession of the original
   * payment payload is required and the sidecar alone has the private key.
   */
  app.post('/x402/replay', async (req, res) => {
    const payment = parsePaymentHeader(req);
    if (!payment) { jsonError(res, 400, 'invalid_replay_request'); return; }
    try {
      const verified = await facilitator.verify(payment, requirements);
      if (!verified.isValid) { jsonError(res, 404, 'replay_not_found'); return; }
      const nullifier = payment.payload.publicSignals[PUBLIC_SIGNAL_INDEX.nullifier];
      if (!nullifier) { jsonError(res, 404, 'replay_not_found'); return; }
      const record = await claimStore.get(nullifier);
      if (!record || record.state !== 'committed' || !record.encryptedReplay) {
        jsonError(res, 404, 'replay_not_found');
        return;
      }
      res.json({ encryptedReplay: record.encryptedReplay });
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

  function billingAuthorized(req: Request): boolean {
    const configured = process.env.BILLING_INTERNAL_TOKEN;
    if (!configured) return process.env.NODE_ENV !== 'production';
    return req.header('authorization') === `Bearer ${configured}`;
  }

  app.post('/v1/accounts/wallet-link', async (req, res) => {
    if (!billingAuthorized(req)) { jsonError(res, 401, 'billing_auth_required'); return; }
    const body = req.body as Record<string, unknown>;
    if (typeof body.accountId !== 'string' || typeof body.address !== 'string') {
      jsonError(res, 400, 'invalid_wallet_link');
      return;
    }
    try {
      await walletLinks.link(body.accountId, body.address, now());
      res.json({ linked: true, address: body.address.toLowerCase() });
    } catch (error) {
      jsonError(res, 409, error instanceof Error ? error.message : 'wallet_link_failed');
    }
  });

  app.post('/v1/billing/orders', async (req, res) => {
    if (!billingAuthorized(req)) { jsonError(res, 401, 'billing_auth_required'); return; }
    try {
      const body = req.body as Record<string, unknown>;
      if ((body.tierId !== 0 && body.tierId !== 1 && body.tierId !== 2) || typeof body.commitment !== 'string' || typeof body.accountId !== 'string' || body.accountId.length === 0 || body.accountId.length > 255) {
        jsonError(res, 400, 'invalid_order');
        return;
      }
      res.status(201).json(await billing.createOrder({ tierId: body.tierId as TierId, commitment: body.commitment, accountId: body.accountId }));
    } catch (error) {
      jsonError(res, 400, error instanceof Error ? error.message : 'order_creation_failed');
    }
  });

  app.get('/v1/billing/orders/:orderId', async (req, res) => {
    if (!billingAuthorized(req)) { jsonError(res, 401, 'billing_auth_required'); return; }
    const accountId = req.header('x-billing-account-id');
    const status = await billing.getPublicStatus(req.params.orderId, accountId);
    if (!status) { jsonError(res, 404, 'order_not_found'); return; }
    res.json(status);
  });

  app.post('/v1/billing/stripe-event', async (req, res) => {
    if (!billingAuthorized(req)) { jsonError(res, 401, 'billing_auth_required'); return; }
    try {
      const body = req.body as Record<string, unknown>;
      const result = await billing.handleWebhook({
        eventId: typeof body.eventId === 'string' ? body.eventId : '',
        eventType: typeof body.eventType === 'string' ? body.eventType : '',
        orderId: typeof body.orderId === 'string' ? body.orderId : undefined,
        sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
        amountTotalCents: typeof body.amountTotalCents === 'number' ? body.amountTotalCents : undefined,
        currency: typeof body.currency === 'string' ? body.currency : undefined,
      });
      res.json(result);
    } catch (error) {
      // A non-2xx response deliberately causes Stripe's caller to retry a
      // failed sponsorship/refund workflow.
      jsonError(res, 503, error instanceof Error ? error.message : 'stripe_event_retryable');
    }
  });

  const handleCompletion = async (req: Request, res: ExpressResponse): Promise<void> => {
    const url = requestUrl(req, config);
    const payment = parsePaymentHeader(req);
    if (!payment) {
      sendPaymentRequired(res, url, requirements);
      return;
    }

    let expectedSignal: string;
    try {
      expectedSignal = (await deriveRequestSignal({
        method: req.method,
        url,
        body: bodyForSignal(req),
        requirements,
        nonce: payment.payload.nonce,
        responseKey: payment.payload.responseKey,
      })).field;
    } catch {
      sendPaymentRequired(res, url, requirements, 'invalid_request_binding');
      return;
    }

    const structural = await facilitator.verify(payment, requirements, expectedSignal);
    if (!structural.isValid) {
      sendPaymentRequired(res, url, requirements, structural.invalidReason);
      return;
    }

    const nullifier = payment.payload.publicSignals[PUBLIC_SIGNAL_INDEX.nullifier]!;
    const hash = signalHash(payment);
    let reservation: Awaited<ReturnType<ClaimStore['reserve']>>;
    try {
      reservation = await claimStore.reserve(nullifier, hash, now());
    } catch (error) {
      if (error instanceof Error && error.message === 'conflicting_signal') {
        sendPaymentRequired(res, url, requirements, 'conflicting_signal');
        return;
      }
      jsonError(res, 503, 'claim_store_unavailable');
      return;
    }

    const key = `${nullifier}:${hash}`;
    const paymentResponse: SettlementResponse = { success: true, transaction: '', network: requirements.network };
    if (reservation.kind === 'existing') {
      const active = inFlight.get(key);
      if (active) {
        try {
          const dispatch = await active;
          sendBuffered(res, await dispatch.buffered, paymentResponse);
        } catch {
          jsonError(res, 502, 'provider_request_failed');
        }
        return;
      }
      if (reservation.record.state === 'cancelled') {
        sendPaymentRequired(res, url, requirements, 'reservation_expired');
        return;
      }
      if (reservation.record.state === 'committed') {
        res.setHeader(PAYMENT_RESPONSE_HEADER, encodeHeader(paymentResponse));
        res.status(409).json({ error: 'claim_already_committed', replay: Boolean(reservation.record.encryptedReplay) });
        return;
      }
      jsonError(res, 409, 'claim_in_progress');
      return;
    }

    const context: ReservationContext = {
      payment,
      requirements,
      nullifier,
      signalHash: hash,
      reservationId: reservation.record.reservationId,
    };
    const operation = (async (): Promise<StreamDispatch> => {
      let dispatchStarted = false;
      try {
        if (!config.openRouterApiKey && provider.id === 'openrouter' && !options.allowUnverifiedProofs) {
          throw new Error('provider_not_configured');
        }
        // Calling the provider is the dispatch boundary. Commit before waiting
        // for its response so a timeout cannot make a second spend reusable.
        const providerPromise = provider.forwardRequest(
          req.body,
          config.openRouterApiKey ?? '',
          providerEndpoint(req.path),
        );
        dispatchStarted = true;
        await claimStore.commit(context.reservationId, undefined, now());
        const upstream = await providerPromise;
        const status = upstream.status;
        const contentType = upstream.headers.get('content-type') ?? 'application/json; charset=utf-8';
        const body = upstream.body;
        if (!body) {
          const buffered = Promise.resolve({
            status,
            contentType,
            body: new Uint8Array(),
          });
          return { status, contentType, buffered };
        }

        // The first caller consumes one tee branch directly. The second branch
        // is bounded and retained only as a client-encrypted replay envelope.
        const [responseBody, replayBody] = body.tee();
        const replayResponse = new Response(replayBody, { status, headers: { 'content-type': contentType } });
        const buffered = bufferResponse(replayResponse).then(async (result) => {
          let encryptedReplay: string | undefined;
          try {
            encryptedReplay = encryptResponseReplay(payment.payload.responseKey, result.body, {
              contentType: result.contentType,
              status: result.status,
              now: now(),
            });
          } catch {
            // A malformed client key must not turn a provider response into a
            // plaintext server-side cache. The claim remains committed.
          }
          if (encryptedReplay && encryptedReplay.length <= MAX_REPLAY_BYTES * 2) {
            await claimStore.commit(context.reservationId, encryptedReplay, now());
          }
          return result;
        });
        return { status, contentType, body: responseBody, buffered };
      } catch (error) {
        if (!dispatchStarted) {
          try { await claimStore.cancel(context.reservationId, now()); } catch { /* preserve original failure */ }
        }
        throw error;
      }
    })();
    inFlight.set(key, operation);
    try {
      const dispatch = await operation;
      await sendStream(res, dispatch, paymentResponse);
      // The response has already been sent from the first tee branch. Await
      // replay capture so concurrent exact retries observe a committed copy.
      await dispatch.buffered.catch(() => undefined);
    } catch (error) {
      if (res.headersSent || res.destroyed) {
        if (!res.destroyed) res.destroy();
      } else if (error instanceof Error && error.message === 'provider_not_configured') {
        jsonError(res, 503, 'provider_not_configured');
      } else {
        jsonError(res, 502, 'provider_request_failed');
      }
    } finally {
      inFlight.delete(key);
    }
  };

  app.post('/v1/chat/completions', handleCompletion);
  app.post('/v1/responses', handleCompletion);

  app.use((_req, res) => jsonError(res, 404, 'not_found'));
  return { app, requirements, claimStore, billing, walletLinks };
}
