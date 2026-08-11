import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  app,
  merkleTree,
  resetGatewayStoreForTests,
  getGatewayStore,
  extractNullifier,
  extractEpoch,
  proofHashOf,
  hashApiKey,
} from './server.js';
import { requestDigestToField } from '@zk-credits/shared';
import { MemoryGatewayStore } from './db/index.js';
import { MerkleTree } from './merkle.js';
import request from 'supertest';
import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  nativeToScVal,
  StrKey,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

const sharedVerify = vi.hoisted(() => ({ verify: vi.fn() }));
const adapterMock = vi.hoisted(() => ({
  forward: vi.fn(),
  adapter: () => ({
    id: 'mock',
    forwardRequest: adapterMock.forward,
  }),
}));

const contractMock = vi.hoisted(() => ({
  deposit: vi.fn().mockResolvedValue('mock-tx-hash-abc123'),
  getDepositCount: vi.fn().mockResolvedValue(0),
  getCurrentRoot: vi.fn().mockResolvedValue('0'),
  getDeposit: vi.fn(),
  isNullifierSpent: vi.fn().mockResolvedValue(false),
  buildWithdrawEnvelope: vi.fn().mockResolvedValue('mock-withdraw-envelope-xdr'),
  spend: vi.fn().mockResolvedValue('mock-spend-tx-hash'),
}));

vi.mock('@zk-credits/shared', async () => ({
  ...(await vi.importActual<typeof import('@zk-credits/shared')>('@zk-credits/shared')),
  verifyGroth16Proof: sharedVerify.verify,
}));

vi.mock('./providerAdapter.js', () => ({
  OpenRouterAdapter: class {},
  MockProviderAdapter: class {},
  registerAdapter: vi.fn(),
  getAdapter: () => adapterMock.adapter(),
}));

vi.mock('./contract.js', () => contractMock);

beforeEach(async () => {
  await resetGatewayStoreForTests();
  process.env.GATEWAY_SECRET = 'test-secret';
  delete process.env.ZK_CONTRACT_ID;
  sharedVerify.verify.mockReset();
  sharedVerify.verify.mockResolvedValue(false);
  contractMock.getDeposit.mockReset();
  contractMock.getDeposit.mockResolvedValue({
    amount: '5000000',
    depositor: 'GATEWAY',
    slashed: false,
    withdrawn: false,
  });
  adapterMock.forward.mockReset();
  adapterMock.forward.mockImplementation(async () => new Response(
    JSON.stringify({ id: 'mock-response', choices: [] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ));
});

async function proofHeaderFor(
  body: object,
  nullifier = 'nullifier-test',
  signalY = '2',
  proof: object = { a: '1', b: '2', c: '3' },
): Promise<string> {
  const digest = await requestDigestToField(body);
  return Buffer.from(JSON.stringify({
    proof,
    pubSignals: ['0', nullifier, digest.field, signalY],
  })).toString('base64');
}

describe('gateway server', () => {
  describe('GET /health', () => {
    it('returns ok status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('GET /v1/membership-tree', () => {
    it('publishes a parameter-free snapshot with indexed leaves', async () => {
      const originalTree = merkleTree.clone();
      try {
        merkleTree.replaceWith(new MerkleTree());
        await merkleTree.insert(101n);
        await merkleTree.insert(202n);

        const res = await request(app)
          .get('/v1/membership-tree?commitment=101');

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          root: merkleTree.root().toString(),
          depth: 3,
          leaves: ['101', '202', '0', '0', '0', '0', '0', '0'],
          layers: merkleTree.getLayers().map((layer) => layer.map(String)),
        });
        expect(new Date(res.body.generatedAt).toISOString()).toBe(res.body.generatedAt);
      } finally {
        merkleTree.replaceWith(originalTree);
      }
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

    it('returns the shared compatibility bearer without a commitment lookup', async () => {
      const res = await request(app)
        .post('/v1/api-keys')
        .set('Authorization', 'Bearer test-secret')
        .send({ label: 'test' });
      expect(res.status).toBe(200);
      expect(res.body.apiKey).toBe('sk-zk-local-demo');
    });
  });

  describe('POST /v1/chat/completions', () => {
    it('accepts Codex-sized JSON request bodies before authentication', async () => {
      const res = await request(app)
        .post('/v1/responses')
        .send({ model: 'test', instructions: 'x'.repeat(256_000), input: [] });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('missing_authorization');
    });

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

    it('rejects the legacy five-signal epoch statement', async () => {
      const keyRes = await request(app)
        .post('/v1/api-keys')
        .set('Authorization', 'Bearer test-secret')
        .send({});
      const body = { model: 'test', messages: [] };
      const digest = await requestDigestToField(body);
      const proofHeader = Buffer.from(JSON.stringify({
        proof: { a: '1', b: '2', c: '3' },
        pubSignals: ['0', 'legacy-nullifier', digest.field, '2', '20260804'],
      })).toString('base64');

      const chatRes = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${keyRes.body.apiKey}`)
        .set('X-ZK-Proof', proofHeader)
        .send(body);
      expect(chatRes.status).toBe(400);
      expect(chatRes.body.error).toBe('invalid_proof_header');
    });

    it('rejects invalid proof (verification fails)', async () => {
      const keyRes = await request(app)
        .post('/v1/api-keys')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '0xbeef', label: 'test' });
      const key = keyRes.body.apiKey;

      const body = { model: 'test', messages: [] };
      const proofHeader = await proofHeaderFor(body);

      const chatRes = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${key}`)
        .set('X-ZK-Proof', proofHeader)
        .send(body);
      // Proof verification should fail for dummy proof
      expect(chatRes.status).toBe(403);
    });

    it('does not join proof acceptance to a commitment lookup', async () => {
      sharedVerify.verify.mockResolvedValue(true);
      contractMock.getDeposit.mockResolvedValueOnce(null);

      const keyRes = await request(app)
        .post('/v1/api-keys')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '0xunfunded', label: 'test' });
      const key = keyRes.body.apiKey;

      const body = { model: 'test', messages: [] };
      const proofHeader = await proofHeaderFor(body, 'nullifier-unfunded');

      const chatRes = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${key}`)
        .set('X-ZK-Proof', proofHeader)
        .send(body);

      expect(chatRes.status).toBe(200);
      expect(chatRes.body.id).toBe('mock-response');
      expect(adapterMock.forward).toHaveBeenCalledOnce();
      expect(await (getGatewayStore() as MemoryGatewayStore).listAcceptedCalls()).toHaveLength(1);
    });

    it('rejects proof with missing proof object fields', async () => {
      const keyRes = await request(app)
        .post('/v1/api-keys')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '0xcafe', label: 'test' });
      const key = keyRes.body.apiKey;

      const body = { model: 'test', messages: [] };
      const proofHeader = await proofHeaderFor(body, '1', '3', { missing: 'fields' });

      const chatRes = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${key}`)
        .set('X-ZK-Proof', proofHeader)
        .send(body);
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

      const body = { model: 'test', messages: [] };
      const proofHeader = await proofHeaderFor(body, 'nullifier-abc', '4');

      const chatRes = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${key}`)
        .set('X-ZK-Proof', proofHeader)
        .send(body);
      expect(chatRes.status).toBe(200);

      // Persist-before-forward: the accepted call + nullifier + count + full
      // proof (for the async spend worker) are durable in the store, keyed by
      // commitment but never joined to calls.
      const store = getGatewayStore() as MemoryGatewayStore;
      const calls = await store.listAcceptedCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].nullifier).toBe('nullifier-abc');
      expect(calls[0].proof).toEqual({ a: '1', b: '2', c: '3' });
      expect(calls[0].pubSignals).toEqual(['0', 'nullifier-abc', expect.any(String), '4']);
      expect(await store.getNullifier('nullifier-abc')).not.toBeNull();
      expect(await store.getCallCount('0xdurable')).toBe(0);
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
          pubSignals: ['0', 'nullifier-replay1', '0', '2'],
        })).toString('base64');

      const body = { model: 'test', messages: [] };
      const first = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${key}`)
        .set('X-ZK-Proof', await proofHeaderFor(body, 'nullifier-replay1', '2'))
        .send(body);
      expect(first.status).toBe(200);

      const second = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${key}`)
        .set('X-ZK-Proof', await proofHeaderFor(body, 'nullifier-replay1', '2'))
        .send(body);
      expect(second.status).toBe(200);
      expect(second.body).toEqual({ id: 'mock-response', choices: [] });
      expect(adapterMock.forward).toHaveBeenCalledTimes(1);
    });

    it('falls back to an on-chain read when the local cache misses (stale cache)', async () => {
      sharedVerify.verify.mockResolvedValue(true);
      process.env.ZK_CONTRACT_ID = 'test-contract';
      const { isNullifierSpent } = await import('./contract.js');
      (isNullifierSpent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

      const keyRes = await request(app)
        .post('/v1/api-keys')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '0xstale', label: 'test' });
      const key = keyRes.body.apiKey;

      const body = { model: 'test', messages: [] };
      const proofHeader = await proofHeaderFor(body, 'nullifier-fresh', '8');

      const chatRes = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${key}`)
        .set('X-ZK-Proof', proofHeader)
        .send(body);
      expect(chatRes.status).toBe(403);
      expect(chatRes.body.error).toBe('nullifier_spent');

      // The on-chain spent state is now durable locally too.
      const rec = await getGatewayStore().getNullifier('nullifier-fresh');
      expect(rec?.spentOnChain).toBe(true);
    });

    it('accepts distinct indexed tickets without a commitment-linked counter', async () => {
      sharedVerify.verify.mockResolvedValue(true);
      const keyRes = await request(app)
        .post('/v1/api-keys')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '0xquota', label: 'test' });
      const key = keyRes.body.apiKey;

      const body = { model: 'test', messages: [{ role: 'user', content: 'ticket one' }] };
      const first = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${key}`)
        .set('X-ZK-Proof', await proofHeaderFor(body, 'nullifier-q1', '9'))
        .send(body);
      expect(first.status).toBe(200);

      const secondBody = { model: 'test', messages: [{ role: 'user', content: 'ticket two' }] };
      const second = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${key}`)
        .set('X-ZK-Proof', await proofHeaderFor(secondBody, 'nullifier-q2', '10'))
        .send(secondBody);
      expect(second.status).toBe(200);
      expect(await (getGatewayStore() as MemoryGatewayStore).listAcceptedCalls()).toHaveLength(2);
    });

    it('returns slash evidence when one ticket is forked across request bodies', async () => {
      sharedVerify.verify.mockResolvedValue(true);
      const body = { model: 'test', messages: [{ role: 'user', content: 'original' }] };
      const forkBody = { model: 'test', messages: [{ role: 'user', content: 'fork' }] };

      const first = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-zk-local-demo')
        .set('X-ZK-Proof', await proofHeaderFor(body, 'nullifier-fork', '11'))
        .send(body);
      expect(first.status).toBe(200);

      const second = await request(app)
        .post('/v1/chat/completions')
        .set('Authorization', 'Bearer sk-zk-local-demo')
        .set('X-ZK-Proof', await proofHeaderFor(forkBody, 'nullifier-fork', '12'))
        .send(forkBody);
      expect(second.status).toBe(409);
      expect(second.body.error).toBe('fork_detected');
      expect(second.body.slashEvidence).toMatchObject({
        nullifier: 'nullifier-fork',
        firstY: '11',
        secondY: '12',
      });
    });

  describe('POST /v1/responses', () => {
    it('uses the same proof-bound durable acceptance path as Chat Completions', async () => {
      sharedVerify.verify.mockResolvedValue(true);
      const body = { model: 'openai/gpt-4o-mini', input: 'hello through Responses' };
      const proofHeader = await proofHeaderFor(body, 'responses-nullifier', '7');

      const first = await request(app)
        .post('/v1/responses')
        .set('Authorization', 'Bearer sk-zk-local-demo')
        .set('X-ZK-Proof', proofHeader)
        .send(body);
      const second = await request(app)
        .post('/v1/responses')
        .set('Authorization', 'Bearer sk-zk-local-demo')
        .set('X-ZK-Proof', proofHeader)
        .send(body);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(await getGatewayStore().listAcceptedCalls()).toHaveLength(1);
      expect(adapterMock.forward).toHaveBeenCalledTimes(1);
      expect(adapterMock.forward).toHaveBeenCalledWith(body, '', 'responses');
    });

    it('requires a fresh proof before forwarding a Responses body', async () => {
      const res = await request(app)
        .post('/v1/responses')
        .set('Authorization', 'Bearer sk-zk-local-demo')
        .send({ model: 'openai/gpt-4o-mini', input: 'missing proof' });

      expect(res.status).toBe(402);
      expect(res.body.error).toBe('proof_required');
    });

    it('relays and replays an SSE Responses transcript without a second upstream call', async () => {
      sharedVerify.verify.mockResolvedValue(true);
      const transcript = 'event: response.output_text.delta\ndata: {"delta":"hello"}\n\nevent: response.completed\ndata: {}\n\n';
      adapterMock.forward.mockResolvedValueOnce(new Response(transcript, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }));
      const body = { model: 'openai/gpt-4o-mini', input: 'stream please', stream: true };
      const proofHeader = await proofHeaderFor(body, 'responses-sse-nullifier', '8');

      const first = await request(app)
        .post('/v1/responses')
        .set('Authorization', 'Bearer sk-zk-local-demo')
        .set('X-ZK-Proof', proofHeader)
        .send(body);
      const second = await request(app)
        .post('/v1/responses')
        .set('Authorization', 'Bearer sk-zk-local-demo')
        .set('X-ZK-Proof', proofHeader)
        .send(body);

      expect(first.status).toBe(200);
      expect(first.headers['content-type']).toContain('text/event-stream');
      expect(first.text).toBe(transcript);
      expect(second.status).toBe(200);
      expect(second.headers['content-type']).toContain('text/event-stream');
      expect(second.text).toBe(transcript);
      expect(adapterMock.forward).toHaveBeenCalledTimes(1);
    });

    it('returns a terminal replay error instead of pending forever when an SSE transcript exceeds the replay limit', async () => {
      sharedVerify.verify.mockResolvedValue(true);
      adapterMock.forward.mockResolvedValueOnce(new Response('x'.repeat(1_000_001), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }));
      const body = { model: 'openai/gpt-4o-mini', input: 'large stream', stream: true };
      const proofHeader = await proofHeaderFor(body, 'responses-large-sse-nullifier', '9');

      const first = await request(app)
        .post('/v1/responses')
        .set('Authorization', 'Bearer sk-zk-local-demo')
        .set('X-ZK-Proof', proofHeader)
        .send(body);
      const second = await request(app)
        .post('/v1/responses')
        .set('Authorization', 'Bearer sk-zk-local-demo')
        .set('X-ZK-Proof', proofHeader)
        .send(body);

      expect(first.status).toBe(200);
      expect(second.status).toBe(409);
      expect(second.body.error).toBe('stream_replay_unavailable');
      expect(adapterMock.forward).toHaveBeenCalledTimes(1);
    });
  });


  describe('POST /v1/slash (permissionless → fee relay)', () => {
    beforeEach(() => {
      process.env.FEE_SPONSOR_URL = 'http://fee-sponsor.test';
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            accepted: true,
            method: 'slash',
            innerTxHash: 'inner-slash-hash',
            feeBumpHash: 'fee-bump-slash-1',
            duplicate: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ) as unknown as typeof fetch;
    });

    it('relays a reporter-signed slash transaction for a fee bump', async () => {
      const res = await request(app)
        .post('/v1/slash')
        .send({ innerTransactionXdr: 'reporter-signed-inner-slash-xdr' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        slashed: true,
        method: 'slash',
        feeBumpHash: 'fee-bump-slash-1',
        duplicate: false,
        innerTxHash: 'inner-slash-hash',
      });
      expect(global.fetch).toHaveBeenCalledWith(
        'http://fee-sponsor.test/v1/fee-relay',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ innerTransactionXdr: 'reporter-signed-inner-slash-xdr' }),
        }),
      );
    });

    it('removes the commitment from the durable public tree using the signed slash transition', async () => {
      const contractId = StrKey.encodeContract(Buffer.alloc(32, 9));
      process.env.ZK_CONTRACT_ID = contractId;
      const currentRoot = await merkleTree.setLeaf(0, 123n);
      await getGatewayStore().reserveMembershipLeaf({
        leafIndex: 0,
        commitment: '123',
        candidateRoot: currentRoot.toString(),
      });
      await getGatewayStore().activateMembershipLeaf(
        0,
        currentRoot.toString(),
        merkleTree.getLayers().map((layer) => layer.map(String)),
      );
      const removedTree = merkleTree.clone();
      const nextRoot = await removedTree.setLeaf(0, 0n);
      const reporter = Keypair.random();
      const account = {
        accountId: () => reporter.publicKey(),
        sequenceNumber: () => '1',
        incrementSequenceNumber: () => {},
      } as unknown as Parameters<typeof TransactionBuilder>[0];
      const innerTxXdr = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(new Contract(contractId).call(
          'slash',
          nativeToScVal({ a: 'A', b: 'B', c: 'C' }),
          nativeToScVal(['0', '123', '99', currentRoot.toString(), nextRoot.toString(), '1', '2', '3', '4']),
          nativeToScVal('123'),
          new Address(reporter.publicKey()).toScVal(),
        ))
        .setTimeout(30)
        .build()
        .toEnvelope()
        .toXDR('base64');

      const res = await request(app).post('/v1/slash').send({ innerTransactionXdr: innerTxXdr });

      expect(res.status).toBe(200);
      expect(merkleTree.root().toString()).toBe(nextRoot.toString());
      await expect(getGatewayStore().listMembershipLeaves()).resolves.toMatchObject([
        { leafIndex: 0, status: 'removed' },
      ]);
    });

    it('rejects missing fields', async () => {
      const res = await request(app)
        .post('/v1/slash')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('missing_inner_transaction');
    });

    it('does not claim a slash when the fee relay rejects the transaction', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'invalid_relay_request' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      ) as unknown as typeof fetch;

      const res = await request(app)
        .post('/v1/slash')
        .send({ innerTransactionXdr: 'reporter-signed-inner-slash-xdr' });
      expect(res.status).toBe(502);
      expect(res.body.error).toBe('fee_relay_rejected');
    });
  });

  describe('GET /v1/status/:commitment', () => {
    it('returns 0 calls for unknown commitment', async () => {
      contractMock.getDeposit.mockResolvedValueOnce(null);
      const res = await request(app).get('/v1/status/unknown-commitment');
      expect(res.status).toBe(200);
      expect(res.body.callsThisEpoch).toBe(0);
      expect(res.body.epochQuota).toBeGreaterThan(0);
      expect(res.body.balanceUsdc).toBe('0');
      expect(res.body.depositStatus).toBe('unfunded');
    });

    it('reflects calls made', async () => {
      process.env.ZK_CONTRACT_ID = 'test-contract';
      const keyRes = await request(app)
        .post('/v1/api-keys')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '0xstatus-test', label: 'test' });

      const res = await request(app).get('/v1/status/0xstatus-test');
      expect(res.status).toBe(200);
      expect(res.body.activeKeys).toBe(0);
      expect(res.body.commitment).toBe('0xstatus-test');
      expect(res.body.balanceUsdc).toBe('5000000');
      expect(res.body.depositStatus).toBe('active');
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
      expect(await getGatewayStore().listMembershipLeaves()).toMatchObject([
        {
          leafIndex: 0,
          commitment: '42',
          status: 'active',
          candidateRoot: res.body.newRoot,
        },
      ]);
      expect(await getGatewayStore().getMembershipTreeState()).toMatchObject({
        root: res.body.newRoot,
        version: 1,
      });
    });

    it('preserves Merkle state when the on-chain deposit is rejected', async () => {
      process.env.GATEWAY_SECRET_KEY = 'test-stellar-key';
      const leafCountBefore = merkleTree.getLeafCount();
      const rootBefore = merkleTree.root();
      contractMock.deposit.mockRejectedValueOnce(new Error('duplicate commitment'));

      const res = await request(app)
        .post('/v1/deposits')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '987654321', amount: '50000000' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('deposit_failed');
      expect(merkleTree.getLeafCount()).toBe(leafCountBefore);
      expect(merkleTree.root()).toBe(rootBefore);
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
    const withdrawalProof = { pi_a: ['1', '2', '1'] };
    let withdrawalSignals: string[];

    beforeEach(async () => {
      process.env.GATEWAY_SECRET_KEY = 'test-stellar-key';
      process.env.FEE_SPONSOR_URL = 'http://fee-sponsor.test';
      const currentRoot = await merkleTree.setLeaf(0, 123n);
      await getGatewayStore().reserveMembershipLeaf({
        leafIndex: 0,
        commitment: '123',
        candidateRoot: currentRoot.toString(),
      });
      await getGatewayStore().activateMembershipLeaf(
        0,
        currentRoot.toString(),
        merkleTree.getLayers().map((layer) => layer.map(String)),
      );
      const removedTree = merkleTree.clone();
      const nextRoot = await removedTree.setLeaf(0, 0n);
      withdrawalSignals = ['123', currentRoot.toString(), nextRoot.toString()];
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
        .send({
          withdrawalProof,
          pubSignals: withdrawalSignals,
          commitment: '123',
          recipient: 'G-RECIPIENT',
        });

      expect(res.status).toBe(200);
      expect(res.body.withdrawn).toBe(true);
      expect(res.body.feeBumpHash).toBe('fee-bump-1');
      expect(res.body.duplicate).toBe(false);
      expect(contractMock.buildWithdrawEnvelope).toHaveBeenCalledWith(
        'test-stellar-key',
        withdrawalProof,
        withdrawalSignals,
        '123',
        'G-RECIPIENT',
      );
      expect(global.fetch).toHaveBeenCalledWith(
        'http://fee-sponsor.test/v1/fee-relay',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ innerTransactionXdr: 'mock-withdraw-envelope-xdr' }),
        }),
      );
      expect(merkleTree.root().toString()).toBe(withdrawalSignals[2]);
      expect(await getGatewayStore().listMembershipLeaves()).toMatchObject([
        { leafIndex: 0, status: 'removed' },
      ]);
    });

    it('rejects missing auth', async () => {
      const res = await request(app)
        .post('/v1/withdraw')
        .send({ withdrawalProof, pubSignals: withdrawalSignals, commitment: '123', recipient: 'G-RECIPIENT' });
      expect(res.status).toBe(401);
    });

    it('rejects missing fields', async () => {
      const res = await request(app)
        .post('/v1/withdraw')
        .set('Authorization', 'Bearer test-secret')
        .send({ commitment: '123', withdrawalProof });
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
        .send({
          withdrawalProof,
          pubSignals: withdrawalSignals,
          commitment: '123',
          recipient: 'G-RECIPIENT',
        });
      expect(res.status).toBe(502);
      expect(res.body.error).toBe('fee_relay_rejected');
    });
  });

  describe('extractNullifier (RLN public signal layout)', () => {
    // Indexed-ticket public signals are [root, nullifier, share_x, share_y].
    // The nullifier remains index 1, never share_x at index 2.
    it('returns the nullifier from a four-signal RLN proof', () => {
      const pubSignals = ['root', 'nullifier', 'share_x', 'share_y'];
      expect(extractNullifier(pubSignals)).toBe('nullifier');
    });
    it('returns the nullifier independent of epoch position', () => {
      const pubSignals = ['0xaaa', '0xbbb', '0xccc', '0xddd', '100'];
      expect(extractNullifier(pubSignals)).toBe('0xbbb');
    });
  });
});
