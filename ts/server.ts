// ZK-API Credits Gateway Server
// OpenAI-compatible /v1/chat/completions endpoint with ZK proof relay

import express, { Request, Response } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { OpenRouterAdapter, MockProviderAdapter, registerAdapter, getAdapter } from './providerAdapter.js';
import { MerkleTree } from './merkle.js';

const PORT = Number(process.env.PORT ?? 3001);

// ─── In-memory stores (replace with DB in production) ────────────

const apiKeys = new Map<string, { commitment: string; label: string }>();
const nullifierCache = new Set<string>();
const callCounts = new Map<string, number>();
const merkleTree = new MerkleTree();

// ─── Config ──────────────────────────────────────────────────────

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const EPOCH_QUOTA = Number(process.env.DEFAULT_EPOCH_QUOTA ?? '100');

// ─── Verification key (loaded at startup) ────────────────────────

let verificationKey: object;

function loadVerificationKey(): object {
  const circuitsDir = process.env.CIRCUITS_DIR || path.resolve(import.meta.dirname!, '..', '..', 'circuits');
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
      res.status(400).json({ error: 'invalid_proof_header', message: err.message });
      return;
    }

    // Verify the ZK proof
    let valid: boolean;
    try {
      valid = await verifyZkProof(zkProof.proof, zkProof.pubSignals);
    } catch (err: any) {
      console.error('Proof verification error:', err);
      res.status(403).json({ error: 'proof_verification_failed', message: err.message });
      return;
    }

    if (!valid) {
      res.status(403).json({ error: 'invalid_proof', message: 'ZK proof verification failed' });
      return;
    }

    // pubSignals layout: [epoch, root, nullifier, share_x, share_y]
    const nullifier = zkProof.pubSignals[2];

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
    console.error('/v1/chat/completions error:', err);
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
    console.error('/v1/slash error:', err);
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
    console.error('/v1/api-keys error:', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// ─── GET /v1/status/:commitment (dashboard data) ────────────────

app.get('/v1/status/:commitment', (req: Request, res: Response) => {
  try {
    const { commitment } = req.params;
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

    res.json({
      commitment,
      callsThisEpoch: userCalls,
      epochQuota: EPOCH_QUOTA,
      remainingCalls: Math.max(0, EPOCH_QUOTA - userCalls),
      activeKeys: userKeys.length,
      balanceUsdc: '0',
      depositStatus: null,
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

    const gatewaySecretKey = process.env.GATEWAY_SECRET_KEY;
    if (!gatewaySecretKey) {
      res.status(500).json({ error: 'gateway_key_not_configured', message: 'GATEWAY_SECRET_KEY not set' });
      return;
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

    res.json({
      deposited: true,
      txHash,
      commitment,
      amount: amount.toString(),
      newRoot: newRoot.toString(),
      leafIndex: merkleTree.getLeafCount() - 1,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.error('/v1/deposits error:', message);
    res.status(500).json({ error: 'deposit_failed', message });
  }
});

// ─── Start ───────────────────────────────────────────────────────

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`ZK-API Credits Gateway running on port ${PORT}`);
    console.log(`OpenRouter: ${OPENROUTER_API_KEY ? 'configured' : 'not configured'}`);
    console.log(`Quota: ${EPOCH_QUOTA} calls/epoch`);
    console.log(`Proof verification: enabled`);
  });
}

export { app, apiKeys, nullifierCache, callCounts };
