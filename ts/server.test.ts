import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  app,
  resetGatewayStoreForTests,
  getGatewayStore,
  extractNullifier,
  extractEpoch,
  proofHashOf,
  hashApiKey,
} from './server.js';
import { MemoryGatewayStore } from './db/index.js';
import request from 'supertest';

const sharedVerify = vi.hoisted(() => ({ verify: vi.fn() }));
const adapterMock = vi.hoisted(() => ({
  forward: vi.fn(),
  adapter: () => ({
    id: 'mock',
    forwardRequest: adapterMock.forward,
  }),
}));

vi.mock('@zk-credits/shared', () => ({
  verifyGroth16Proof: sharedVerify.verify,
}));

vi.mock('./providerAdapter.js', () => ({
  OpenRouterAdapter: class {},
  MockProviderAdapter: class {},
  registerAdapter: vi.fn(),
  getAdapter: () => adapterMock.adapter(),
}));

vi.mock('./contract.js', () => ({
  deposit: vi.fn().mockResolvedValue('mock-tx-hash-abc123'),
  getDepositCount: vi.fn().mockResolvedValue(0),
  getCurrentRoot: vi.fn().mockResolvedValue('0'),
  getDeposit: vi.fn().mockResolvedValue(null),
  isNullifierSpent: vi.fn().mockResolvedValue(false),
  buildWithdrawEnvelope: vi.fn().mockResolvedValue('mock-withdraw-envelope-xdr'),
  spend: vi.fn().mockResolvedValue('mock-spend-tx-hash'),
}));

beforeEach(async () => {
  await resetGatewayStoreForTests();
  process.env.GATEWAY_SECRET = 'test-secret';
  sharedVerify.verify.mockReset();
  sharedVerify.verify.mockResolvedValue(false);
  adapterMock.forward.mockReset();
  adapterMock.forward.mockResolvedValue(
    new Response(JSON.stringify({ id: 'mock-response', choices: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
});

describe('gateway server', () => {
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
  });
    it('durably accepts a valid proof and persists the call before forwarding', async () => {
      sharedVerify.verify.mockResolvedValue(true);
      const keyRes = await request(app)
        .post('/v1/api-keys')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '0xdurable', label: 'test' });
      const key = keyRes.body.apiKey;

      const proofHeader = Buffer.from(JSON.stringify({
        proof: { a: '1', b: '2', c: '3' },
        pubSignals: ['root', 'nullifier-abc', 'x', 'y', '20260804'],
      })).toString('base64');

      const chatRes = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${key}`)
        .set('X-ZK-Proof', proofHeader)
        .send({ model: 'test', messages: [] });
      expect(chatRes.status).toBe(200);

      // Persist-before-forward: the accepted call + nullifier + count + full
      // proof (for the async spend worker) are durable in the store, keyed by
      // commitment but never joined to calls.
      const store = getGatewayStore() as MemoryGatewayStore;
      const calls = await store.listAcceptedCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].nullifier).toBe('nullifier-abc');
      expect(calls[0].proof).toEqual({ a: '1', b: '2', c: '3' });
      expect(calls[0].pubSignals).toEqual(['root', 'nullifier-abc', 'x', 'y', '20260804']);
      expect(await store.getNullifier('nullifier-abc')).not.toBeNull();
      expect(await store.getCallCount('0xdurable')).toBe(1);
    });

    it('rejects a replayed nullifier (durable replay protection)', async () => {
      sharedVerify.verify.mockResolvedValue(true);
      const keyRes = await request(app)
        .post('/v1/api-keys')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '0xreplay', label: 'test' });
      const key = keyRes.body.apiKey;

      const header = () =>
        Buffer.from(JSON.stringify({
          proof: { a: '1', b: '2', c: '3' },
          pubSignals: ['root', 'nullifier-replay1', 'x', 'y', '20260804'],
        })).toString('base64');

      const first = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${key}`)
        .set('X-ZK-Proof', header())
        .send({ model: 'test', messages: [] });
      expect(first.status).toBe(200);

      const second = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${key}`)
        .set('X-ZK-Proof', header())
        .send({ model: 'test', messages: [] });
      expect(second.status).toBe(403);
      expect(second.body.error).toBe('nullifier_spent');
    });

    it('falls back to an on-chain read when the local cache misses (stale cache)', async () => {
      sharedVerify.verify.mockResolvedValue(true);
      const { isNullifierSpent } = await import('./contract.js');
      (isNullifierSpent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

      const keyRes = await request(app)
        .post('/v1/api-keys')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '0xstale', label: 'test' });
      const key = keyRes.body.apiKey;

      const proofHeader = Buffer.from(JSON.stringify({
        proof: { a: '1', b: '2', c: '3' },
        pubSignals: ['root', 'nullifier-fresh', 'x', 'y', '20260804'],
      })).toString('base64');

      const chatRes = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${key}`)
        .set('X-ZK-Proof', proofHeader)
        .send({ model: 'test', messages: [] });
      expect(chatRes.status).toBe(403);
      expect(chatRes.body.error).toBe('nullifier_spent');

      // The on-chain spent state is now durable locally too.
      const rec = await getGatewayStore().getNullifier('nullifier-fresh');
      expect(rec?.spentOnChain).toBe(true);
    });

    it('rejects over-quota calls against the durable call counter', async () => {
      sharedVerify.verify.mockResolvedValue(true);
      const keyRes = await request(app)
        .post('/v1/api-keys')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '0xquota', label: 'test' });
      const key = keyRes.body.apiKey;

      // Seed the commitment's durable call count to the quota boundary.
      const store = getGatewayStore() as MemoryGatewayStore;
      for (let i = 0; i < 100; i++) {
        await store.incrementCallCount('0xquota', 20260804);
      }

      const proofHeader = Buffer.from(JSON.stringify({
        proof: { a: '1', b: '2', c: '3' },
        pubSignals: ['root', 'nullifier-q1', 'x', 'y', '20260804'],
      })).toString('base64');

      const res = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${key}`)
        .set('X-ZK-Proof', proofHeader)
        .send({ model: 'test', messages: [] });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('over_quota');
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

  describe('POST /v1/billing/stripe-event (idempotent webhook relay)', () => {
    beforeEach(() => {
      process.env.GATEWAY_SECRET_KEY = 'test-stellar-key';
    });

    it('rejects missing auth', async () => {
      const res = await request(app)
        .post('/v1/billing/stripe-event')
        .send({ eventId: 'evt_1', eventType: 'checkout.session.completed', payloadHash: 'h1' });
      expect(res.status).toBe(401);
    });

    it('submits the deposit on first delivery', async () => {
      const res = await request(app)
        .post('/v1/billing/stripe-event')
        .set('Authorization', 'Bearer test-secret')
        .send({
          eventId: 'evt_first',
          eventType: 'checkout.session.completed',
          payloadHash: 'h1',
          commitment: '777',
          amount: '5000000',
        });
      expect(res.status).toBe(200);
      expect(res.body.processed).toBe(true);
      expect(res.body.txHash).toBe('mock-tx-hash-abc123');
      expect(res.body.newRoot).toBeDefined();
    });

    it('is a no-op on redelivery (duplicate event id)', async () => {
      await request(app)
        .post('/v1/billing/stripe-event')
        .set('Authorization', 'Bearer test-secret')
        .send({
          eventId: 'evt_dup',
          eventType: 'checkout.session.completed',
          payloadHash: 'h1',
          commitment: '888',
          amount: '5000000',
        });

      const retry = await request(app)
        .post('/v1/billing/stripe-event')
        .set('Authorization', 'Bearer test-secret')
        .send({
          eventId: 'evt_dup',
          eventType: 'checkout.session.completed',
          payloadHash: 'h1',
          commitment: '888',
          amount: '5000000',
        });
      expect(retry.status).toBe(200);
      expect(retry.body.duplicate).toBe(true);
      expect(retry.body.processed).toBe(false);
      expect(retry.body.txHash).toBeUndefined();
    });

    it('records the receipt but skips the deposit when commitment is missing', async () => {
      const res = await request(app)
        .post('/v1/billing/stripe-event')
        .set('Authorization', 'Bearer test-secret')
        .send({
          eventId: 'evt_nocomm',
          eventType: 'checkout.session.completed',
          payloadHash: 'h1',
        });
      expect(res.status).toBe(200);
      expect(res.body.skipped).toBe('missing_commitment_or_amount');
    });

    it('records non-checkout events without submitting a deposit', async () => {
      const res = await request(app)
        .post('/v1/billing/stripe-event')
        .set('Authorization', 'Bearer test-secret')
        .send({ eventId: 'evt_charge', eventType: 'charge.succeeded', payloadHash: 'h2' });
      expect(res.status).toBe(200);
      expect(res.body.processed).toBe(true);
    });

    it('rejects when GATEWAY_SECRET is not set', async () => {
      const prev = process.env.GATEWAY_SECRET;
      process.env.GATEWAY_SECRET = '';
      const res = await request(app)
        .post('/v1/billing/stripe-event')
        .set('Authorization', 'Bearer test-secret')
        .send({ eventId: 'evt_x', eventType: 'checkout.session.completed', payloadHash: 'h' });
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('server_misconfigured');
      process.env.GATEWAY_SECRET = prev;
    });
  });

  describe('POST /v1/withdraw (gateway co-signer → fee relay)', () => {
    beforeEach(() => {
      process.env.GATEWAY_SECRET_KEY = 'test-stellar-key';
      process.env.FEE_SPONSOR_URL = 'http://fee-sponsor.test';
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ accepted: true, feeBumpHash: 'fee-bump-1', duplicate: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ) as unknown as typeof fetch;
    });

    it('builds the depositor-signed envelope and relays it for a fee bump', async () => {
      const res = await request(app)
        .post('/v1/withdraw')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '123', recipient: 'G-RECIPIENT' });

      expect(res.status).toBe(200);
      expect(res.body.withdrawn).toBe(true);
      expect(res.body.feeBumpHash).toBe('fee-bump-1');
      expect(res.body.duplicate).toBe(false);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://fee-sponsor.test/v1/fee-relay',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ innerTransactionXdr: 'mock-withdraw-envelope-xdr' }),
        }),
      );
    });

    it('rejects missing auth', async () => {
      const res = await request(app)
        .post('/v1/withdraw')
        .send({ commitment: '123', recipient: 'G-RECIPIENT' });
      expect(res.status).toBe(401);
    });

    it('rejects missing fields', async () => {
      const res = await request(app)
        .post('/v1/withdraw')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '123' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('missing_fields');
    });

    it('surfaces 502 when the fee relay rejects the withdraw', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'method not sponsored' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      ) as unknown as typeof fetch;

      const res = await request(app)
        .post('/v1/withdraw')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '123', recipient: 'G-RECIPIENT' });
      expect(res.status).toBe(502);
      expect(res.body.error).toBe('fee_relay_rejected');
    });
  });

  describe('extractNullifier (RLN public signal layout)', () => {
    // The RLN circuit declares outputs first, then the public epoch input:
    // [root, nullifier, share_x, share_y, epoch]. The nullifier is index 1,
    // NOT index 2 (which would be share_x and silently break replay protection).
    it('returns the nullifier from a 5-signal RLN proof', () => {
      const pubSignals = ['root', 'nullifier', 'share_x', 'share_y', 'epoch'];
      expect(extractNullifier(pubSignals)).toBe('nullifier');
    });
    it('returns the nullifier independent of epoch position', () => {
      const pubSignals = ['0xaaa', '0xbbb', '0xccc', '0xddd', '100'];
      expect(extractNullifier(pubSignals)).toBe('0xbbb');
    });
  });
});
