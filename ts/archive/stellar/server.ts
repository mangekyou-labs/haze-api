// ZK-API Credits Gateway Server
// OpenAI-compatible /v1/chat/completions endpoint with ZK proof relay

import express, { Request, Response } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  OpenRouterAdapter,
  MockProviderAdapter,
  registerAdapter,
  getAdapter,
  type ProviderEndpoint,
} from './providerAdapter.js';
import { MerkleTree } from './merkle.js';
import {
  bootstrapMembershipTreeFromLeaves,
  bootstrapMembershipTreeFromSnapshot,
  parseMembershipTreeBootstrapSnapshot,
  reconstructMembershipTreeFromStore,
  repairMembershipTreeFromSnapshot,
} from './membership-tree.js';
import { requestDigestToField, verifyGroth16Proof } from '@zk-credits/shared';
import {
  MemoryGatewayStore,
  PostgresGatewayStore,
  reconstructGatewayState,
  MemoryBillingStore,
  PostgresBillingStore,
  MemoryEvaluationStore,
  PostgresEvaluationStore,
  createPool,
  runMigrations,
  type AcceptedCall,
  type GatewayStore,
  type BillingStore,
  type EvaluationStore,
} from './db/index.js';
import {
  EVALUATION_CHECKOUT_AMOUNT_CENTS,
  EvaluationError,
} from './evaluation.js';
import { startSpendWorker, type SpendSubmitter } from './spend-worker.js';
import { extractSlashTransition } from './fee-relay.js';
import { initGatewaySentry } from './telemetry/sentry.js';

const PORT = Number(process.env.PORT ?? 3001);
const MAX_SSE_REPLAY_BYTES = Number(process.env.MAX_SSE_REPLAY_BYTES ?? 1_000_000);

initGatewaySentry();

// ─── Durable store (replaces the v1 in-memory Maps) ────────────
// Tests/local dev default to the memory store; production startup picks the
// Postgres store via initGatewayStore(). Handlers only talk to this contract,
// never to Maps/arrays directly.
let isReady = true;

export function setIsReady(ready: boolean): void {
  isReady = ready;
}

export function getIsReady(): boolean {
  return isReady;
}

let gatewayStore: GatewayStore = new MemoryGatewayStore();
let billingStore: BillingStore = new MemoryBillingStore();
let evaluationStore: EvaluationStore = new MemoryEvaluationStore();
const DEFAULT_EVALUATION_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
let evaluationPurgeTimer: NodeJS.Timeout | undefined;
let evaluationPurgeInFlight = false;
export function setGatewayStore(store: GatewayStore): void {
  gatewayStore = store;
}

export function getGatewayStore(): GatewayStore {
  return gatewayStore;
}

export function setBillingStore(store: BillingStore): void {
  billingStore = store;
}

export function getBillingStore(): BillingStore {
  return billingStore;
}

export function setEvaluationStore(store: EvaluationStore): void {
  evaluationStore = store;
}

export function getEvaluationStore(): EvaluationStore {
  return evaluationStore;
}

export async function purgeExpiredEvaluationData(at = Date.now()): Promise<number> {
  return evaluationStore.purgeExpired(at);
}

/** Start the retention purge loop after the durable store is ready. */
export function startEvaluationPurgeScheduler(
  intervalMs = Number(process.env.EVALUATION_PURGE_INTERVAL_MS ?? DEFAULT_EVALUATION_PURGE_INTERVAL_MS),
): void {
  if (evaluationPurgeTimer) clearInterval(evaluationPurgeTimer);
  evaluationPurgeTimer = undefined;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;

  const run = async (): Promise<void> => {
    if (evaluationPurgeInFlight) return;
    evaluationPurgeInFlight = true;
    try {
      const purged = await purgeExpiredEvaluationData();
      if (purged > 0) console.log(`[evaluation] retention purge anonymized ${purged} participant(s)`);
    } catch (error) {
      console.error('[evaluation] retention purge failed:', error instanceof Error ? error.message : 'unknown');
    } finally {
      evaluationPurgeInFlight = false;
    }
  };

  evaluationPurgeTimer = setInterval(() => {
    void run();
  }, intervalMs);
  evaluationPurgeTimer.unref?.();
}

export function stopEvaluationPurgeScheduler(): void {
  if (evaluationPurgeTimer) clearInterval(evaluationPurgeTimer);
  evaluationPurgeTimer = undefined;
  evaluationPurgeInFlight = false;
}

// Legacy helper retained for migration tooling. The indexed-ticket launch has
// no epoch public signal.
export function extractEpoch(pubSignals: string[]): number {
  const v = Number(pubSignals[4]);
  if (!Number.isFinite(v) || v <= 0) throw new Error('Invalid epoch public signal');
  return Math.floor(v);
}

export function proofHashOf(proof: object, pubSignals: string[]): string {
  return crypto.createHash('sha256').update(JSON.stringify({ proof, pubSignals })).digest('hex');
}

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export const merkleTree = new MerkleTree();

// ─── Store startup (production) ─────────────────────────────────
// Database configured → Postgres store (migrations + restart
// reconstruction). No DB config → fails closed (getDbConfig throws). Dev and
// tests opt into the memory store explicitly via resetGatewayStoreForTests().
export async function initDurableGatewayStore(
  env: NodeJS.ProcessEnv = process.env,
): Promise<GatewayStore> {
  const currentDir = typeof __dirname !== 'undefined'
    ? __dirname
    : (import.meta.dirname || (import.meta.url ? path.dirname(new URL(import.meta.url).pathname) : process.cwd()));
  const migrationsDir = path.resolve(currentDir, 'db', 'migrations');
  const pool = createPool(env);
  await runMigrations(pool, migrationsDir);
  const store = new PostgresGatewayStore(pool);
  const state = await reconstructGatewayState(store);
  let membershipLeaves = await store.listMembershipLeaves();
  if (env.ZK_CONTRACT_ID) {
    const contractModule = await import('./contract.js');
    const chainRoot = await contractModule.getCurrentRoot();
    if (env.MEMBERSHIP_TREE_REPAIR_SNAPSHOT && env.MEMBERSHIP_TREE_REPAIR_EXPECTED_STALE_ROOT) {
      const snapshot = parseMembershipTreeBootstrapSnapshot(env.MEMBERSHIP_TREE_REPAIR_SNAPSHOT);
      merkleTree.replaceWith(
        await repairMembershipTreeFromSnapshot(
          store,
          snapshot,
          env.MEMBERSHIP_TREE_REPAIR_EXPECTED_STALE_ROOT,
          chainRoot,
        ),
      );
      membershipLeaves = await store.listMembershipLeaves();
      console.log(
        `[db] CAS repair completed: replaced stale DB root "${env.MEMBERSHIP_TREE_REPAIR_EXPECTED_STALE_ROOT}" with snapshot matching chain root ${chainRoot}`,
      );
    } else if (membershipLeaves.length === 0 && env.MEMBERSHIP_TREE_BOOTSTRAP_SNAPSHOT) {
      const snapshot = parseMembershipTreeBootstrapSnapshot(env.MEMBERSHIP_TREE_BOOTSTRAP_SNAPSHOT);
      merkleTree.replaceWith(await bootstrapMembershipTreeFromSnapshot(store, snapshot, chainRoot));
      membershipLeaves = await store.listMembershipLeaves();
    } else if (membershipLeaves.length === 0 && env.MEMBERSHIP_TREE_BOOTSTRAP_LEAVES) {
      let bootstrapLeaves: unknown;
      try {
        bootstrapLeaves = JSON.parse(env.MEMBERSHIP_TREE_BOOTSTRAP_LEAVES);
      } catch {
        throw new Error('MEMBERSHIP_TREE_BOOTSTRAP_LEAVES must be a JSON array of field elements');
      }
      if (!Array.isArray(bootstrapLeaves) || !bootstrapLeaves.every((leaf) => typeof leaf === 'string')) {
        throw new Error('MEMBERSHIP_TREE_BOOTSTRAP_LEAVES must be a JSON array of field elements');
      }
      merkleTree.replaceWith(await bootstrapMembershipTreeFromLeaves(store, bootstrapLeaves, chainRoot));
      membershipLeaves = await store.listMembershipLeaves();
    } else {
      merkleTree.replaceWith(await reconstructMembershipTreeFromStore(store, chainRoot));
    }
  } else if (membershipLeaves.length > 0) {
    throw new Error('ZK_CONTRACT_ID is required to verify durable membership-tree state');
  } else {
    merkleTree.replaceWith(new MerkleTree());
  }
  if (state.nullifiers.size > 0 || state.callCounts.size > 0) {
    console.log(
      `[db] Restart reconstruction: ${state.nullifiers.size} nullifiers, ` +
        `${state.callCounts.size} commitments with call counts`,
    );
  }
  if (membershipLeaves.length > 0) {
    console.log(`[db] Restart reconstruction: ${membershipLeaves.length} membership leaves`);
  }
  setGatewayStore(store);
  setBillingStore(new PostgresBillingStore(pool));
  setEvaluationStore(new PostgresEvaluationStore(pool));
  startEvaluationPurgeScheduler(Number(env.EVALUATION_PURGE_INTERVAL_MS ?? DEFAULT_EVALUATION_PURGE_INTERVAL_MS));
  startSpendWorker(
    {
      store,
      secretKey: process.env.GATEWAY_SECRET_KEY || '',
      submitSpend: (async (
        secretKey,
        proof,
        pubSignals,
      ) => {
        const contractModule = await import('./contract.js');
        return contractModule.spend(secretKey, proof, pubSignals);
      }) as SpendSubmitter,
    },
    Number(process.env.SPEND_WORKER_INTERVAL_MS ?? '10000'),
  );
  setIsReady(true);
  return store;
}

export async function resetGatewayStoreForTests(): Promise<void> {
  stopEvaluationPurgeScheduler();
  setIsReady(true);
  setGatewayStore(new MemoryGatewayStore());
  setBillingStore(new MemoryBillingStore());
  setEvaluationStore(new MemoryEvaluationStore());
  merkleTree.replaceWith(new MerkleTree());
}
// ─── Config ──────────────────────────────────────────────────────

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const STARTER_TICKET_COUNT = 100;
const PUBLIC_COMPATIBILITY_KEY = process.env.PUBLIC_COMPATIBILITY_KEY || 'sk-zk-local-demo';

type DepositState = {
  amount: string;
  depositor: string;
  slashed: boolean;
  withdrawn: boolean;
};

type DepositStatus = 'active' | 'unfunded' | 'slashed' | 'withdrawn';

function getDepositStatus(deposit: DepositState | null): DepositStatus {
  if (!deposit) return 'unfunded';
  if (deposit.slashed) return 'slashed';
  if (deposit.withdrawn) return 'withdrawn';
  try {
    return BigInt(String(deposit.amount)) > 0n ? 'active' : 'unfunded';
  } catch {
    return 'unfunded';
  }
}

function hasSpendableDeposit(deposit: DepositState | null): boolean {
  return getDepositStatus(deposit) === 'active';
}

function requireGatewaySecret(req: Request, res: Response): boolean {
  const gatewaySecret = process.env.GATEWAY_SECRET || '';
  if (!gatewaySecret) {
    res.status(500).json({ error: 'server_misconfigured' });
    return false;
  }
  if (req.headers.authorization !== `Bearer ${gatewaySecret}`) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

function requireEvaluationPurgeSecret(req: Request, res: Response): boolean {
  const purgeSecret = process.env.EVALUATION_PURGE_SECRET || '';
  if (!purgeSecret) {
    res.status(500).json({ error: 'server_misconfigured' });
    return false;
  }
  if (req.headers.authorization !== `Bearer ${purgeSecret}`) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

function evaluationParticipantId(req: Request, res: Response): string | null {
  const header = req.headers['x-evaluation-participant-id'];
  const participantId = Array.isArray(header) ? header[0] : header;
  if (typeof participantId !== 'string' || participantId.length === 0) {
    res.status(401).json({ error: 'missing_participant_id' });
    return null;
  }
  if (!/^[a-f0-9]{64}$/.test(participantId)) {
    res.status(400).json({ error: 'invalid_participant_id' });
    return null;
  }
  return participantId;
}

function evaluationErrorResponse(res: Response, error: unknown): void {
  if (!(error instanceof EvaluationError)) {
    console.error('evaluation route error:', error instanceof Error ? error.message : 'unknown');
    res.status(500).json({ error: 'evaluation_failed' });
    return;
  }
  const status = error.code === 'rate_limited'
    ? 429
    : error.code === 'challenge_expired'
      ? 410
      : error.code === 'wallet_proof_invalid'
        ? 422
        : ['not_enrolled', 'challenge_not_found', 'deposit_not_found', 'checkout_not_found'].includes(error.code)
          ? 404
          : [
            'already_enrolled',
            'wallet_already_used',
            'deposit_already_used',
            'checkout_already_used',
            'challenge_replayed',
            'wallet_not_verified',
            'feedback_not_ready',
          ].includes(error.code)
            ? 409
            : 400;
  res.status(status).json({ error: error.code });
}

// ─── Verification key (loaded at startup) ────────────────────────

let verificationKey: object;

function loadVerificationKey(): object {
  const currentDir = typeof __dirname !== 'undefined'
    ? __dirname
    : (import.meta.dirname || (import.meta.url ? path.dirname(new URL(import.meta.url).pathname) : process.cwd()));
  const circuitsDir = process.env.CIRCUITS_DIR || path.resolve(currentDir, '..', 'circuits');
  const vkPath = path.join(circuitsDir, 'verification_key_rln.json');
  if (!fs.existsSync(vkPath)) {
    console.error('FATAL: Verification key not found at', vkPath);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(vkPath, 'utf-8'));
}

// ─── Proof verification ─────────────────────────────────────────

// ─── Proof verification (via @zk-credits/shared) ────────────────

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parseProofHeader(header: string): { proof: object; pubSignals: string[] } {
  const decoded = Buffer.from(header, 'base64').toString();
  const parsed = JSON.parse(decoded);

  if (!parsed.proof || typeof parsed.proof !== 'object') {
    throw new Error('Missing or invalid proof object');
  }
  if (!Array.isArray(parsed.pubSignals)) {
    throw new Error('Missing or invalid pubSignals array');
  }
  if (parsed.pubSignals.length !== 4) {
    throw new Error(`Expected 4 indexed-ticket public signals, got ${parsed.pubSignals.length}`);
  }

  return { proof: parsed.proof, pubSignals: parsed.pubSignals };
}

async function verifyZkProof(
  proof: object,
  pubSignals: string[],
): Promise<boolean> {
  return verifyGroth16Proof(verificationKey, pubSignals, proof);
}

// Indexed-ticket public signal layout: [root, nullifier, share_x, share_y].
export function extractNullifier(pubSignals: string[]): string {
  return pubSignals[1];
}

export function extractSignalX(pubSignals: string[]): string {
  return pubSignals[2];
}

export function extractSignalY(pubSignals: string[]): string {
  return pubSignals[3];
}

async function isCompatibilityBearer(value: string): Promise<boolean> {
  if (value === PUBLIC_COMPATIBILITY_KEY) return true;
  // Existing unit fixtures create temporary records. Production never uses
  // this fallback, so no commitment-linked credential reaches the call path.
  if (process.env.NODE_ENV === 'test') {
    return (await gatewayStore.getApiKey(hashApiKey(value))) !== null;
  }
  return false;
}

// ─── Express app ─────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json({ limit: 2_000_000 }));

// ─── Provider adapter setup ──────────────────────────────────────

const openrouter = new OpenRouterAdapter();
const mock = new MockProviderAdapter();
registerAdapter(openrouter);
registerAdapter(mock);

// ─── Load VK at startup ─────────────────────────────────────────

verificationKey = loadVerificationKey();

// ─── Healthcheck & Readiness Gate ──────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    initialized: isReady,
    version: '0.1.0',
    network: 'stellar:testnet',
    proofVerification: 'enabled',
  });
});

app.use('/v1', (_req: Request, res: Response, next) => {
  if (!isReady) {
    res.status(503).json({
      error: 'gateway_initializing',
      message: 'Gateway durable stores and on-chain tree verification are initializing',
    });
    return;
  }
  next();
});
// Public, parameter-free snapshot. Clients derive their own path locally;
// this route deliberately has no commitment/candidate-leaf lookup semantics.
app.get('/v1/membership-tree', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    root: merkleTree.root().toString(),
    depth: 3,
    leaves: merkleTree.getLeaves().map((leaf) => leaf.toString()),
    // Layers are needed to retain the valid zero-branch state after a
    // slash/withdrawal. They are deterministic public Merkle data, never a
    // commitment lookup or a per-caller witness.
    layers: merkleTree.getLayers().map((layer) => layer.map((node) => node.toString())),
    generatedAt: new Date().toISOString(),
  });
});

// ─── Proof-bound OpenAI-compatible relay ─────────────────────────

type StoredSseTranscript = { kind: 'zk_sse_transcript'; base64: string };
type StoredUnreplayableStream = { kind: 'zk_sse_unreplayable'; reason: 'replay_limit_exceeded' };

function isStoredSseTranscript(value: unknown): value is StoredSseTranscript {
  return !!value
    && typeof value === 'object'
    && (value as Record<string, unknown>).kind === 'zk_sse_transcript'
    && typeof (value as Record<string, unknown>).base64 === 'string';
}

function isStoredUnreplayableStream(value: unknown): value is StoredUnreplayableStream {
  return !!value
    && typeof value === 'object'
    && (value as Record<string, unknown>).kind === 'zk_sse_unreplayable'
    && (value as Record<string, unknown>).reason === 'replay_limit_exceeded';
}

function isStreamingRequest(body: unknown): boolean {
  return !!body && typeof body === 'object' && (body as Record<string, unknown>).stream === true;
}

function replayStoredProviderResponse(res: Response, status: number, body: unknown): void {
  if (isStoredSseTranscript(body)) {
    res.status(status)
      .set('Content-Type', 'text/event-stream; charset=utf-8')
      .set('Cache-Control', 'no-cache')
      .send(Buffer.from(body.base64, 'base64'));
    return;
  }
  if (isStoredUnreplayableStream(body)) {
    res.status(409).json({
      error: 'stream_replay_unavailable',
      message: 'The accepted stream exceeded the bounded replay limit; its ticket remains reserved for this exact request only.',
    });
    return;
  }
  res.status(status).json(body ?? { accepted: true });
}

async function relaySseTranscript(
  res: Response,
  upstream: globalThis.Response,
  acceptedCall: AcceptedCall,
): Promise<void> {
  const contentType = upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8';
  res.status(upstream.status)
    .set('Content-Type', contentType)
    .set('Cache-Control', 'no-cache');

  if (!upstream.body) {
    await gatewayStore.recordProviderResponse(
      acceptedCall.proofHash,
      upstream.status,
      { kind: 'zk_sse_transcript', base64: '' },
      upstream.headers.get('x-generation-id') ?? undefined,
    );
    res.end();
    return;
  }

  const reader = upstream.body.getReader();
  const chunks: Buffer[] = [];
  let replayable = true;
  let transcriptBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      transcriptBytes += chunk.length;
      if (replayable && transcriptBytes <= MAX_SSE_REPLAY_BYTES) {
        chunks.push(chunk);
      } else {
        replayable = false;
        chunks.length = 0;
      }
      res.write(chunk);
    }
    if (replayable) {
      await gatewayStore.recordProviderResponse(
        acceptedCall.proofHash,
        upstream.status,
        { kind: 'zk_sse_transcript', base64: Buffer.concat(chunks).toString('base64') },
        upstream.headers.get('x-generation-id') ?? undefined,
      );
    } else {
      await gatewayStore.recordProviderResponse(
        acceptedCall.proofHash,
        upstream.status,
        { kind: 'zk_sse_unreplayable', reason: 'replay_limit_exceeded' },
        upstream.headers.get('x-generation-id') ?? undefined,
      );
    }
    res.end();
  } catch (err) {
    res.end();
    throw err;
  } finally {
    reader.releaseLock();
  }
}

async function readProviderJsonResponse(upstream: globalThis.Response): Promise<{
  status: number;
  body: unknown;
}> {
  const rawBody = await upstream.text();
  try {
    return { status: upstream.status, body: JSON.parse(rawBody) as unknown };
  } catch {
    return {
      status: upstream.ok ? 502 : upstream.status,
      body: {
        error: 'upstream_non_json_response',
        message: `The upstream provider returned HTTP ${upstream.status} with a non-JSON body.`,
      },
    };
  }
}

async function relayProofBoundRequest(
  req: Request,
  res: Response,
  providerEndpoint: ProviderEndpoint,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const proofHeader = req.headers['x-zk-proof'] as string;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'missing_authorization' });
      return;
    }

    const apiKey = authHeader.slice(7).trim();
    if (!(await isCompatibilityBearer(apiKey))) {
      res.status(401).json({ error: 'invalid_api_key' });
      return;
    }

    if (!proofHeader) {
      res.status(402).json({ error: 'proof_required', message: 'Include X-ZK-Proof header' });
      return;
    }

    let zkProof: { proof: object; pubSignals: string[] };
    try {
      zkProof = parseProofHeader(proofHeader);
    } catch (err: unknown) {
      res.status(400).json({ error: 'invalid_proof_header', message: errorMessage(err) });
      return;
    }

    // Verify the ZK proof
    let valid: boolean;
    try {
      valid = await verifyZkProof(zkProof.proof, zkProof.pubSignals);
    } catch (err: unknown) {
      console.error('Proof verification error:', err);
      res.status(403).json({ error: 'proof_verification_failed', message: errorMessage(err) });
      return;
    }

    if (!valid) {
      res.status(403).json({ error: 'invalid_proof', message: 'ZK proof verification failed' });
      return;
    }

    // Funding is authorized by membership in the active Merkle root, not by
    // looking up a commitment through the bearer credential.
    const contractModule = await import('./contract.js');
    if (process.env.ZK_CONTRACT_ID) {
      try {
        const currentRoot = await contractModule.getCurrentRoot();
        if (currentRoot !== '0' && zkProof.pubSignals[0] !== currentRoot) {
          res.status(403).json({ error: 'root_mismatch', message: 'Proof is not for the active membership root' });
          return;
        }
      } catch (err: unknown) {
        console.error('Active root read failed:', errorMessage(err));
        res.status(503).json({ error: 'credit_status_unavailable' });
        return;
      }
    }

    // Indexed-ticket layout: [root, nullifier, share_x, share_y]. x is bound
    // to the exact body forwarded below; the gateway never substitutes fields.
    const nullifier = extractNullifier(zkProof.pubSignals);
    const signalX = extractSignalX(zkProof.pubSignals);
    const signalY = extractSignalY(zkProof.pubSignals);
    const requestDigest = await requestDigestToField(req.body);
    if (signalX !== requestDigest.field) {
      res.status(400).json({ error: 'request_binding_mismatch', message: 'Proof does not bind to this request body' });
      return;
    }

    // Replay check against the durable nullifier records (fast path).
    const seen = await gatewayStore.getNullifier(nullifier);
    if (seen) {
      if (seen.signalX === signalX && seen.signalY === signalY && seen.requestDigest === requestDigest.digest) {
        const stored = await gatewayStore.findAcceptedCall({
          nullifier,
          signalX,
          signalY,
          requestDigest: requestDigest.digest,
        });
        if (stored?.responseStatus !== null && stored?.responseStatus !== undefined) {
          replayStoredProviderResponse(res, stored.responseStatus, stored.responseBody);
          return;
        }
        res.status(202).json({ accepted: true, status: 'pending', nullifier });
        return;
      }
      if (seen.signalX !== signalX) {
        res.status(409).json({
          error: 'fork_detected',
          message: 'The same indexed ticket was presented for a different request',
          slashEvidence: { nullifier, firstX: seen.signalX, firstY: seen.signalY, secondX: signalX, secondY: signalY },
        });
        return;
      }
      res.status(409).json({ error: 'ticket_integrity_conflict', message: 'Ticket tuple is inconsistent' });
      return;
    }

    // Stale-cache fallback: if we have no local record (e.g. after a cache
    // wipe or an event we missed), ask the contract directly.
    if (process.env.ZK_CONTRACT_ID && await contractModule.isNullifierSpent(nullifier)) {
      await gatewayStore.markNullifierSpentOnChain(nullifier);
      res.status(403).json({ error: 'nullifier_spent', message: 'This nullifier has already been spent on-chain' });
      return;
    }

    // DURABLE ACCEPT — persist before forwarding upstream, so no accepted
    // call is lost or duplicated on a crash/restart (v1 in-memory defect).
    const acceptedCall: AcceptedCall = {
      proofHash: proofHashOf(zkProof.proof, zkProof.pubSignals),
      nullifier,
      signalX,
      signalY,
      requestDigest: requestDigest.digest,
      epoch: 0,
      slot: 0,
      nonceHash: requestDigest.digest,
      acceptedAt: new Date(),
      // Persist the full proof so the async spend worker (M2.6) can resume the
      // settlement queue after a restart without asking the client again.
      proof: zkProof.proof,
      pubSignals: zkProof.pubSignals,
    };
    await gatewayStore.recordAcceptedCall(acceptedCall, '');

    const adapter = getAdapter(OPENROUTER_API_KEY ? 'openrouter' : 'mock')!;
    const upstream = await adapter.forwardRequest(req.body, OPENROUTER_API_KEY, providerEndpoint);
    if (isStreamingRequest(req.body) && upstream.headers.get('content-type')?.includes('text/event-stream')) {
      await relaySseTranscript(res, upstream, acceptedCall);
      return;
    }
    const providerResponse = await readProviderJsonResponse(upstream);
    const upstreamBody = providerResponse.body;
    const generationId = upstream.headers.get('x-generation-id') ??
      (typeof upstreamBody === 'object' && upstreamBody !== null && 'id' in upstreamBody
        ? String((upstreamBody as { id?: unknown }).id ?? '')
        : undefined);
    await gatewayStore.recordProviderResponse(
      acceptedCall.proofHash,
      providerResponse.status,
      upstreamBody,
      generationId,
    );
    res.status(providerResponse.status).json(upstreamBody);
  } catch (err) {
    console.error('/v1/chat/completions error:', err);
    res.status(500).json({ error: 'internal_error' });
  }
}

app.post('/v1/chat/completions', (req: Request, res: Response) => {
  void relayProofBoundRequest(req, res, 'chat.completions');
});

app.post('/v1/responses', (req: Request, res: Response) => {
  void relayProofBoundRequest(req, res, 'responses');
});

// ─── POST /v1/slash (permissionless → fee sponsor) ─────────────
// A reporter builds and signs the inner slash() transaction locally. The
// reporter's account is the transaction source and submitter argument, but
// does not need XLM: the fee sponsor wraps this exact inner transaction in a
// fee bump and submits it. The contract remains the authority that verifies
// the proof, binds it to the commitment, and pays the 50/50 split.

app.post('/v1/slash', async (req: Request, res: Response) => {
  try {
    const innerTransactionXdr =
      (req.body?.innerTransactionXdr ?? req.body?.innerTxXdr) as string | undefined;
    if (!innerTransactionXdr) {
      res.status(400).json({ error: 'missing_inner_transaction' });
      return;
    }

    // A successful slash changes the contract root. Mirror only the exact
    // transition encoded in the signed inner XDR, and only if it reproduces
    // locally. This keeps the public witness snapshot durable after slashing.
    let slashRemoval: { leafIndex: number; nextRoot: string; removedTree: MerkleTree } | null = null;
    if (process.env.ZK_CONTRACT_ID) {
      const transition = extractSlashTransition(innerTransactionXdr, process.env.ZK_CONTRACT_ID);
      const membershipLeaf = (await gatewayStore.listMembershipLeaves())
        .find((leaf) => leaf.commitment === transition.commitment && leaf.status === 'active');
      if (!membershipLeaf || merkleTree.root().toString() !== transition.currentRoot) {
        res.status(409).json({ error: 'membership_tree_mismatch' });
        return;
      }
      const removedTree = merkleTree.clone();
      const computedNextRoot = await removedTree.setLeaf(membershipLeaf.leafIndex, 0n);
      if (computedNextRoot.toString() !== transition.nextRoot) {
        res.status(409).json({ error: 'membership_tree_mismatch' });
        return;
      }
      slashRemoval = {
        leafIndex: membershipLeaf.leafIndex,
        nextRoot: transition.nextRoot,
        removedTree,
      };
    }

    const feeSponsorUrl = process.env.FEE_SPONSOR_URL || 'http://localhost:3002';
    const relayRes = await fetch(`${feeSponsorUrl}/v1/fee-relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ innerTransactionXdr }),
    });
    const relayData = await relayRes.json();

    if (!relayRes.ok) {
      res.status(502).json({
        error: 'fee_relay_rejected',
        message: relayData.error ?? 'unknown',
      });
      return;
    }

    if (relayData.method !== 'slash') {
      res.status(502).json({ error: 'fee_relay_rejected', message: 'unexpected relay method' });
      return;
    }
    if (slashRemoval) {
      await gatewayStore.removeMembershipLeaf(
        slashRemoval.leafIndex,
        slashRemoval.nextRoot,
        slashRemoval.removedTree.getLayers().map((layer) => layer.map(String)),
      );
      merkleTree.replaceWith(slashRemoval.removedTree);
    }

    res.json({
      slashed: true,
      method: relayData.method,
      feeBumpHash: relayData.feeBumpHash,
      duplicate: relayData.duplicate ?? false,
      innerTxHash: relayData.innerTxHash,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.error('/v1/slash error:', message);
    res.status(503).json({ error: 'fee_relay_unavailable', message });
  }
});

// ─── POST /v1/api-keys (onboarding, requires auth header) ──────

app.post('/v1/api-keys', async (req: Request, res: Response) => {
  try {
    // Require shared secret from web app for inter-service auth
    const authHeader = req.headers.authorization;
    const gatewaySecret = process.env.GATEWAY_SECRET || '';
    if (!gatewaySecret) {
      console.error('GATEWAY_SECRET not set — refusing to create API keys');
      res.status(500).json({ error: 'server_misconfigured' });
      return;
    }
    if (!authHeader || authHeader !== `Bearer ${gatewaySecret}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const key = PUBLIC_COMPATIBILITY_KEY;
    // The returned bearer is transport compatibility only. It is deliberately
    // not persisted with a commitment or joined to any accepted call.
    res.json({ apiKey: key, baseUrl: `${req.protocol}://${req.get('host')}/v1` });
  } catch (err) {
    console.error('/v1/api-keys error:', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// ─── GET /v1/status/:commitment (dashboard data) ────────────────

app.get('/v1/status/:commitment', async (req: Request, res: Response) => {
  try {
    const { commitment } = req.params as { commitment: string };
    if (!commitment) {
      res.status(400).json({ error: 'missing_commitment' });
      return;
    }

    let deposit: DepositState | null;
    if (!process.env.ZK_CONTRACT_ID) {
      // Local/demo mode has no chain deployment. The browser ticket ledger
      // still exercises the complete proof and gateway path; a configured
      // deployment supplies the authoritative deposit state here.
      deposit = null;
    } else {
      const contractModule = await import('./contract.js');
      try {
        deposit = await contractModule.getDeposit(commitment);
      } catch (err: unknown) {
        console.error('Deposit status read failed:', errorMessage(err));
        res.status(503).json({ error: 'credit_status_unavailable' });
        return;
      }
    }
    const depositStatus = getDepositStatus(deposit);

    res.json({
      commitment,
      callsThisEpoch: 0,
      epochQuota: STARTER_TICKET_COUNT,
      remainingCalls: STARTER_TICKET_COUNT,
      activeKeys: 0,
      balanceUsdc: depositStatus === 'active' ? String(deposit!.amount) : '0',
      depositStatus,
    });
  } catch (err) {
    console.error('/v1/status error:', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// ─── GET /v1/contract-status (on-chain contract state) ──────────

app.get('/v1/contract-status', async (_req: Request, res: Response) => {
  try {
    const contractModule = await import('./contract.js');
    const [depositCount, currentRoot] = await Promise.all([
      contractModule.getDepositCount(),
      contractModule.getCurrentRoot(),
    ]);
    res.json({
      contractId: process.env.ZK_CONTRACT_ID || 'not configured',
      depositCount,
      currentRoot,
      network: 'stellar:testnet',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown';
    res.json({
      contractId: process.env.ZK_CONTRACT_ID || 'not configured',
      error: message,
      network: 'stellar:testnet',
    });
  }
});

// ─── POST /v1/internal/evaluation/purge ────────────────────────
// This operational endpoint is intentionally separate from the participant
// routes and uses its own secret. It returns only a count, never a record.
app.post('/v1/internal/evaluation/purge', async (req: Request, res: Response) => {
  if (!requireEvaluationPurgeSecret(req, res)) return;
  try {
    res.json({ purged: await purgeExpiredEvaluationData() });
  } catch (error) {
    console.error('evaluation purge route failed:', error instanceof Error ? error.message : 'unknown');
    res.status(500).json({ error: 'evaluation_purge_failed' });
  }
});

// ─── Authenticated Level 4 evaluation routes ───────────────────
// These routes receive only the derived participant id. The source GitHub
// subject and EVALUATION_HMAC_SECRET remain in the web service.

app.post('/v1/evaluation/enroll', async (req: Request, res: Response) => {
  if (!requireGatewaySecret(req, res)) return;
  const participantId = evaluationParticipantId(req, res);
  if (!participantId) return;
  try {
    const body = req.body;
    const consentVersion = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>).consentVersion
      : undefined;
    if (typeof consentVersion !== 'string') {
      res.status(400).json({ error: 'invalid_fields' });
      return;
    }
    res.json(await evaluationStore.enroll(participantId, consentVersion));
  } catch (error) {
    evaluationErrorResponse(res, error);
  }
});

app.get('/v1/evaluation/status', async (req: Request, res: Response) => {
  if (!requireGatewaySecret(req, res)) return;
  const participantId = evaluationParticipantId(req, res);
  if (!participantId) return;
  try {
    res.json(await evaluationStore.getStatus(participantId));
  } catch (error) {
    evaluationErrorResponse(res, error);
  }
});

app.post('/v1/evaluation/challenge', async (req: Request, res: Response) => {
  if (!requireGatewaySecret(req, res)) return;
  const participantId = evaluationParticipantId(req, res);
  if (!participantId) return;
  try {
    res.json(await evaluationStore.createChallenge(participantId));
  } catch (error) {
    evaluationErrorResponse(res, error);
  }
});

app.post('/v1/evaluation/wallet-proof', async (req: Request, res: Response) => {
  if (!requireGatewaySecret(req, res)) return;
  const participantId = evaluationParticipantId(req, res);
  if (!participantId) return;
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'invalid_fields' });
      return;
    }
    const { challengeId, address, signature, network, message } = body as Record<string, unknown>;
    if (typeof challengeId !== 'string' || challengeId.length === 0 || challengeId.length > 256
      || typeof address !== 'string' || address.length > 64
      || typeof signature !== 'string' || signature.length > 128
      || typeof network !== 'string' || network.length === 0 || network.length > 32
      || (message !== undefined && (typeof message !== 'string' || message.length > 2_048))) {
      res.status(400).json({ error: 'invalid_fields' });
      return;
    }
    res.json(await evaluationStore.verifyWallet(participantId, {
      challengeId,
      address,
      signature,
      network,
      ...(message !== undefined ? { message } : {}),
    }));
  } catch (error) {
    evaluationErrorResponse(res, error);
  }
});

app.post('/v1/evaluation/feedback', async (req: Request, res: Response) => {
  if (!requireGatewaySecret(req, res)) return;
  const participantId = evaluationParticipantId(req, res);
  if (!participantId) return;
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'invalid_fields' });
      return;
    }
    res.json(await evaluationStore.submitFeedback(participantId, body));
  } catch (error) {
    evaluationErrorResponse(res, error);
  }
});

app.post('/v1/evaluation/deposit', async (req: Request, res: Response) => {
  if (!requireGatewaySecret(req, res)) return;
  const participantId = evaluationParticipantId(req, res);
  if (!participantId) return;
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'invalid_fields' });
      return;
    }
    const { transactionHash, newRoot, confirmedAt } = body as Record<string, unknown>;
    if (typeof transactionHash !== 'string' || !transactionHash) {
      res.status(400).json({ error: 'missing_transaction_hash' });
      return;
    }
    if (newRoot !== undefined && typeof newRoot !== 'string') {
      res.status(400).json({ error: 'invalid_fields' });
      return;
    }
    if (confirmedAt !== undefined && (typeof confirmedAt !== 'number' || !Number.isFinite(confirmedAt))) {
      res.status(400).json({ error: 'invalid_fields' });
      return;
    }
    res.json(await evaluationStore.linkDeposit(participantId, transactionHash, {
      newRoot,
      confirmedAt,
    }));
  } catch (error) {
    evaluationErrorResponse(res, error);
  }
});

app.post('/v1/evaluation/checkout', async (req: Request, res: Response) => {
  if (!requireGatewaySecret(req, res)) return;
  const participantId = evaluationParticipantId(req, res);
  if (!participantId) return;
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'invalid_fields' });
      return;
    }
    const { checkoutSessionId, amountCents, eventId } = body as Record<string, unknown>;
    if (typeof checkoutSessionId !== 'string' || typeof amountCents !== 'number'
      || !Number.isInteger(amountCents) || (eventId !== undefined && typeof eventId !== 'string')) {
      res.status(400).json({ error: 'invalid_fields' });
      return;
    }
    res.json(await evaluationStore.recordCheckout(participantId, {
      checkoutSessionId,
      amountCents,
      eventId,
    }));
  } catch (error) {
    evaluationErrorResponse(res, error);
  }
});

app.get('/v1/evaluation/checkout', async (req: Request, res: Response) => {
  if (!requireGatewaySecret(req, res)) return;
  const participantId = evaluationParticipantId(req, res);
  if (!participantId) return;
  const checkoutSessionId = req.query.sessionId;
  if (typeof checkoutSessionId !== 'string' || !checkoutSessionId) {
    res.status(400).json({ error: 'missing_checkout_session' });
    return;
  }
  try {
    res.json(await evaluationStore.getCheckout(participantId, checkoutSessionId));
  } catch (error) {
    evaluationErrorResponse(res, error);
  }
});

app.post('/v1/evaluation/checkout/status', async (req: Request, res: Response) => {
  if (!requireGatewaySecret(req, res)) return;
  const participantId = evaluationParticipantId(req, res);
  if (!participantId) return;
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'invalid_fields' });
      return;
    }
    const { checkoutSessionId, status, transactionHash, newRoot } = body as Record<string, unknown>;
    if (typeof checkoutSessionId !== 'string' || typeof status !== 'string'
      || (transactionHash !== undefined && typeof transactionHash !== 'string')
      || (newRoot !== undefined && typeof newRoot !== 'string')) {
      res.status(400).json({ error: 'invalid_fields' });
      return;
    }
    res.json(await evaluationStore.markCheckout(participantId, checkoutSessionId, {
      status: status as Parameters<EvaluationStore['markCheckout']>[2]['status'],
      transactionHash,
      newRoot,
    }));
  } catch (error) {
    evaluationErrorResponse(res, error);
  }
});

// ─── POST /v1/deposits (on-chain deposit, requires GATEWAY_SECRET) ─

// Shared deposit path: insert into the off-chain Merkle tree, then submit the
// on-chain deposit. Used by /v1/deposits and by the billing webhook relay
// (once per unique Stripe event — idempotency is enforced in billingStore).
let depositQueue: Promise<void> = Promise.resolve();

async function withDepositLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = depositQueue;
  let release: () => void;
  depositQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await operation();
  } finally {
    release!();
  }
}

export async function submitDeposit(
  commitment: string,
  amount: string | number,
): Promise<{
  txHash: string;
  newRoot: string;
  leafIndex: number;
}> {
  const gatewaySecretKey = process.env.GATEWAY_SECRET_KEY;
  if (!gatewaySecretKey) {
    throw new Error('gateway_key_not_configured');
  }

  const canonicalCommitment = BigInt(commitment).toString();

  return withDepositLock(async () => {
    const candidateTree = merkleTree.clone();
    const leafIndex = candidateTree.getLeaves().indexOf(0n);
    if (leafIndex < 0) throw new Error('Tree is full');
    const newRoot = await candidateTree.insert(BigInt(canonicalCommitment));

    await gatewayStore.reserveMembershipLeaf({
      leafIndex,
      commitment: canonicalCommitment,
      candidateRoot: newRoot.toString(),
    });

    const contractModule = await import('./contract.js');
    let txHash: string;
    try {
      txHash = await contractModule.deposit(
        gatewaySecretKey,
        canonicalCommitment,
        newRoot.toString(),
        amount.toString(),
      );
    } catch (err) {
      await gatewayStore.discardPendingMembershipLeaf(leafIndex);
      throw err;
    }

    await gatewayStore.activateMembershipLeaf(
      leafIndex,
      newRoot.toString(),
      candidateTree.getLayers().map((layer) => layer.map(String)),
    );
    merkleTree.replaceWith(candidateTree);
    return { txHash, newRoot: newRoot.toString(), leafIndex };
  });
}

app.post('/v1/deposits', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const gatewaySecret = process.env.GATEWAY_SECRET || '';
    if (!gatewaySecret) {
      res.status(500).json({ error: 'server_misconfigured' });
      return;
    }
    if (!authHeader || authHeader !== `Bearer ${gatewaySecret}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const { commitment, amount } = req.body;
    if (!commitment || !amount) {
      res.status(400).json({ error: 'missing_fields', required: ['commitment', 'amount'] });
      return;
    }

    const result = await submitDeposit(commitment, amount);
    res.json({
      deposited: true,
      txHash: result.txHash,
      commitment,
      amount: amount.toString(),
      newRoot: result.newRoot,
      leafIndex: result.leafIndex,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.error('/v1/deposits error:', message);
    if (message === 'gateway_key_not_configured') {
      res.status(500).json({ error: 'gateway_key_not_configured', message: 'GATEWAY_SECRET_KEY not set' });
      return;
    }
    res.status(500).json({ error: 'deposit_failed', message });
  }
});

// ─── POST /v1/billing/stripe-event (idempotent webhook relay, M2.3) ─
// The web app verifies the Stripe signature, then relays the verified event
// here. Evaluation checkouts use their durable receipt claim as the deposit
// idempotency anchor; launch-era checkouts continue using the existing staged
// submitDeposit path.

app.post('/v1/billing/stripe-event', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const gatewaySecret = process.env.GATEWAY_SECRET || '';
    if (!gatewaySecret) {
      res.status(500).json({ error: 'server_misconfigured' });
      return;
    }
    if (!authHeader || authHeader !== `Bearer ${gatewaySecret}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'invalid_fields' });
      return;
    }
    const {
      eventId,
      eventType,
      payloadHash,
      commitment,
      amount,
      participantId,
      checkoutSessionId,
      amountCents,
    } = body as Record<string, unknown>;
    if (typeof eventId !== 'string' || !eventId
      || typeof eventType !== 'string' || !eventType
      || typeof payloadHash !== 'string' || !payloadHash) {
      res.status(400).json({
        error: 'missing_fields',
        required: ['eventId', 'eventType', 'payloadHash'],
      });
      return;
    }

    // Idempotency: the first delivery is processed; every retry is a no-op.
    const { inserted, event } = await billingStore.recordStripeEventOnce(
      eventId,
      eventType,
      payloadHash,
    );

    if (!inserted && (event.eventType !== eventType || event.payloadHash !== payloadHash)) {
      res.status(409).json({ error: 'billing_event_conflict', eventId });
      return;
    }

    if (!inserted && event.processed) {
      res.json({ received: true, processed: true, duplicate: true, eventId });
      return;
    }

    const evaluationRequested = participantId !== undefined
      || checkoutSessionId !== undefined
      || amountCents !== undefined;
    if (evaluationRequested) {
      if (eventType !== 'checkout.session.completed'
        || typeof participantId !== 'string' || !/^[a-f0-9]{64}$/.test(participantId)
        || typeof checkoutSessionId !== 'string' || checkoutSessionId.length === 0
        || typeof amountCents !== 'number' || !Number.isInteger(amountCents)
        || amountCents !== EVALUATION_CHECKOUT_AMOUNT_CENTS
        || typeof commitment !== 'string' || !commitment
        || (typeof amount !== 'string' && typeof amount !== 'number')) {
        res.status(400).json({ error: 'invalid_evaluation_metadata' });
        return;
      }

      const participantHeader = req.headers['x-evaluation-participant-id'];
      const headerValue = Array.isArray(participantHeader) ? participantHeader[0] : participantHeader;
      if (headerValue !== participantId) {
        res.status(401).json({ error: 'evaluation_participant_mismatch' });
        return;
      }

      try {
        const status = await evaluationStore.getStatus(participantId);
        if (!status.wallet.verified) {
          throw new EvaluationError('wallet_not_verified', 'Wallet verification is required before checkout');
        }
        const receipt = await evaluationStore.recordCheckout(participantId, {
          checkoutSessionId,
          amountCents,
          eventId,
        });

        if (receipt.processingStatus === 'confirmed' && receipt.transactionHash) {
          if (!status.deposit.confirmed) {
            await evaluationStore.linkDeposit(participantId, receipt.transactionHash, {
              newRoot: receipt.newRoot ?? undefined,
            });
          }
          await billingStore.markStripeEventProcessed(eventId);
          res.json({
            received: true,
            processed: true,
            duplicate: true,
            eventId,
            txHash: receipt.transactionHash,
            newRoot: receipt.newRoot,
          });
          return;
        }

        const claim = await evaluationStore.claimCheckout(participantId, checkoutSessionId);
        if (!claim.claimed) {
          if (claim.receipt.processingStatus === 'confirmed' && claim.receipt.transactionHash) {
            await billingStore.markStripeEventProcessed(eventId);
            res.json({
              received: true,
              processed: true,
              duplicate: true,
              eventId,
              txHash: claim.receipt.transactionHash,
              newRoot: claim.receipt.newRoot,
            });
            return;
          }
          res.status(409).json({ error: 'checkout_in_progress', retryable: true, eventId });
          return;
        }

        let result: Awaited<ReturnType<typeof submitDeposit>> | null = null;
        try {
          result = await submitDeposit(commitment, amount);
          // Confirm the durable receipt before linking the participant. If the
          // process is interrupted after the chain accepts the transaction,
          // the retry can finish the link without submitting again.
          await evaluationStore.markCheckout(participantId, checkoutSessionId, {
            status: 'confirmed',
            transactionHash: result.txHash,
            newRoot: result.newRoot,
          });
          await evaluationStore.linkDeposit(participantId, result.txHash, {
            newRoot: result.newRoot,
          });
        } catch (error) {
          // Once the chain result exists, keep the receipt confirmed so a
          // retry only repairs participant linkage. A failed submission is
          // explicitly retryable and remains unprocessed in billing.
          if (!result) {
            try {
              await evaluationStore.markCheckout(participantId, checkoutSessionId, { status: 'failed' });
            } catch (markError) {
              console.error('/v1/billing/stripe-event evaluation failure state unavailable:', markError);
            }
          }
          throw error;
        }

        await billingStore.markStripeEventProcessed(eventId);
        res.json({
          received: true,
          processed: true,
          eventId,
          txHash: result.txHash,
          newRoot: result.newRoot,
        });
        return;
      } catch (error) {
        if (error instanceof EvaluationError) {
          evaluationErrorResponse(res, error);
          return;
        }
        throw error;
      }
    }

    if (eventType === 'checkout.session.completed') {
      if ((typeof commitment !== 'string' && typeof commitment !== 'number')
        || (typeof amount !== 'string' && typeof amount !== 'number')
        || !commitment || !amount) {
        // Event delivered, but the deposit cannot be submitted yet (e.g. the
        // user never completed onboarding). Record the receipt so a retry is
        // not lost on restart; surface the warning to the web app.
        await billingStore.markStripeEventProcessed(eventId);
        res.json({
          received: true,
          processed: false,
          skipped: 'missing_commitment_or_amount',
          eventId,
        });
        return;
      }
      const result = await submitDeposit(String(commitment), amount);
      await billingStore.markStripeEventProcessed(eventId);
      res.json({
        received: true,
        processed: true,
        eventId,
        txHash: result.txHash,
        newRoot: result.newRoot,
      });
      return;
    }

    // Non-checkout event types are recorded but require no deposit.
    await billingStore.markStripeEventProcessed(eventId);
    res.json({ received: true, processed: true, eventId });
  } catch {
    console.error('/v1/billing/stripe-event failed');
    res.status(500).json({ error: 'billing_event_failed' });
  }
});

// ─── POST /v1/withdraw (gateway-mediated withdrawal, M2.5) ───────
// The browser supplies a membership-removal proof; the gateway co-signs the
// inner tx as the custodial depositor and hands it to the fee-sponsor relay so
// the user never needs XLM. GATEWAY_SECRET-gated (web app relays the request).

app.post('/v1/withdraw', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const gatewaySecret = process.env.GATEWAY_SECRET || '';
    if (!gatewaySecret) {
      res.status(500).json({ error: 'server_misconfigured' });
      return;
    }
    if (!authHeader || authHeader !== `Bearer ${gatewaySecret}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const { withdrawalProof, pubSignals, commitment, recipient } = req.body;
    if (!withdrawalProof || !Array.isArray(pubSignals) || !commitment || !recipient) {
      res.status(400).json({
        error: 'missing_fields',
        required: ['withdrawalProof', 'pubSignals', 'commitment', 'recipient'],
      });
      return;
    }
    if (
      typeof commitment !== 'string'
      || pubSignals.length !== 3
      || !pubSignals.every((signal) => typeof signal === 'string')
    ) {
      res.status(400).json({ error: 'invalid_membership_transition' });
      return;
    }

    const membershipLeaf = (await gatewayStore.listMembershipLeaves())
      .find((leaf) => leaf.commitment === commitment && leaf.status === 'active');
    if (!membershipLeaf || pubSignals[0] !== commitment || merkleTree.root().toString() !== pubSignals[1]) {
      res.status(409).json({ error: 'membership_tree_mismatch' });
      return;
    }
    const removedTree = merkleTree.clone();
    const computedNextRoot = await removedTree.setLeaf(membershipLeaf.leafIndex, 0n);
    if (computedNextRoot.toString() !== pubSignals[2]) {
      res.status(409).json({ error: 'membership_tree_mismatch' });
      return;
    }

    const gatewaySecretKey = process.env.GATEWAY_SECRET_KEY;
    if (!gatewaySecretKey) {
      res.status(500).json({ error: 'gateway_key_not_configured', message: 'GATEWAY_SECRET_KEY not set' });
      return;
    }

    const contractModule = await import('./contract.js');
    const innerTxXdr = await contractModule.buildWithdrawEnvelope(
      gatewaySecretKey,
      withdrawalProof,
      pubSignals,
      commitment,
      recipient,
    );

    // Hand the envelope to the fee-sponsor relay for a fee bump (fee-only).
    const feeSponsorUrl =
      process.env.FEE_SPONSOR_URL || 'http://localhost:3002';
    const relayRes = await fetch(`${feeSponsorUrl}/v1/fee-relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ innerTransactionXdr: innerTxXdr }),
    });
    const relayData = await relayRes.json();

    if (!relayRes.ok) {
      res.status(502).json({ error: 'fee_relay_rejected', message: relayData.error ?? 'unknown' });
      return;
    }

    await gatewayStore.removeMembershipLeaf(
      membershipLeaf.leafIndex,
      computedNextRoot.toString(),
      removedTree.getLayers().map((layer) => layer.map(String)),
    );
    merkleTree.replaceWith(removedTree);

    res.json({
      withdrawn: true,
      commitment,
      recipient,
      feeBumpHash: relayData.feeBumpHash,
      duplicate: relayData.duplicate ?? false,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.error('/v1/withdraw error:', message);
    res.status(500).json({ error: 'withdraw_failed', message });
  }
});

// ─── Start ───────────────────────────────────────────────────────

const isMain = typeof require !== 'undefined' && typeof module !== 'undefined'
  ? require.main === module
  : (process.argv[1] ? path.resolve(process.argv[1]).includes('server') : false);

if (isMain) {
  setIsReady(false);
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`ZK-API Credits Gateway listening on port ${PORT}`);
    console.log(`OpenRouter: ${OPENROUTER_API_KEY ? 'configured' : 'not configured'}`);
    console.log(`Starter package: ${STARTER_TICKET_COUNT} indexed tickets`);
    console.log('Proof verification: enabled');
  });

  initDurableGatewayStore()
    .then(() => {
      console.log('Durable storage: postgresql (gateway schema)');
      console.log('Gateway durable stores and tree verification completed: READY');
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'unknown';
      console.error('FATAL: database unavailable — refusing to start with non-durable state:', message);
      server.close(() => process.exit(1));
    });
}

export { app };
