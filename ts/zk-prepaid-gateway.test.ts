import { createHash, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  buildPaymentPayload,
  buildPaymentRequirements,
  decodeHeader,
  encodeHeader,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  type ClaimFence,
  type ClaimRecord,
  type ClaimStore,
  type PaymentPayload,
  type PaymentRequirements,
} from '@zk-credits/x402-zk-prepaid';
import { deriveRequestSignal } from '@zk-credits/shared';
import { LocalClaimStore, claimFence } from './claim-store.js';
import { MockProviderAdapter, type ProviderAdapter } from './providerAdapter.js';
import { createZkPrepaidGateway } from './zk-prepaid-gateway.js';

const clockValue = 1_700_000_000_000;
const clock = () => clockValue;
const body = { model: 'demo', messages: [{ role: 'user', content: 'hello' }] };
const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const responseKey = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function gatewayOptions(provider: ProviderAdapter = new MockProviderAdapter()) {
  return {
    now: clock,
    provider,
    config: { publicBaseUrl: 'http://test.local', currentRoot: '1', knownRoots: ['1'] },
    facilitatorServiceToken: 'facilitator-secret',
    operatorToken: 'operator-secret',
    verifyProof: async () => ({ isValid: true as const }),
  };
}

async function requestSignalFor(
  requirements: PaymentRequirements,
  requestBody = body,
  nonce = '0123456789abcdef',
  responseKeyValue = responseKey,
): Promise<string> {
  return (await deriveRequestSignal({
    method: 'POST',
    url: 'http://test.local/v1/chat/completions',
    body: new TextEncoder().encode(JSON.stringify(requestBody)),
    requirements,
    nonce,
    responseKey: responseKeyValue,
  })).field;
}

async function paymentFor(
  gateway: { requirements: PaymentRequirements },
  requestBody = body,
  overrides: Partial<{ nonce: string; responseKey: string; signal: string; nullifier: string }> = {},
): Promise<PaymentPayload> {
  const nonce = overrides.nonce ?? '0123456789abcdef';
  const key = overrides.responseKey ?? responseKey;
  const signal = overrides.signal ?? await requestSignalFor(gateway.requirements, requestBody, nonce, key);
  return buildPaymentPayload({
    requirements: gateway.requirements,
    proof: {},
    publicSignals: ['1', String(gateway.requirements.extra.issuedAt), '3', signal, overrides.nullifier ?? '4', '5'],
    nonce,
    responseKey: key,
  });
}

function signalDigest(payment: PaymentPayload): string {
  return createHash('sha256').update(payment.payload.publicSignals[3]!).digest('hex');
}

function requirementsAt(gateway: { requirements: PaymentRequirements }, issuedAt: number): PaymentRequirements {
  return buildPaymentRequirements({
    asset: gateway.requirements.asset,
    contract: gateway.requirements.extra.contract,
    payTo: gateway.requirements.payTo,
    deploymentDomain: gateway.requirements.extra.deploymentDomain,
    circuitId: gateway.requirements.extra.circuit,
    verifyingKeyId: gateway.requirements.extra.verifyingKey,
    requirementsVersion: gateway.requirements.extra.requirementsVersion,
    issuedAt,
  });
}

/**
 * Builds a payment whose proof timestamp is independent of the challenge it
 * claims, which is the shape a client that ignores the challenge would send.
 */
async function paymentWithTimestamp(
  requirements: PaymentRequirements,
  timestamp: number,
  nullifier: string,
  requestBody = body,
): Promise<PaymentPayload> {
  const nonce = '0123456789abcdef';
  const signal = await requestSignalFor(requirements, requestBody, nonce);
  return buildPaymentPayload({
    requirements,
    proof: {},
    publicSignals: ['1', String(timestamp), '3', signal, nullifier, '5'],
    nonce,
    responseKey,
  });
}

function paymentRequiredError(response: { headers: Record<string, unknown> }): string | undefined {
  const required = response.headers[PAYMENT_REQUIRED_HEADER.toLowerCase()];
  return typeof required === 'string' ? decodeHeader<{ error?: string }>(required).error : undefined;
}

async function paidRequest(
  gateway: { app: Parameters<typeof request>[0] },
  payment: PaymentPayload,
  requestBody = body,
) {
  return request(gateway.app)
    .post('/v1/chat/completions')
    .set(PAYMENT_SIGNATURE_HEADER, encodeHeader(payment))
    .send(requestBody);
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

class CountingProvider implements ProviderAdapter {
  readonly id = 'counting';
  calls = 0;
  constructor(private readonly response: () => Promise<Response> | Response) {}
  async forwardRequest(): Promise<Response> {
    this.calls += 1;
    return this.response();
  }
}

class AmbiguousCommitStore extends LocalClaimStore {
  private failOnce = true;
  override async commit(fence: ClaimFence, idempotencyKey: string, now?: number): Promise<ClaimRecord> {
    const committed = await super.commit(fence, idempotencyKey, now);
    if (this.failOnce) {
      this.failOnce = false;
      throw new Error('db_connection_lost_after_commit');
    }
    return committed;
  }
}

describe('Base zk-prepaid gateway', () => {
  it('constructs the Base Sepolia requirements and a fenced isolated claim store', async () => {
    const gateway = await createZkPrepaidGateway(gatewayOptions());
    expect(gateway.requirements).toMatchObject({ scheme: 'zk-prepaid', network: 'eip155:84532', amount: '1' });
    const first = await gateway.claimStore.reserve('11', 'aa', 1);
    expect(first.record).toMatchObject({ state: 'reserved', generation: 1, dispatchCount: 0 });
    await expect(gateway.claimStore.reserve('11', 'bb', 2)).rejects.toThrow('conflicting_signal');
  });

  it('issues fresh timestamped challenges, maps malformed envelopes to 400, and keeps /supported public', async () => {
    const gateway = await createZkPrepaidGateway(gatewayOptions());
    const first = await request(gateway.app).post('/v1/chat/completions').send(body);
    const second = await request(gateway.app).post('/v1/chat/completions').send(body);
    expect(first.status).toBe(402);
    expect(second.status).toBe(402);
    const firstRequired = decodeHeader<{ accepts: PaymentRequirements[] }>(first.headers[PAYMENT_REQUIRED_HEADER.toLowerCase()]);
    const secondRequired = decodeHeader<{ accepts: PaymentRequirements[] }>(second.headers[PAYMENT_REQUIRED_HEADER.toLowerCase()]);
    expect(secondRequired.accepts[0]!.extra.issuedAt).toBeGreaterThan(firstRequired.accepts[0]!.extra.issuedAt);

    const malformed = await request(gateway.app)
      .post('/v1/chat/completions')
      .set(PAYMENT_SIGNATURE_HEADER, encodeHeader({ nope: true }))
      .send(body);
    expect(malformed.status).toBe(400);
    expect((await request(gateway.app).get('/x402/facilitator/supported')).status).toBe(200);
  });

  it('rejects local unsupported, streaming, oversized, and service-class requests before proof reservation', async () => {
    const gateway = await createZkPrepaidGateway(gatewayOptions());
    const payment = await paymentFor(gateway, body, { nullifier: '1001' });
    const streaming = await paidRequest(gateway, { ...payment, payload: { ...payment.payload, publicSignals: [...payment.payload.publicSignals] } }, { ...body, stream: true });
    expect(streaming.status).toBe(400);
    await expect(gateway.claimStore.lookup('1001')).resolves.toBeUndefined();

    const shaped = await request(gateway.app).post('/v1/chat/completions').send({ ...body, stream_options: {} });
    expect(shaped.status).toBe(400);
    const serviceClass = await request(gateway.app).post('/v1/chat/completions').send({ ...body, serviceClass: 'other-service' });
    expect(serviceClass.status).toBe(400);
    const responses = await request(gateway.app).post('/v1/responses').send(body);
    expect(responses.status).toBe(400);

    const oversized = await request(gateway.app).post('/v1/chat/completions').send({ prompt: 'x'.repeat(2_000_001) });
    expect(oversized.status).toBe(400);
  });

  it('maps invalid/stale authorization to a fresh 402 and creates no claim', async () => {
    const gateway = await createZkPrepaidGateway(gatewayOptions());
    const invalidGateway = await createZkPrepaidGateway({ ...gatewayOptions(), verifyProof: async () => ({ isValid: false, invalidReason: 'proof_invalid' }) });
    const invalidPayment = await paymentFor(invalidGateway, body, { nullifier: '1002' });
    const invalid = await paidRequest(invalidGateway, invalidPayment);
    expect(invalid.status).toBe(402);
    await expect(invalidGateway.claimStore.lookup('1002')).resolves.toBeUndefined();

    const staleRequirements = buildPaymentRequirements({
      asset: gateway.requirements.asset,
      contract: gateway.requirements.extra.contract,
      payTo: gateway.requirements.payTo,
      deploymentDomain: gateway.requirements.extra.deploymentDomain,
      circuitId: gateway.requirements.extra.circuit,
      verifyingKeyId: gateway.requirements.extra.verifyingKey,
      requirementsVersion: gateway.requirements.extra.requirementsVersion,
      issuedAt: Math.floor(clockValue / 1000) - 301,
    });
    const stale = buildPaymentPayload({
      requirements: staleRequirements,
      proof: {},
      publicSignals: ['1', String(staleRequirements.extra.issuedAt), '3', '4', '1003', '5'],
      nonce: '0123456789abcdef',
      responseKey,
    });
    const staleResponse = await paidRequest(gateway, stale);
    expect(staleResponse.status).toBe(402);
    expect(staleResponse.headers[PAYMENT_REQUIRED_HEADER.toLowerCase()]).toBeDefined();
    await expect(gateway.claimStore.lookup('1003')).resolves.toBeUndefined();
  });

  it('bounds the challenge window to [now-300s, now+5s] and binds the proof timestamp to it', async () => {
    const provider = new CountingProvider(() => jsonResponse({ ok: true }));
    const gateway = await createZkPrepaidGateway(gatewayOptions(provider));
    const current = Math.floor(clockValue / 1000);

    // Both window edges are still accepted, so the negatives below are the
    // window itself and not a narrower check.
    for (const [issuedAt, nullifier] of [[current - 300, '1301'], [current + 5, '1302']] as const) {
      const payment = await paymentWithTimestamp(requirementsAt(gateway, issuedAt), issuedAt, nullifier);
      const response = await paidRequest(gateway, payment);
      expect(response.status, `issuedAt ${issuedAt}`).toBe(200);
      await expect(gateway.claimStore.lookup(nullifier, signalDigest(payment), clockValue))
        .resolves.toMatchObject({ state: 'committed' });
    }

    const rejected = [
      ['stale beyond now-300', current - 301, current - 301, 'invalid_or_stale_authorization'],
      ['future skew beyond now+5', current + 6, current + 6, 'invalid_or_stale_authorization'],
      ['user-selected historical timestamp', current - 3600, current - 3600, 'invalid_or_stale_authorization'],
      ['public timestamp that is not the issuedAt', current - 10, current - 20, 'issued_at_mismatch'],
    ] as const;
    for (const [index, [name, issuedAt, timestamp, reason]] of rejected.entries()) {
      const nullifier = String(1020 + index);
      const response = await paidRequest(gateway, await paymentWithTimestamp(requirementsAt(gateway, issuedAt), timestamp, nullifier));
      expect(response.status, name).toBe(402);
      expect(paymentRequiredError(response), name).toBe(reason);
      await expect(gateway.claimStore.lookup(nullifier), name).resolves.toBeUndefined();
    }

    // Only the two window-edge challenges reached the provider.
    expect(provider.calls).toBe(2);
  });

  it('buffers a valid provider 2xx, stages encrypted replay, commits, then sends plaintext', async () => {
    const provider = new CountingProvider(() => jsonResponse({ object: 'chat.completion', choices: [{ message: { content: 'ok' } }] }));
    const gateway = await createZkPrepaidGateway(gatewayOptions(provider));
    const payment = await paymentFor(gateway, body, { nullifier: '1004' });
    const response = await paidRequest(gateway, payment);
    expect(response.status).toBe(200);
    expect(response.headers[PAYMENT_RESPONSE_HEADER.toLowerCase()]).toBeDefined();
    expect(response.body).toMatchObject({ object: 'chat.completion' });
    expect(provider.calls).toBe(1);
    await expect(gateway.claimStore.lookup('1004', signalDigest(payment), clockValue)).resolves.toMatchObject({
      state: 'committed',
      encryptedReplay: expect.any(String),
      replayExpiresAt: clockValue + 24 * 60 * 60 * 1000,
      dispatchCount: 1,
    });
  });

  it.each([
    ['timeout', new CountingProvider(() => new Promise<Response>(() => undefined)), 20],
    ['non-2xx', new CountingProvider(() => jsonResponse({ error: 'upstream' }, 502)), 10_000],
    ['malformed output', new CountingProvider(() => new Response('not-json', { status: 200, headers: { 'Content-Type': 'application/json' } })), 10_000],
    ['oversized output', new CountingProvider(() => new Response('x'.repeat(1024 * 1024 + 1), { status: 200, headers: { 'Content-Type': 'text/plain' } })), 10_000],
  ])('cancels reserved claims on provider %s before ready', async (_name, provider, timeoutMs) => {
    const gateway = await createZkPrepaidGateway({ ...gatewayOptions(provider), providerTimeoutMs: timeoutMs });
    const payment = await paymentFor(gateway, body, { nullifier: String(1100 + ['timeout', 'non-2xx', 'malformed output', 'oversized output'].indexOf(String(_name))) });
    const response = await paidRequest(gateway, payment);
    expect(response.status).toBe(502);
    await expect(gateway.claimStore.lookup(payment.payload.publicSignals[4], signalDigest(payment))).resolves.toMatchObject({ state: 'cancelled', dispatchCount: 1 });
  });

  it('accepts the exact 1 MiB boundary and rejects a second dispatch only after two attempts', async () => {
    const exactBody = 'x'.repeat(1024 * 1024);
    const provider = new CountingProvider(() => new Response(exactBody, { status: 200, headers: { 'Content-Type': 'text/plain' } }));
    const gateway = await createZkPrepaidGateway(gatewayOptions(provider));
    const payment = await paymentFor(gateway, body, { nullifier: '1005' });
    const response = await paidRequest(gateway, payment);
    expect(response.status).toBe(200);
    await expect(gateway.claimStore.lookup('1005', signalDigest(payment))).resolves.toMatchObject({ state: 'committed', dispatchCount: 1 });

    const failedProvider = new CountingProvider(() => jsonResponse({ error: 'down' }, 503));
    const retryGateway = await createZkPrepaidGateway({ ...gatewayOptions(failedProvider), operatorToken: 'operator-secret' });
    const retryPayment = await paymentFor(retryGateway, body, { nullifier: '1006' });
    await paidRequest(retryGateway, retryPayment);
    const record = await retryGateway.claimStore.lookup('1006', signalDigest(retryPayment));
    expect(record?.state).toBe('cancelled');
    await paidRequest(retryGateway, retryPayment);
    const exhausted = await retryGateway.claimStore.lookup('1006', signalDigest(retryPayment), clockValue + 1);
    expect(exhausted).toMatchObject({ state: 'cancelled', dispatchCount: 2 });
  });

  it('coalesces exact concurrent retries and serves committed encrypted replay without redispatch', async () => {
    const provider = new CountingProvider(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return jsonResponse({ object: 'chat.completion', value: 'coalesced' });
    });
    const gateway = await createZkPrepaidGateway(gatewayOptions(provider));
    const payment = await paymentFor(gateway, body, { nullifier: '1007' });
    const [first, concurrent] = await Promise.all([paidRequest(gateway, payment), paidRequest(gateway, payment)]);
    expect(first.status).toBe(200);
    expect(concurrent.status).toBe(200);
    expect(provider.calls).toBe(1);

    const replayRetry = await paidRequest(gateway, payment);
    expect(replayRetry.status).toBe(409);
    expect(replayRetry.body).toMatchObject({ error: 'claim_already_committed', replay: true, encryptedReplay: expect.any(String) });
    expect(provider.calls).toBe(1);
    const replay = await request(gateway.app)
      .post('/x402/replay')
      .set(PAYMENT_SIGNATURE_HEADER, encodeHeader(payment));
    expect(replay.status).toBe(200);
    expect(replay.body.encryptedReplay).toBe(replayRetry.body.encryptedReplay);
  });

  it('rejects conflicting signals and fences ambiguous commits for reconciliation', async () => {
    const provider = new CountingProvider(() => jsonResponse({ ok: true }));
    const gateway = await createZkPrepaidGateway(gatewayOptions(provider));
    const first = await paymentFor(gateway, body, { nullifier: '1008', nonce: 'aaaaaaaaaaaaaaaa' });
    expect((await paidRequest(gateway, first)).status).toBe(200);
    const conflicting = await paymentFor(gateway, body, { nullifier: '1008', nonce: 'bbbbbbbbbbbbbbbb' });
    expect((await paidRequest(gateway, conflicting)).status).toBe(402);
    expect(provider.calls).toBe(1);

    const ambiguousProvider = new CountingProvider(() => jsonResponse({ ok: 'ambiguous' }));
    const ambiguousStore = new AmbiguousCommitStore();
    const ambiguousGateway = await createZkPrepaidGateway({ ...gatewayOptions(ambiguousProvider), claimStore: ambiguousStore });
    const ambiguousPayment = await paymentFor(ambiguousGateway, body, { nullifier: '1009' });
    const firstAttempt = await paidRequest(ambiguousGateway, ambiguousPayment);
    expect(firstAttempt.status).toBe(503);
    await expect(ambiguousStore.lookup('1009', signalDigest(ambiguousPayment), clockValue)).resolves.toMatchObject({ state: 'committed' });
    const reconciledRetry = await paidRequest(ambiguousGateway, ambiguousPayment);
    expect(reconciledRetry.status).toBe(409);
    expect(reconciledRetry.body.replay).toBe(true);
    expect(ambiguousProvider.calls).toBe(1);
  });

  it('protects mutating facilitator settlement while keeping discovery public', async () => {
    const gateway = await createZkPrepaidGateway(gatewayOptions());
    expect((await request(gateway.app).get('/x402/facilitator/supported')).status).toBe(200);
    const unauthenticated = await request(gateway.app).post('/x402/facilitator/settle').send({ action: 'commit', reservationId: 'x' });
    expect(unauthenticated.status).toBe(401);
    const injected = await request(gateway.app)
      .post('/x402/facilitator/settle')
      .set('Authorization', 'Bearer facilitator-secret')
      .send({ phase: 'after-handler', action: 'commit', reservationId: 'x' });
    expect(injected.status).toBe(400);
  });

  it('exposes synchronized contract roots and keeps control-plane responses free of spend metadata', async () => {
    const gateway = await createZkPrepaidGateway({
      ...gatewayOptions(),
      rootSnapshot: () => ({ currentRoot: '2', knownRoots: ['1', '2'] }),
    });
    const response = await request(gateway.app).get('/v1/contract-status');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ network: 'eip155:84532', currentRoot: '2', knownRoots: ['1', '2'] });
    expect(JSON.stringify(response.body)).not.toMatch(/nullifier|request.?signal|proof|wallet|account|commitment/i);
  });

  it('removed the Stripe billing and wallet-link routes from the unpaid runtime', async () => {
    const gateway = await createZkPrepaidGateway(gatewayOptions());
    for (const [method, path] of [
      ['post', '/v1/billing/orders'],
      ['get', '/v1/billing/orders/ord_000000000000'],
      ['post', '/v1/billing/stripe-event'],
      ['post', '/v1/accounts/wallet-link'],
    ] as const) {
      const response = method === 'get'
        ? await request(gateway.app).get(path)
        : await request(gateway.app).post(path).send({});
      expect(response.status).toBe(404);
    }
  });
});
