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
} from './membership-tree.js';
import { requestDigestToField, verifyGroth16Proof } from '@zk-credits/shared';
import {
  MemoryGatewayStore,
  PostgresGatewayStore,
  reconstructGatewayState,
  MemoryBillingStore,
  PostgresBillingStore,
  createPool,
  runMigrations,
  type AcceptedCall,
  type GatewayStore,
  type BillingStore,
} from './db/index.js';
import { startSpendWorker, type SpendSubmitter } from './spend-worker.js';
import { extractSlashTransition } from './fee-relay.js';

const PORT = Number(process.env.PORT ?? 3001);
const MAX_SSE_REPLAY_BYTES = Number(process.env.MAX_SSE_REPLAY_BYTES ?? 1_000_000);

// ─── Durable store (replaces the v1 in-memory Maps) ────────────
// Tests/local dev default to the memory store; production startup picks the
// Postgres store via initGatewayStore(). Handlers only talk to this contract,
// never to Maps/arrays directly.
let gatewayStore: GatewayStore = new MemoryGatewayStore();
let billingStore: BillingStore = new MemoryBillingStore();

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
  const migrationsDir = path.resolve(import.meta.dirname!, 'db', 'migrations');
  const pool = createPool(env);
  await runMigrations(pool, migrationsDir);
  const store = new PostgresGatewayStore(pool);
  const state = await reconstructGatewayState(store);
  let membershipLeaves = await store.listMembershipLeaves();
  if (env.ZK_CONTRACT_ID) {
    const contractModule = await import('./contract.js');
    const chainRoot = await contractModule.getCurrentRoot();
    if (membershipLeaves.length === 0 && env.MEMBERSHIP_TREE_BOOTSTRAP_SNAPSHOT) {
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
  return store;
}

export async function resetGatewayStoreForTests(): Promise<void> {
  setGatewayStore(new MemoryGatewayStore());
  setBillingStore(new MemoryBillingStore());
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

// ─── Verification key (loaded at startup) ────────────────────────

let verificationKey: object;

function loadVerificationKey(): object {
  const circuitsDir = process.env.CIRCUITS_DIR || path.resolve(import.meta.dirname!, '..', 'circuits');
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
app.use(express.json());

// ─── Provider adapter setup ──────────────────────────────────────

const openrouter = new OpenRouterAdapter();
const mock = new MockProviderAdapter();
registerAdapter(openrouter);
registerAdapter(mock);

// ─── Load VK at startup ─────────────────────────────────────────

verificationKey = loadVerificationKey();

// ─── Healthcheck ─────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: '0.1.0',
    network: 'stellar:testnet',
    proofVerification: 'enabled',
  });
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
    const upstreamBody = await upstream.json();
    const generationId = upstream.headers.get('x-generation-id') ??
      (typeof upstreamBody === 'object' && upstreamBody !== null && 'id' in upstreamBody
        ? String((upstreamBody as { id?: unknown }).id ?? '')
        : undefined);
    await gatewayStore.recordProviderResponse(acceptedCall.proofHash, upstream.status, upstreamBody, generationId);
    res.status(upstream.status).json(upstreamBody);
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

  return withDepositLock(async () => {
    const candidateTree = merkleTree.clone();
    const leafIndex = candidateTree.getLeaves().indexOf(0n);
    if (leafIndex < 0) throw new Error('Tree is full');
    const newRoot = await candidateTree.insert(BigInt(commitment));

    await gatewayStore.reserveMembershipLeaf({
      leafIndex,
      commitment,
      candidateRoot: newRoot.toString(),
    });

    const contractModule = await import('./contract.js');
    let txHash: string;
    try {
      txHash = await contractModule.deposit(
        gatewaySecretKey,
        commitment,
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
// here. billingStore.recordStripeEventOnce() makes redeliveries a no-op so a
// checkout->webhook->deposit flow never double-submits.

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

    const { eventId, eventType, payloadHash, commitment, amount } = req.body;
    if (!eventId || !eventType || !payloadHash) {
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

    if (!inserted) {
      res.json({ received: true, processed: false, duplicate: true, eventId });
      return;
    }

    if (eventType === 'checkout.session.completed') {
      if (!commitment || !amount) {
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
      const result = await submitDeposit(commitment, amount);
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.error('/v1/billing/stripe-event error:', message);
    res.status(500).json({ error: 'billing_event_failed', message });
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

if (require.main === module) {
  initDurableGatewayStore()
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'unknown';
      console.error('FATAL: database unavailable — refusing to start with non-durable state:', message);
      process.exit(1);
    })
    .then(() => {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`ZK-API Credits Gateway running on port ${PORT}`);
        console.log(`OpenRouter: ${OPENROUTER_API_KEY ? 'configured' : 'not configured'}`);
        console.log(`Starter package: ${STARTER_TICKET_COUNT} indexed tickets`);
        console.log('Proof verification: enabled');
        console.log('Durable storage: postgresql (gateway schema)');
      });
    });
}

export { app };
