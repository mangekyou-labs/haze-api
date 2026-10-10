import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createZkPrepaidGateway } from './zk-prepaid-gateway.js';
import { LaunchControl, MemoryLaunchControlStore } from './launch-control.js';
import { MockProviderAdapter } from './providerAdapter.js';
import { SandboxBillingService } from './sandbox-billing.js';
import { CONTRACT, HASH, MemorySandboxStore, ready } from './sandbox-test-support.js';

async function gateway(launchControl?: LaunchControl) {
  const billing = new SandboxBillingService({ store: new MemorySandboxStore(), contractAddress: CONTRACT,
    sponsor: { status: async () => ready, fund: async (_, callback) => { await callback(HASH); return { transactionHash: HASH, expiry: 1_900_000_000 }; }, reconcile: async () => undefined } });
  const app = (await createZkPrepaidGateway({ provider: new MockProviderAdapter(),
    internalServiceToken: 'internal-token', sandboxBilling: billing, launchControl,
    config: { publicBaseUrl: 'http://test.local', currentRoot: '1', knownRoots: ['1'] },
    verifyProof: async () => ({ isValid: true as const }),
  })).app;
  return { app, billing };
}
describe('public sandbox gateway boundary', () => {
  it('pauses new top-ups and funding while allowing status and paid webhook completion', async () => {
    const store = new MemoryLaunchControlStore();
    const control = new LaunchControl({ store });
    const { app, billing } = await gateway(control);
    const topup = await billing.createTopup('account', randomUUID());
    await billing.bindSession('account', topup.id, 'cs_test_pause');
    await control.pause('local test');
    const call = (path: string, body: unknown) => request(app).post(`/v1/sandbox${path}`).set('Authorization', 'Bearer internal-token').send(body);
    expect((await call('/topups', { accountId: 'account', requestId: randomUUID() })).status).toBe(503);
    expect((await call('/funding', { accountId: 'account', commitment: '2' })).status).toBe(503);
    expect((await call('/stripe-event', { topupId: topup.id, sessionId: 'cs_test_pause', livemode: false, mode: 'payment', paymentStatus: 'paid', currency: 'usd', amountTotal: 2000 })).status).toBe(200);
    expect((await call('/status', { accountId: 'account' })).body.availableCents).toBe(2000);
  });
  it('retires invite redemption and detached HTTP funding', async () => {
    const { app } = await gateway();
    for (const path of ['/v1/pilot/invites/redeem', '/v1/pilot/funding']) {
      expect((await request(app).post(path).send({})).status).toBe(404);
    }
  });
  it('requires the internal service token on every billing operation', async () => {
    const { app } = await gateway();
    for (const path of ['/status', '/topups', '/topups/session', '/stripe-event', '/funding']) {
      expect((await request(app).post(`/v1/sandbox${path}`).send({ accountId: 'victim' })).status).toBe(401);
    }
  });
  it('credits, funds, and returns public recovery without account or Stripe identifiers', async () => {
    const { app } = await gateway();
    const call = (path: string, body: unknown) => request(app).post(`/v1/sandbox${path}`).set('Authorization', 'Bearer internal-token').send(body);
    const accountId = 'github:4242';
    const topup = await call('/topups', { accountId, requestId: randomUUID() });
    expect(topup.status).toBe(200);
    expect((await call('/topups/session', { accountId, topupId: topup.body.id, sessionId: 'cs_test_demo' })).status).toBe(200);
    const event = { topupId: topup.body.id, sessionId: 'cs_test_demo', livemode: false, mode: 'payment', paymentStatus: 'paid', currency: 'usd', amountTotal: 2000 };
    expect((await call('/stripe-event', event)).status).toBe(200);
    expect((await call('/stripe-event', event)).status).toBe(200);
    expect((await call('/funding', { accountId, commitment: '1' })).body.state).toBe('funded');
    const recovery = await request(app).get('/v1/pilot/bundles/1');
    expect(recovery.status).toBe(200);
    expect(recovery.body).toMatchObject({ commitment: '1', transactionHash: HASH, tierId: 0 });
    expect(JSON.stringify(recovery.body)).not.toMatch(/github|4242|cs_test|account|balance|topup|attemptId/);
    expect((await call('/status', { accountId })).body).toMatchObject({ balanceCents: 0, reservedCents: 0 });
    expect((await call('/funding', { accountId: 'github:other', commitment: '1' })).status).toBe(409);
    expect((await request(app).get('/v1/pilot/bundles/not-a-field')).status).toBe(400);
  });
});
