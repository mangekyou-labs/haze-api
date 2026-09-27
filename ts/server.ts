// ZK-API Credits Gateway Server
// OpenAI-compatible /v1/chat/completions endpoint with ZK proof relay

import express, { Request, Response } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { OpenRouterAdapter, MockProviderAdapter, registerAdapter, getAdapter } from './providerAdapter.js';
import { MerkleTree } from './merkle.js';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { SlashWatcher } from './slashWatcher.js';
import {
  EvaluationError,
} from './evaluation.js';
import { createEvaluationStore } from './evaluation-store-factory.js';
import { captureGatewayException, initGatewaySentry } from './observability.js';

initGatewaySentry();

const PORT = Number(process.env.PORT ?? 3001);

// ─── In-memory stores (replace with DB in production) ────────────

const apiKeys = new Map<string, { commitment: string; label: string }>();
const nullifierCache = new Set<string>();
const callCounts = new Map<string, number>();
const merkleTree = new MerkleTree();
const depositReceipts = new Map<string, Record<string, unknown>>();
const depositInFlight = new Map<string, Promise<Record<string, unknown>>>();
// Evaluation data is isolated from the anonymous API stores. A configured
// deployment database selects the durable adapter; local tests use memory.
const evaluationSelection = createEvaluationStore();
export const evaluationStore = evaluationSelection.store;

// ─── Config ──────────────────────────────────────────────────────

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const EPOCH_QUOTA = Number(process.env.DEFAULT_EPOCH_QUOTA ?? '100');

// ─── Verification key (loaded at startup) ────────────────────────

let verificationKey: object;

function loadVerificationKey(): object {
  const circuitsDir = process.env.CIRCUITS_DIR || path.resolve(__dirname, '..', 'circuits');
  const vkPath = path.join(circuitsDir, 'verification_key_rln.json');
  if (!fs.existsSync(vkPath)) {
    console.error('FATAL: Verification key not found at', vkPath);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(vkPath, 'utf-8'));
}

// ─── Proof verification ─────────────────────────────────────────

const snarkjs = require('snarkjs');

function parseProofHeader(header: string): { proof: object; pubSignals: string[] } {
  const decoded = Buffer.from(header, 'base64').toString();
  const parsed = JSON.parse(decoded);

  if (!parsed.proof || typeof parsed.proof !== 'object') {
    throw new Error('Missing or invalid proof object');
  }
  if (!Array.isArray(parsed.pubSignals)) {
    throw new Error('Missing or invalid pubSignals array');
  }
  if (parsed.pubSignals.length < 5) {
    throw new Error(`Expected 5 public signals, got ${parsed.pubSignals.length}`);
  }

  return { proof: parsed.proof, pubSignals: parsed.pubSignals };
}

async function verifyZkProof(
  proof: object,
  pubSignals: string[],
): Promise<boolean> {
  return snarkjs.groth16.verify(verificationKey, pubSignals, proof);
}

export function getNullifierFromPublicSignals(pubSignals: string[]): string {
  // rln_nullifier outputs [root, nullifier, share_x, share_y, epoch].
  return pubSignals[1];
}

// ─── Express app ─────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

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

function evaluationParticipantId(req: Request, res: Response): string | null {
  const participantId = req.headers['x-evaluation-participant-id'];
  if (typeof participantId !== 'string' || !participantId) {
    res.status(400).json({ error: 'missing_participant_id' });
    return null;
  }
  return participantId;
}

function evaluationErrorResponse(res: Response, error: unknown): void {
  if (!(error instanceof EvaluationError)) {
    captureGatewayException(error, { component: 'evaluation' });
    console.error('Evaluation request failed');
    res.status(500).json({ error: 'internal_error' });
    return;
  }
  const status = error.code === 'rate_limited'
    ? 429
    : error.code === 'challenge_expired'
      ? 410
      : error.code === 'not_enrolled' || error.code === 'challenge_not_found'
        ? 404
        : error.code === 'wallet_already_used' || error.code === 'deposit_already_used'
          || error.code === 'checkout_already_used'
          ? 409
          : error.code === 'wallet_proof_invalid'
            ? 422
            : 400;
  res.status(status).json({ error: error.code });
}

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
    evaluationPersistence: evaluationSelection.persistence,
  });
});

// ─── Consent-based Level 4 evaluation API (internal gateway variants) ───

app.post('/v1/evaluation/enroll', async (req: Request, res: Response) => {
  if (!requireGatewaySecret(req, res)) return;
  const participantId = evaluationParticipantId(req, res);
  if (!participantId) return;
  try {
    const result = await evaluationStore.enroll(participantId, req.body?.consentVersion);
    res.json(result);
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
    res.json(await evaluationStore.submitFeedback(participantId, req.body ?? {}));
  } catch (error) {
    evaluationErrorResponse(res, error);
  }
});

// Called only after Stripe/webhook processing has confirmed the on-chain
// transaction. It links evidence by participant HMAC and never receives a
// commitment, prompt, proof, or API request body.
app.post('/v1/evaluation/deposit', async (req: Request, res: Response) => {
  if (!requireGatewaySecret(req, res)) return;
  const participantId = evaluationParticipantId(req, res);
  if (!participantId) return;
  try {
    const { transactionHash, newRoot, confirmedAt } = req.body ?? {};
    if (!transactionHash) {
      res.status(400).json({ error: 'missing_transaction_hash' });
      return;
    }
    res.json(await evaluationStore.linkDeposit(participantId, transactionHash, {
      newRoot,
      confirmedAt: typeof confirmedAt === 'number' ? confirmedAt : undefined,
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
    const { checkoutSessionId, amountCents, eventId } = req.body ?? {};
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
    const { checkoutSessionId, status, transactionHash, newRoot } = req.body ?? {};
    if (!checkoutSessionId || !status) {
      res.status(400).json({ error: 'missing_fields' });
      return;
    }
    res.json(await evaluationStore.markCheckout(participantId, checkoutSessionId, {
      status,
      transactionHash,
      newRoot,
    }));
  } catch (error) {
    evaluationErrorResponse(res, error);
  }
});

// ─── POST /v1/chat/completions (OpenAI-compatible) ──────────────

app.post('/v1/chat/completions', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const proofHeader = req.headers['x-zk-proof'] as string;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'missing_authorization' });
      return;
    }

    const apiKey = authHeader.slice(7).trim();
    const keyRecord = apiKeys.get(apiKey);

    if (!keyRecord) {
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
    } catch (err: any) {
      captureGatewayException(err, { component: 'proof-header' });
      res.status(400).json({ error: 'invalid_proof_header' });
      return;
    }

    // Verify the ZK proof
    let valid: boolean;
    try {
      valid = await verifyZkProof(zkProof.proof, zkProof.pubSignals);
    } catch (err: any) {
      captureGatewayException(err, { component: 'proof-verification' });
      console.error('Proof verification failed');
      res.status(403).json({ error: 'proof_verification_failed' });
      return;
    }

    if (!valid) {
      res.status(403).json({ error: 'invalid_proof', message: 'ZK proof verification failed' });
      return;
    }

    const nullifier = getNullifierFromPublicSignals(zkProof.pubSignals);

    if (nullifierCache.has(nullifier)) {
      res.status(403).json({ error: 'nullifier_spent', message: 'This nullifier has already been used' });
      return;
    }

    const userCalls = callCounts.get(keyRecord.commitment) ?? 0;
    if (userCalls >= EPOCH_QUOTA) {
      res.status(403).json({ error: 'over_quota', message: `Exceeded ${EPOCH_QUOTA} calls this epoch` });
      return;
    }

    nullifierCache.add(nullifier);
    callCounts.set(keyRecord.commitment, userCalls + 1);

    const adapter = getAdapter(OPENROUTER_API_KEY ? 'openrouter' : 'mock')!;
    const upstream = await adapter.forwardRequest(req.body, OPENROUTER_API_KEY);
    const upstreamBody = await upstream.json();
    res.status(upstream.status).json(upstreamBody);
  } catch (err) {
    captureGatewayException(err, { component: 'chat-completions' });
    console.error('/v1/chat/completions failed');
    res.status(500).json({ error: 'internal_error' });
  }
});

// ─── POST /v1/slash (permissionless) ────────────────────────────

app.post('/v1/slash', (req: Request, res: Response) => {
  try {
    const { slashProof, publicInputs } = req.body;
    if (!slashProof || !publicInputs) {
      res.status(400).json({ error: 'missing_fields' });
      return;
    }
    res.json({ slashed: false, note: 'Slash submission endpoint — E2E in milestone 9' });
  } catch (err) {
    captureGatewayException(err, { component: 'slash' });
    console.error('/v1/slash failed');
    res.status(500).json({ error: 'internal_error' });
  }
});

// ─── POST /v1/api-keys (onboarding, requires auth header) ──────

app.post('/v1/api-keys', (req: Request, res: Response) => {
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

    const { commitment, label } = req.body;
    if (!commitment) {
      res.status(400).json({ error: 'missing_commitment' });
      return;
    }
    const key = 'sk-zk-' + crypto.randomBytes(32).toString('hex');
    apiKeys.set(key, { commitment, label: label || 'default' });
    res.json({ apiKey: key, baseUrl: `${req.protocol}://${req.get('host')}/v1` });
  } catch (err) {
    captureGatewayException(err, { component: 'api-keys' });
    console.error('/v1/api-keys failed');
    res.status(500).json({ error: 'internal_error' });
  }
});

// ─── GET /v1/status/:commitment (dashboard data) ────────────────

app.get('/v1/status/:commitment', (req: Request, res: Response) => {
  try {
    const commitment = req.params.commitment as string;
    if (!commitment) {
      res.status(400).json({ error: 'missing_commitment' });
      return;
    }

    const userCalls = callCounts.get(commitment) ?? 0;

    const userKeys: { label: string; createdAt: number }[] = [];
    for (const [, record] of apiKeys) {
      if (record.commitment === commitment) {
        userKeys.push({ label: record.label, createdAt: Date.now() });
      }
    }

    const respond = (deposit: { amount: string; slashed: boolean; withdrawn: boolean } | null) => res.json({
      commitment,
      callsThisEpoch: userCalls,
      epochQuota: EPOCH_QUOTA,
      remainingCalls: Math.max(0, EPOCH_QUOTA - userCalls),
      activeKeys: userKeys.length,
      balanceUsdc: deposit?.amount ?? '0',
      depositStatus: deposit
        ? { slashed: deposit.slashed, withdrawn: deposit.withdrawn }
        : null,
    });

    if (!process.env.ZK_CONTRACT_ID || !process.env.GATEWAY_ADDRESS) {
      respond(null);
      return;
    }

    import('./contract.js')
      .then(({ getDeposit }) => getDeposit(commitment))
      .then(respond)
      .catch((err: unknown) => {
        captureGatewayException(err, { component: 'status-onchain' });
        console.warn('Unable to read on-chain deposit');
        respond(null);
      });
  } catch (err) {
    captureGatewayException(err, { component: 'status' });
    console.error('/v1/status failed');
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
    captureGatewayException(err, { component: 'contract-status' });
    console.error('/v1/contract-status unavailable');
    res.status(503).json({
      contractId: process.env.ZK_CONTRACT_ID || 'not configured',
      error: 'contract_unavailable',
      network: 'stellar:testnet',
    });
  }
});

// ─── POST /v1/deposits (on-chain deposit, requires GATEWAY_SECRET) ─

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

    const { commitment, amount, participantId, checkoutSessionId } = req.body;
    if (!commitment || !amount) {
      res.status(400).json({ error: 'missing_fields', required: ['commitment', 'amount'] });
      return;
    }

    const idempotencyKey = req.headers['idempotency-key']
      || (typeof checkoutSessionId === 'string' ? checkoutSessionId : undefined);
    if (typeof idempotencyKey === 'string' && idempotencyKey.length > 0) {
      const previous = depositReceipts.get(idempotencyKey);
      if (previous) {
        res.json({ ...previous, idempotent: true });
        return;
      }
    }

    const normalizedIdempotencyKey = typeof idempotencyKey === 'string' && idempotencyKey.length > 0
      ? idempotencyKey
      : null;
    if (normalizedIdempotencyKey) {
      const inFlight = depositInFlight.get(normalizedIdempotencyKey);
      if (inFlight) {
        res.json({ ...(await inFlight), idempotent: true });
        return;
      }
    }

    const gatewaySecretKey = process.env.GATEWAY_SECRET_KEY;
    if (!gatewaySecretKey) {
      res.status(500).json({ error: 'gateway_key_not_configured', message: 'GATEWAY_SECRET_KEY not set' });
      return;
    }

    const processDeposit = async (): Promise<Record<string, unknown>> => {
      // A durable confirmed checkout receipt is the cross-instance idempotency
      // anchor. The in-memory receipt below handles the common warm-process path.
      if (typeof participantId === 'string' && typeof checkoutSessionId === 'string' && checkoutSessionId) {
        try {
          const checkout = await evaluationStore.getCheckout(participantId, checkoutSessionId);
          if (checkout.processingStatus === 'confirmed' && checkout.transactionHash) {
            return {
              deposited: true,
              txHash: checkout.transactionHash,
              commitment,
              amount: amount.toString(),
              newRoot: checkout.newRoot,
              leafIndex: -1,
            };
          }
        } catch (error) {
          if (!(error instanceof EvaluationError) || error.code !== 'checkout_not_found') throw error;
        }
      }

      // Insert commitment into off-chain Merkle tree
      const commitmentBigInt = BigInt(commitment);
      const newRoot = await merkleTree.insert(commitmentBigInt);

      // Submit on-chain deposit
      const contractModule = await import('./contract.js');
      const txHash = await contractModule.deposit(
        gatewaySecretKey,
        commitment,
        newRoot.toString(),
        amount.toString(),
      );

      if (typeof participantId === 'string') {
        await evaluationStore.linkDeposit(participantId, txHash, { newRoot: newRoot.toString() });
        if (typeof checkoutSessionId === 'string' && checkoutSessionId) {
          await evaluationStore.markCheckout(participantId, checkoutSessionId, {
            status: 'confirmed',
            transactionHash: txHash,
            newRoot: newRoot.toString(),
          });
        }
      }

      const responseBody = {
        deposited: true,
        txHash,
        commitment,
        amount: amount.toString(),
        newRoot: newRoot.toString(),
        leafIndex: merkleTree.getLeafCount() - 1,
      };
      if (normalizedIdempotencyKey) depositReceipts.set(normalizedIdempotencyKey, responseBody);
      return responseBody;
    };

    if (normalizedIdempotencyKey) {
      const pending = processDeposit();
      depositInFlight.set(normalizedIdempotencyKey, pending);
      try {
        res.json(await pending);
      } finally {
        if (depositInFlight.get(normalizedIdempotencyKey) === pending) {
          depositInFlight.delete(normalizedIdempotencyKey);
        }
      }
      return;
    }

    res.json(await processDeposit());
  } catch (err: unknown) {
    captureGatewayException(err, { component: 'deposits' });
    console.error('/v1/deposits failed');
    res.status(500).json({ error: 'deposit_failed' });
  }
});

// ─── Start ───────────────────────────────────────────────────────

if (require.main === module) {
  if (process.env.SLASH_WATCHER_ENABLED === 'true' && process.env.ZK_CONTRACT_ID) {
    const rpcServer = new SorobanRpc.Server(
      process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
      { allowHttp: true },
    );
    const watcher = new SlashWatcher({
      contractId: process.env.ZK_CONTRACT_ID,
      startLedger: Number(process.env.SLASH_WATCHER_START_LEDGER || '1'),
      eventSource: rpcServer,
      onCollision: (collision) => {
        captureGatewayException(new Error('Nullifier collision detected'), { component: 'slash-watcher' });
        console.error('Nullifier collision detected; slash proof required');
      },
    });
    const poll = async () => {
      try {
        await watcher.pollOnce();
      } catch (err) {
        captureGatewayException(err, { component: 'slash-watcher' });
        console.error('Slash watcher poll failed');
      }
      setTimeout(poll, Number(process.env.SLASH_WATCHER_INTERVAL_MS || '5000'));
    };
    void poll();
  }

  app.listen(PORT, () => {
    console.log(`ZK-API Credits Gateway running on port ${PORT}`);
    console.log(`OpenRouter: ${OPENROUTER_API_KEY ? 'configured' : 'not configured'}`);
    console.log(`Quota: ${EPOCH_QUOTA} calls/epoch`);
    console.log(`Proof verification: enabled`);
  });
}

export { app, apiKeys, nullifierCache, callCounts };
