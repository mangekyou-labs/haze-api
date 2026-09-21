/**
 * Launch controls at the gateway boundary: the kill switch blocks funding and
 * inference while health, readiness, recovery, and authenticated aggregate
 * status stay reachable; spend caps refuse dispatch without consuming a credit.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  buildPaymentPayload,
  buildPaymentRequirements,
  encodeHeader,
  PAYMENT_SIGNATURE_HEADER,
  type PaymentPayload,
  type PaymentRequirements,
} from '@zk-credits/x402-zk-prepaid';
import { deriveRequestSignal } from '@zk-credits/shared';
import { createZkPrepaidGateway } from './zk-prepaid-gateway.js';
import { MockProviderAdapter, type ProviderAdapter } from './providerAdapter.js';
import {
  DAILY_CAP_MICRO_USD,
  LaunchControl,
  MemoryLaunchControlStore,
  MICRO_USD_PER_USD,
} from './launch-control.js';
import { LaunchMetrics } from './metrics.js';
import { MAX_DISPATCH_COST_MICRO_USD } from './service-class.js';
import { MemoryInviteStore, PilotInviteService } from './pilot-invites.js';
import { MemoryFundingCapabilityStore, PilotFundingService } from './pilot-funding.js';

const NOW = 1_800_000_000_000;
const INTERNAL_TOKEN = 'internal-secret';
const CONTRACT = '0x0000000000000000000000000000000000000001';
const BODY = { model: 'ignored-client-model', messages: [{ role: 'user', content: 'hello' }] };
/** Distinctive values that must never appear in a monitoring or admin read. */
const SECRET_NULLIFIER = '1734589512345678901234567890';
const SECRET_COMMITMENT = '8687213900595150509063186631634067671233157784124627437219499552928422827997';
const SECRET_GITHUB_ID = '4242424242';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const responseKey = publicKey.export({ type: 'spki', format: 'pem' }).toString();

class CountingProvider implements ProviderAdapter {
  id = 'counting';
  calls = 0;

  constructor(private readonly respond: () => Response | Promise<Response> = () => new Response(
    JSON.stringify({ object: 'chat.completion', choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )) {}

  async forwardRequest(): Promise<Response> {
    this.calls += 1;
    return this.respond();
  }
}

async function launched(
  store: MemoryLaunchControlStore,
  provider: ProviderAdapter = new CountingProvider(),
  options: { invites?: boolean } = {},
) {
  const launchControl = new LaunchControl({ store, now: () => NOW });
  const metrics = new LaunchMetrics();
  const funding = options.invites
    ? new PilotFundingService({
        store: new MemoryFundingCapabilityStore(),
        sponsor: { async fundCommitment() { return { transactionHash: '0xfunded', expiryAt: NOW + 30 * 24 * 60 * 60 * 1000 }; } },
        now: () => NOW,
        contractAddress: CONTRACT,
      })
    : undefined;
  const invites = funding
    ? new PilotInviteService({
        store: new MemoryInviteStore(),
        capabilities: { issue: () => funding.issueCapability() },
        now: () => NOW,
      })
    : undefined;
  const gateway = await createZkPrepaidGateway({
    now: () => NOW,
    provider,
    launchControl,
    metrics,
    config: { publicBaseUrl: 'http://test.local', currentRoot: '1', knownRoots: ['1'] },
    verifyProof: async () => ({ isValid: true as const }),
    allowUnverifiedProofs: true,
    pilotInvites: invites,
    pilotFunding: funding,
    readiness: { database: async () => undefined, verifierAssets: async () => undefined, baseHead: async () => 1n },
  });
  return { gateway, invites, funding };
}

async function paymentFor(
  gateway: { requirements: PaymentRequirements },
  overrides: { nullifier?: string } = {},
): Promise<PaymentPayload> {
  const nonce = '0123456789abcdef';
  const signal = (await deriveRequestSignal({
    method: 'POST',
    url: 'http://test.local/v1/chat/completions',
    body: new TextEncoder().encode(JSON.stringify(BODY)),
    requirements: gateway.requirements,
    nonce,
    responseKey,
  })).field;
  return buildPaymentPayload({
    requirements: gateway.requirements,
    proof: {},
    publicSignals: ['1', String(gateway.requirements.extra.issuedAt), '3', signal, overrides.nullifier ?? '4', '5'],
    nonce,
    responseKey,
  });
}

function paidRequest(gateway: { app: Parameters<typeof request>[0] }, payment: PaymentPayload) {
  return request(gateway.app)
    .post('/v1/chat/completions')
    .set(PAYMENT_SIGNATURE_HEADER, encodeHeader(payment))
    .send(BODY);
}

function unpaidRequest(gateway: { app: Parameters<typeof request>[0] }) {
  return request(gateway.app).post('/v1/chat/completions').send(BODY);
}

describe('kill switch', () => {
  it('blocks inference before any provider dispatch', async () => {
    const store = new MemoryLaunchControlStore();
    const provider = new CountingProvider();
    const { gateway } = await launched(store, provider);
    await store.pause('operator review', NOW);

    const unpaid = await unpaidRequest(gateway);
    expect(unpaid.status).toBe(503);
    expect(unpaid.body.error).toBe('pilot_paused');

    const paid = await paidRequest(gateway, await paymentFor(gateway));
    expect(paid.status).toBe(503);
    expect(paid.body.error).toBe('pilot_paused');
    expect(provider.calls).toBe(0);
  });

  it('blocks invite redemption and detached funding', async () => {
    const store = new MemoryLaunchControlStore();
    const { gateway, invites } = await launched(store, new CountingProvider(), { invites: true });
    process.env.BILLING_INTERNAL_TOKEN = INTERNAL_TOKEN;
    try {
      const issued = await invites!.issue({ githubAccountId: SECRET_GITHUB_ID });
      const redemption = await request(gateway.app)
        .post('/v1/pilot/invites/redeem')
        .set('authorization', `Bearer ${INTERNAL_TOKEN}`)
        .send({ code: issued.code, githubAccountId: SECRET_GITHUB_ID });
      expect(redemption.status).toBe(200);

      await store.pause('operator review', NOW);

      const blockedRedemption = await request(gateway.app)
        .post('/v1/pilot/invites/redeem')
        .set('authorization', `Bearer ${INTERNAL_TOKEN}`)
        .send({ code: issued.code, githubAccountId: SECRET_GITHUB_ID });
      expect(blockedRedemption.status).toBe(503);
      expect(blockedRedemption.body.error).toBe('pilot_paused');

      const funding = await request(gateway.app)
        .post('/v1/pilot/funding')
        .send({ fundingToken: redemption.body.fundingToken, commitment: SECRET_COMMITMENT });
      expect(funding.status).toBe(503);
      expect(funding.body.error).toBe('pilot_paused');
    } finally {
      delete process.env.BILLING_INTERNAL_TOKEN;
    }
  });

  it('keeps health, readiness, recovery, and admin status reachable', async () => {
    const store = new MemoryLaunchControlStore();
    const { gateway } = await launched(store, new CountingProvider(), { invites: true });
    process.env.BILLING_INTERNAL_TOKEN = INTERNAL_TOKEN;
    try {
      await store.pause('operator review', NOW);

      const health = await request(gateway.app).get('/health');
      expect(health.status).toBe(200);
      expect(health.body.status).toBe('ok');

      const ready = await request(gateway.app).get('/ready');
      expect(ready.status).toBe(503);
      expect(ready.body).toMatchObject({ ready: false, launchControl: 'paused' });

      // Public recovery lookup and authenticated aggregate status stay open.
      expect((await request(gateway.app).get(`/v1/pilot/bundles/${SECRET_COMMITMENT}`)).status).toBe(404);
      const status = await request(gateway.app).get('/v1/admin/status').set('authorization', `Bearer ${INTERNAL_TOKEN}`);
      expect(status.status).toBe(200);
      expect(status.body.launchControl).toMatchObject({ state: 'paused', reason: 'operator review' });
    } finally {
      delete process.env.BILLING_INTERNAL_TOKEN;
    }
  });

  it('serves a committed replay while paused', async () => {
    const store = new MemoryLaunchControlStore();
    const { gateway } = await launched(store);
    const payment = await paymentFor(gateway);
    expect((await paidRequest(gateway, payment)).status).toBe(200);

    await store.pause('operator review', NOW);
    const replay = await request(gateway.app)
      .post('/x402/replay')
      .set(PAYMENT_SIGNATURE_HEADER, encodeHeader(payment))
      .send({});
    expect(replay.status).toBe(200);
    expect(typeof replay.body.encryptedReplay).toBe('string');
  });

  it('refuses everything when the launch state cannot be read', async () => {
    const failing = {
      status: async () => { throw new Error('down'); },
      pause: async () => { throw new Error('down'); },
      resume: async () => { throw new Error('down'); },
      debit: async () => { throw new Error('down'); },
      retain: async () => { throw new Error('down'); },
      release: async () => { throw new Error('down'); },
      spend: async () => { throw new Error('down'); },
    };
    const gateway = await createZkPrepaidGateway({
      now: () => NOW,
      provider: new CountingProvider(),
      launchControl: new LaunchControl({ store: failing, now: () => NOW }),
      config: { publicBaseUrl: 'http://test.local', currentRoot: '1', knownRoots: ['1'] },
      verifyProof: async () => ({ isValid: true as const }),
      allowUnverifiedProofs: true,
    });
    const response = await unpaidRequest(gateway);
    expect(response.status).toBe(503);
    expect(response.body.error).toBe('launch_control_unavailable');
  });
});

describe('admin controls', () => {
  it('requires the internal service token', async () => {
    process.env.BILLING_INTERNAL_TOKEN = INTERNAL_TOKEN;
    try {
      const { gateway } = await launched(new MemoryLaunchControlStore());
      expect((await request(gateway.app).get('/v1/admin/status')).status).toBe(401);
      expect((await request(gateway.app).post('/v1/admin/pause').send({ reason: 'x' })).status).toBe(401);
      expect((await request(gateway.app).post('/v1/admin/resume').send({})).status).toBe(401);
    } finally {
      delete process.env.BILLING_INTERNAL_TOKEN;
    }
  });

  it('pauses and resumes through authenticated commands', async () => {
    process.env.BILLING_INTERNAL_TOKEN = INTERNAL_TOKEN;
    const auth = { authorization: `Bearer ${INTERNAL_TOKEN}` };
    try {
      const store = new MemoryLaunchControlStore();
      const { gateway } = await launched(store);

      expect((await request(gateway.app).post('/v1/admin/pause').set(auth).send({})).status).toBe(400);
      expect((await request(gateway.app).post('/v1/admin/pause').set(auth).send({ reason: '   ' })).status).toBe(400);
      expect((await request(gateway.app).post('/v1/admin/pause').set(auth).send({ reason: 'x'.repeat(201) })).status).toBe(400);

      const paused = await request(gateway.app).post('/v1/admin/pause').set(auth).send({ reason: 'provider incident' });
      expect(paused.status).toBe(200);
      expect(paused.body).toMatchObject({ state: 'paused', reason: 'provider incident' });

      const refused = await unpaidRequest(gateway);
      expect(refused.status).toBe(503);

      const resumed = await request(gateway.app).post('/v1/admin/resume').set(auth).send({});
      expect(resumed.status).toBe(200);
      expect(resumed.body).toMatchObject({ state: 'enabled', reason: null });

      const challenged = await unpaidRequest(gateway);
      expect(challenged.status).toBe(402);
    } finally {
      delete process.env.BILLING_INTERNAL_TOKEN;
    }
  });
});

describe('provider-spend caps at dispatch', () => {
  it('refuses dispatch, cancels the reservation, and consumes no credit', async () => {
    const store = new MemoryLaunchControlStore();
    const provider = new CountingProvider();
    const { gateway } = await launched(store, provider);
    // Leave exactly nothing of the daily cap before the dispatch debit.
    await store.debit(DAILY_CAP_MICRO_USD, NOW);

    const response = await paidRequest(gateway, await paymentFor(gateway));
    expect(response.status).toBe(503);
    expect(response.body.error).toBe('provider_spend_cap_exhausted');
    expect(provider.calls).toBe(0);

    // The exhausted cap persists a paused launch state.
    await expect(store.status()).resolves.toMatchObject({
      state: 'paused',
      reason: 'provider_spend_cap_exhausted:utc_day',
    });
    // No credit was consumed: the claim is cancelled, never committed.
    expect((await gateway.claimStore.lookup('4', undefined))?.state).toBe('cancelled');
  });

  it('admits exactly one dispatch under concurrent retries at the cap edge', async () => {
    const store = new MemoryLaunchControlStore();
    const provider = new CountingProvider();
    const { gateway } = await launched(store, provider);
    await store.debit(DAILY_CAP_MICRO_USD - MAX_DISPATCH_COST_MICRO_USD, NOW);

    const payments = await Promise.all([1, 2, 3].map((index) => paymentFor(gateway, { nullifier: String(900 + index) })));
    const responses = await Promise.all(payments.map((payment) => paidRequest(gateway, payment)));

    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    for (const response of responses.filter((candidate) => candidate.status !== 200)) {
      expect(response.status).toBe(503);
      expect(['provider_spend_cap_exhausted', 'pilot_paused']).toContain(response.body.error);
    }
    expect(provider.calls).toBe(1);
    await expect(store.spend(NOW)).resolves.toMatchObject({ utcDayMicroUsd: DAILY_CAP_MICRO_USD });
  });

  it('retains the debit when a dispatched provider call fails', async () => {
    const store = new MemoryLaunchControlStore();
    const { gateway } = await launched(store, new CountingProvider(() => new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } })));

    const response = await paidRequest(gateway, await paymentFor(gateway));
    expect(response.status).toBe(502);

    const spend = await store.spend(NOW);
    expect(spend.utcDayMicroUsd).toBe(MAX_DISPATCH_COST_MICRO_USD);
    expect(spend.debits).toMatchObject({ held: 0, retained: 1 });
    expect((await gateway.claimStore.lookup('4', undefined))?.state).toBe('cancelled');
  });

  it('retains the debit when a dispatched provider call times out', async () => {
    const store = new MemoryLaunchControlStore();
    const gateway = await createZkPrepaidGateway({
      now: () => NOW,
      provider: new CountingProvider(() => new Promise<Response>(() => undefined)),
      launchControl: new LaunchControl({ store, now: () => NOW }),
      providerTimeoutMs: 10,
      config: { publicBaseUrl: 'http://test.local', currentRoot: '1', knownRoots: ['1'] },
      verifyProof: async () => ({ isValid: true as const }),
      allowUnverifiedProofs: true,
    });

    const response = await paidRequest(gateway, await paymentFor(gateway));
    expect(response.status).toBe(502);
    expect(response.body.error).toBe('provider_timeout');
    await expect(store.spend(NOW)).resolves.toMatchObject({
      utcDayMicroUsd: MAX_DISPATCH_COST_MICRO_USD,
      debits: { held: 0, retained: 1, released: 0 },
    });
  });

  it('releases the debit when the request never reached the network', async () => {
    const store = new MemoryLaunchControlStore();
    let attempts = 0;
    const { gateway } = await launched(store, {
      id: 'refusing',
      forwardRequest(): Promise<Response> {
        attempts += 1;
        throw new Error('local_build_failed');
      },
    });

    const response = await paidRequest(gateway, await paymentFor(gateway));
    expect(attempts).toBe(1);
    expect(response.status).toBe(502);

    const spend = await store.spend(NOW);
    expect(spend.utcDayMicroUsd).toBe(0n);
    expect(spend.debits).toMatchObject({ held: 0, retained: 0, released: 1 });
  });

  it('records no debit at all when the provider is unconfigured', async () => {
    const store = new MemoryLaunchControlStore();
    const gateway = await createZkPrepaidGateway({
      now: () => NOW,
      provider: { id: 'openrouter', async forwardRequest() { return new Response('{}', { status: 200 }); } },
      launchControl: new LaunchControl({ store, now: () => NOW }),
      config: { publicBaseUrl: 'http://test.local', currentRoot: '1', knownRoots: ['1'], openRouterApiKey: '' },
      verifyProof: async () => ({ isValid: true as const }),
    });

    const response = await paidRequest(gateway, await paymentFor(gateway));
    expect(response.status).toBe(503);
    expect(response.body.error).toBe('provider_not_configured');
    await expect(store.spend(NOW)).resolves.toMatchObject({ utcDayMicroUsd: 0n });
  });
});

describe('aggregate status', () => {
  it('reports counts, headroom, and no joinable identifiers', async () => {
    process.env.BILLING_INTERNAL_TOKEN = INTERNAL_TOKEN;
    try {
      const store = new MemoryLaunchControlStore();
      const { gateway } = await launched(store);
      const payment = await paymentFor(gateway, { nullifier: SECRET_NULLIFIER });
      expect((await paidRequest(gateway, payment)).status).toBe(200);
      await unpaidRequest(gateway);

      const status = await request(gateway.app).get('/v1/admin/status').set('authorization', `Bearer ${INTERNAL_TOKEN}`);
      expect(status.status).toBe(200);
      expect(status.body).toMatchObject({
        launchControl: { state: 'enabled' },
        network: 'eip155:84532',
        provingLatency: { source: 'participant-reported', value: null },
      });
      expect(status.body.spend).toMatchObject({
        utcDayMicroUsd: MAX_DISPATCH_COST_MICRO_USD.toString(),
        dailyCapMicroUsd: DAILY_CAP_MICRO_USD.toString(),
        rollingCapMicroUsd: (200n * MICRO_USD_PER_USD).toString(),
      });
      // Conservative headroom is the cap minus the held ceiling.
      expect(BigInt(status.body.spend.dailyHeadroomMicroUsd)).toBe(DAILY_CAP_MICRO_USD - MAX_DISPATCH_COST_MICRO_USD);
      expect(status.body.metrics).toMatchObject({
        challenge_issued: 1,
        proof_valid: 1,
        claim_committed: 1,
        dispatch_ok: 1,
      });

      // Only bounded aggregate labels and integers: no nullifier, request
      // signal, response key, credential, or participant identifier.
      const serialized = JSON.stringify(status.body);
      for (const secret of [
        SECRET_NULLIFIER,
        payment.payload.publicSignals[3]!,
        responseKey,
        SECRET_COMMITMENT,
        SECRET_GITHUB_ID,
        INTERNAL_TOKEN,
      ]) {
        expect(serialized).not.toContain(secret);
      }
      expect(serialized).not.toMatch(/"githubAccountId"|"accountId"|"email"|"prompt"/u);
      expect(Object.keys(status.body.metrics).every((name) => /^[a-z0-9_]+$/u.test(name))).toBe(true);
    } finally {
      delete process.env.BILLING_INTERNAL_TOKEN;
    }
  });
});
