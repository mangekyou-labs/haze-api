import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { app, apiKeys, nullifierCache, callCounts, getNullifierFromPublicSignals } from './server.js';
import { getDeposit } from './contract.js';
import request from 'supertest';

// snarkjs does not publish TypeScript declarations in this version.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const snarkjs = require('snarkjs') as {
  groth16: {
    fullProve: (input: object, wasmPath: string, zkeyPath: string) => Promise<{
      proof: object;
      publicSignals: string[];
    }>;
  };
};

vi.mock('./contract.js', () => ({
  deposit: vi.fn().mockResolvedValue('mock-tx-hash-abc123'),
  getDepositCount: vi.fn().mockResolvedValue(0),
  getCurrentRoot: vi.fn().mockResolvedValue('0'),
  getDeposit: vi.fn().mockResolvedValue(null),
  isNullifierSpent: vi.fn().mockResolvedValue(false),
}));

beforeEach(() => {
  apiKeys.clear();
  nullifierCache.clear();
  callCounts.clear();
  process.env.GATEWAY_SECRET = 'test-secret';
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ZK_CONTRACT_ID;
  delete process.env.GATEWAY_ADDRESS;
});

describe('gateway server', () => {
  it('reads the nullifier from the RLN public-signal slot', () => {
    expect(getNullifierFromPublicSignals(['root', 'nullifier', 'share-x', 'share-y', 'epoch']))
      .toBe('nullifier');
  });

  describe('GET /health', () => {
    it('returns ok status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('POST /v1/api-keys', () => {
    it('generates API key for valid commitment with auth', async () => {
      const res = await request(app)
        .post('/v1/api-keys')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '0x1234', label: 'test' });
      expect(res.status).toBe(200);
      expect(res.body.apiKey).toMatch(/^sk-zk-/);
      expect(res.body.baseUrl).toContain('/v1');
    });

    it('rejects missing auth', async () => {
      const res = await request(app)
        .post('/v1/api-keys')
        .send({ commitment: '0x1234' });
      expect(res.status).toBe(401);
    });

    it('rejects missing commitment', async () => {
      const res = await request(app)
        .post('/v1/api-keys')
        .set('Authorization', 'Bearer test-secret')
        .send({ label: 'test' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /v1/chat/completions', () => {
    it('rejects missing auth', async () => {
      const res = await request(app)
        .post('/v1/chat/completions')
        .send({ model: 'test', messages: [] });
      expect(res.status).toBe(401);
    });

    it('rejects invalid API key', async () => {
      const res = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-zk-invalid')
        .send({ model: 'test', messages: [] });
      expect(res.status).toBe(401);
    });

    it('requests proof when missing', async () => {
      const res = await request(app)
        .post('/v1/api-keys')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '0xdead', label: 'test' });
      const key = res.body.apiKey;

      const chatRes = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${key}`)
        .send({ model: 'anthropic/claude-opus-4', messages: [{ role: 'user', content: 'hi' }] });
      expect(chatRes.status).toBe(402);
      expect(chatRes.body.error).toBe('proof_required');
    });

    it('rejects malformed proof header', async () => {
      const keyRes = await request(app)
        .post('/v1/api-keys')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '0xbeef', label: 'test' });
      const key = keyRes.body.apiKey;

      const chatRes = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${key}`)
        .set('X-ZK-Proof', Buffer.from('not-json').toString('base64'))
        .send({ model: 'test', messages: [] });
      expect(chatRes.status).toBe(400);
      expect(chatRes.body.error).toBe('invalid_proof_header');
    });

    it('rejects proof with wrong signal count', async () => {
      const keyRes = await request(app)
        .post('/v1/api-keys')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '0xbeef', label: 'test' });
      const key = keyRes.body.apiKey;

      const proofHeader = Buffer.from(JSON.stringify({
        proof: { a: '1', b: '2', c: '3' },
        pubSignals: ['1', '2'], // too few
      })).toString('base64');

      const chatRes = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${key}`)
        .set('X-ZK-Proof', proofHeader)
        .send({ model: 'test', messages: [] });
      expect(chatRes.status).toBe(400);
      expect(chatRes.body.error).toBe('invalid_proof_header');
    });

    it('rejects invalid proof (verification fails)', async () => {
      const keyRes = await request(app)
        .post('/v1/api-keys')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '0xbeef', label: 'test' });
      const key = keyRes.body.apiKey;

      const proofHeader = Buffer.from(JSON.stringify({
        proof: { a: '1', b: '2', c: '3' },
        pubSignals: ['0', '1', '2', '3', '4'],
      })).toString('base64');

      const chatRes = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${key}`)
        .set('X-ZK-Proof', proofHeader)
        .send({ model: 'test', messages: [] });
      // Proof verification should fail for dummy proof
      expect(chatRes.status).toBe(403);
    });

    it('rejects proof with missing proof object fields', async () => {
      const keyRes = await request(app)
        .post('/v1/api-keys')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '0xcafe', label: 'test' });
      const key = keyRes.body.apiKey;

      const proofHeader = Buffer.from(JSON.stringify({
        proof: { missing: 'fields' },
        pubSignals: ['0', '1', '2', '3', '4'],
      })).toString('base64');

      const chatRes = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${key}`)
        .set('X-ZK-Proof', proofHeader)
        .send({ model: 'test', messages: [] });
      // Verification should still fail gracefully
      expect(chatRes.status).toBe(403);
    });

    it.skipIf(
      process.env.RUN_OPENROUTER_E2E !== '1' || !process.env.OPENROUTER_API_KEY,
    )('forwards a valid proof-backed request to OpenRouter', async () => {
      const keyRes = await request(app)
        .post('/v1/api-keys')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: 'openrouter-e2e', label: 'openrouter-e2e' });
      const key = keyRes.body.apiKey;
      const circuitsDir = path.resolve(process.cwd(), '..', 'circuits');
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        {
          secret_k: '42',
          signal_value: '123',
          epoch: '100',
          merkle_path_elements: ['0', '0', '0'],
          merkle_path_indices: ['0', '0', '0'],
        },
        path.join(circuitsDir, 'rln_nullifier.wasm'),
        path.join(circuitsDir, 'rln_nullifier_final.zkey'),
      );
      const proofHeader = Buffer.from(JSON.stringify({ proof, pubSignals: publicSignals })).toString('base64');

      const chatRes = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${key}`)
        .set('X-ZK-Proof', proofHeader)
        .send({
          model: process.env.OPENROUTER_TEST_MODEL || 'openai/gpt-4o-mini',
          messages: [{ role: 'user', content: 'Reply with exactly: gateway-ok' }],
          max_tokens: 8,
        });

      expect(chatRes.status).toBe(200);
      expect(chatRes.body.choices?.[0]?.message?.content).toBeTruthy();
    });
  });

  describe('POST /v1/slash', () => {
    it('accepts slash submission format', async () => {
      const res = await request(app)
        .post('/v1/slash')
        .send({ slashProof: { a: '1' }, publicInputs: { epoch: 1 } });
      expect(res.status).toBe(200);
    });

    it('rejects missing fields', async () => {
      const res = await request(app)
        .post('/v1/slash')
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /v1/status/:commitment', () => {
    it('returns 0 calls for unknown commitment', async () => {
      const res = await request(app).get('/v1/status/unknown-commitment');
      expect(res.status).toBe(200);
      expect(res.body.callsThisEpoch).toBe(0);
      expect(res.body.epochQuota).toBeGreaterThan(0);
    });

    it('reflects calls made', async () => {
      const keyRes = await request(app)
        .post('/v1/api-keys')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '0xstatus-test', label: 'test' });

      const res = await request(app).get('/v1/status/0xstatus-test');
      expect(res.status).toBe(200);
      expect(res.body.activeKeys).toBe(1);
      expect(res.body.commitment).toBe('0xstatus-test');
    });

    it('reports the on-chain deposit balance when contract access is configured', async () => {
      process.env.ZK_CONTRACT_ID = 'Cconfigured';
      process.env.GATEWAY_ADDRESS = 'Gconfigured';
      vi.mocked(getDeposit).mockResolvedValue({
        amount: '5000000',
        depositor: 'Gdepositor',
        slashed: false,
        withdrawn: false,
      });

      const res = await request(app).get('/v1/status/0xonchain');

      expect(res.status).toBe(200);
      expect(res.body.balanceUsdc).toBe('5000000');
      expect(res.body.depositStatus).toEqual({ slashed: false, withdrawn: false });
      expect(getDeposit).toHaveBeenCalledWith('0xonchain');
    });
  });

  describe('GATEWAY_SECRET enforcement', () => {
    it('rejects API key creation when GATEWAY_SECRET is not set', async () => {
      const prev = process.env.GATEWAY_SECRET;
      process.env.GATEWAY_SECRET = '';
      const res = await request(app)
        .post('/v1/api-keys')
        .send({ commitment: '0x1234', label: 'test' });
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('server_misconfigured');
      process.env.GATEWAY_SECRET = prev;
    });

    it('rejects API key creation with wrong secret', async () => {
      const res = await request(app)
        .post('/v1/api-keys')
        .set('Authorization', 'Bearer wrong-secret')
        .send({ commitment: '0x1234', label: 'test' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('unauthorized');
    });
  });

  describe('POST /v1/deposits', () => {
    it('rejects missing auth', async () => {
      const res = await request(app)
        .post('/v1/deposits')
        .send({ commitment: '123', amount: 5000000 });
      expect(res.status).toBe(401);
    });

    it('rejects wrong auth', async () => {
      const res = await request(app)
        .post('/v1/deposits')
        .set('Authorization', 'Bearer wrong-secret')
        .send({ commitment: '123', amount: 5000000 });
      expect(res.status).toBe(401);
    });

    it('rejects missing fields', async () => {
      const res = await request(app)
        .post('/v1/deposits')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '123' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('missing_fields');
    });

    it('rejects when GATEWAY_SECRET_KEY not set', async () => {
      const prev = process.env.GATEWAY_SECRET_KEY;
      delete process.env.GATEWAY_SECRET_KEY;
      const res = await request(app)
        .post('/v1/deposits')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '123', amount: 5000000 });
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('gateway_key_not_configured');
      if (prev) process.env.GATEWAY_SECRET_KEY = prev;
    });

    it('submits deposit and returns tx hash', async () => {
      process.env.GATEWAY_SECRET_KEY = 'test-stellar-key';
      const res = await request(app)
        .post('/v1/deposits')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '42', amount: '5000000' });
      expect(res.status).toBe(200);
      expect(res.body.deposited).toBe(true);
      expect(res.body.txHash).toBe('mock-tx-hash-abc123');
      expect(res.body.commitment).toBe('42');
      expect(res.body.amount).toBe('5000000');
      expect(res.body.newRoot).toBeDefined();
      expect(res.body.leafIndex).toBe(0);
    });
  });
});
