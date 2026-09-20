import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildPaymentPayload, decodeHeader, encodeHeader, PAYMENT_REQUIRED_HEADER, PAYMENT_RESPONSE_HEADER, PAYMENT_SIGNATURE_HEADER, type PaymentPayload } from '@zk-credits/x402-zk-prepaid';
import { deriveRequestSignal } from '@zk-credits/shared';
import { MockProviderAdapter } from './providerAdapter.js';
import { createZkPrepaidGateway } from './zk-prepaid-gateway.js';

describe('Base zk-prepaid gateway', () => {
  it('constructs the Base Sepolia requirements and an isolated claim store', async () => {
    const gateway = await createZkPrepaidGateway({ verifyProof: async () => ({ isValid: true }) });
    expect(gateway.requirements.scheme).toBe('zk-prepaid');
    expect(gateway.requirements.network).toBe('eip155:84532');
    expect(gateway.requirements.amount).toBe('1');
    expect(gateway.requirements.extra.assetTransferMethod).toBe('prepaid-claim');
    expect(gateway.requirements.extra.paymentFlow).toBe('escrow');

    const first = await gateway.claimStore.reserve('11', 'aa', 1);
    const retry = await gateway.claimStore.reserve('11', 'aa', 2);
    expect(first.kind).toBe('new');
    expect(retry.kind).toBe('existing');
    await gateway.claimStore.commit(first.record.reservationId, undefined, 3);
    await expect(gateway.claimStore.reserve('11', 'bb', 4)).rejects.toThrow('conflicting_signal');
  });

  it('serves canonical x402 v2 challenges and facilitator metadata', async () => {
    const gateway = await createZkPrepaidGateway({
      config: { currentRoot: '0x01', knownRoots: ['0x01'] },
      verifyProof: async () => ({ isValid: true }),
    });
    const challenge = await request(gateway.app)
      .post('/v1/chat/completions')
      .send({ model: 'demo', messages: [{ role: 'user', content: 'hello' }] });
    expect(challenge.status).toBe(402);
    const required = decodeHeader<{ x402Version: number; accepts: Array<{ scheme: string; network: string; amount: string }> }>(
      challenge.headers[PAYMENT_REQUIRED_HEADER.toLowerCase()],
    );
    expect(required).toMatchObject({ x402Version: 2 });
    expect(required.accepts[0]).toMatchObject({ scheme: 'zk-prepaid', network: 'eip155:84532', amount: '1' });

    const supported = await request(gateway.app).get('/x402/facilitator/supported');
    expect(supported.status).toBe(200);
    expect(supported.body.kinds).toContainEqual(expect.objectContaining({ x402Version: 2, scheme: 'zk-prepaid', network: 'eip155:84532' }));
  });

  it('exposes synchronized contract roots without exposing account or spend metadata', async () => {
    const gateway = await createZkPrepaidGateway({
      config: { currentRoot: '0x01', knownRoots: ['0x01'] },
      rootSnapshot: () => ({ currentRoot: '0x02', knownRoots: ['0x01', '0x02'] }),
      verifyProof: async () => ({ isValid: true }),
    });
    const response = await request(gateway.app).get('/v1/contract-status');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ network: 'eip155:84532', currentRoot: '0x02', knownRoots: ['0x01', '0x02'] });
    expect(JSON.stringify(response.body)).not.toMatch(/account|commitment|wallet|order/i);
  });

  it('supports reserve/commit facilitator phases and client-encrypted replay retrieval', async () => {
    const gateway = await createZkPrepaidGateway({
      config: { currentRoot: '1', knownRoots: ['1'] },
      verifyProof: async () => ({ isValid: true }),
    });
    const payment: PaymentPayload = buildPaymentPayload({
      requirements: gateway.requirements,
      proof: {},
      publicSignals: ['1', String(gateway.requirements.extra.issuedAt), '3', '4', '5', '6'],
      nonce: '0123456789abcdef',
      responseKey: 'response-key',
    });
    const reservation = await gateway.claimStore.reserve('5', 'signal-hash', 1);
    await gateway.claimStore.commit(reservation.record.reservationId, 'encrypted-body', 2);

    const replay = await request(gateway.app)
      .post('/x402/replay')
      .set(PAYMENT_SIGNATURE_HEADER, encodeHeader(payment));
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ encryptedReplay: 'encrypted-body' });

    const settle = await request(gateway.app)
      .post('/x402/facilitator/settle')
      .send({ paymentPayload: payment, paymentRequirements: gateway.requirements });
    expect(settle.status).toBe(200);
    expect(settle.body).toMatchObject({ success: false, transaction: '', errorReason: 'conflicting_signal' });

    const standalone = await gateway.claimStore.reserve('6', 'another-signal', 3);
    const committed = await request(gateway.app)
      .post('/x402/facilitator/settle')
      .send({ action: 'commit', reservationId: standalone.record.reservationId });
    expect(committed.body).toMatchObject({ success: true, transaction: '' });
    expect(committed.body).not.toHaveProperty('payer');
  });

  it('rejects facilitator requests for a different contract or treasury', async () => {
    const gateway = await createZkPrepaidGateway({ verifyProof: async () => ({ isValid: true }) });
    const payment = buildPaymentPayload({
      requirements: gateway.requirements,
      proof: {},
      publicSignals: ['1', String(gateway.requirements.extra.issuedAt), '3', '4', '5', '6'],
      nonce: '0123456789abcdef',
      responseKey: 'response-key',
    });
    const alternate = { ...gateway.requirements, payTo: '0x00000000000000000000000000000000000000aa' };

    const verified = await request(gateway.app)
      .post('/x402/facilitator/verify')
      .send({ paymentPayload: payment, paymentRequirements: alternate });
    expect(verified.body).toEqual({ isValid: false, invalidReason: 'requirements_mismatch' });

    const settled = await request(gateway.app)
      .post('/x402/facilitator/settle')
      .send({ paymentPayload: payment, paymentRequirements: alternate });
    expect(settled.body).toMatchObject({ success: false, transaction: '', errorReason: 'requirements_mismatch' });
  });

  it('streams a provider response while retaining the x402 response envelope', async () => {
    const gateway = await createZkPrepaidGateway({
      config: { publicBaseUrl: 'http://test.local', currentRoot: '1', knownRoots: ['1'] },
      provider: new MockProviderAdapter(),
      verifyProof: async () => ({ isValid: true }),
    });
    const body = { model: 'demo', messages: [{ role: 'user', content: 'hello' }] };
    const nonce = '0123456789abcdef';
    const responseKey = 'response-key-for-test';
    const signal = await deriveRequestSignal({
      method: 'POST',
      url: 'http://test.local/v1/chat/completions',
      body: new TextEncoder().encode(JSON.stringify(body)),
      requirements: gateway.requirements,
      nonce,
      responseKey,
    });
    const payment = buildPaymentPayload({
      requirements: gateway.requirements,
      proof: {},
      publicSignals: ['1', String(gateway.requirements.extra.issuedAt), '3', signal.field, '4', '5'],
      nonce,
      responseKey,
    });

    const response = await request(gateway.app)
      .post('/v1/chat/completions')
      .set(PAYMENT_SIGNATURE_HEADER, encodeHeader(payment))
      .send(body);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/u);
    expect(response.headers[PAYMENT_RESPONSE_HEADER.toLowerCase()]).toBeDefined();
    expect(response.body.object).toBe('chat.completion');
  });

  it('persists optional account wallet links without exposing them in spend responses', async () => {
    const gateway = await createZkPrepaidGateway({ verifyProof: async () => ({ isValid: true }) });
    const linked = await request(gateway.app)
      .post('/v1/accounts/wallet-link')
      .send({ accountId: 'github-user', address: '0x00000000000000000000000000000000000000A1' });
    expect(linked.status).toBe(200);
    expect(linked.body).toEqual({ linked: true, address: '0x00000000000000000000000000000000000000a1' });
    await expect(gateway.walletLinks.get('github-user')).resolves.toBe('0x00000000000000000000000000000000000000a1');
    expect(JSON.stringify(linked.body)).not.toMatch(/commitment|secret|order|claim|proof/i);
  });
});
