import { describe, expect, it } from 'vitest';
import { MemoryOrderStore, StripeBillingService, BUNDLE_TIERS, type BaseBondSponsor, type StripeRefundService } from './stripe-billing.js';

describe('Stripe private-credit billing', () => {
  it('keeps the three fixed bundles and fulfills a webhook once', async () => {
    expect(BUNDLE_TIERS.map((tier) => [tier.serviceFeeCents, tier.bondCents, tier.allowance])).toEqual([
      [500, 500, 5_000],
      [2_000, 2_000, 25_000],
      [5_000, 5_000, 75_000],
    ]);
    const calls: string[] = [];
    const sponsor: BaseBondSponsor = {
      async fundBundle(commitment, tierId) { calls.push(`fund:${commitment}:${tierId}`); return { transaction: '0xfund' }; },
      async releaseBond(commitment) { calls.push(`release:${commitment}`); return { transaction: '0xrelease' }; },
    };
    const service = new StripeBillingService({ sponsor, now: () => 1_000 });
    const created = await service.createOrder({ tierId: 0, commitment: '123' });
    const first = await service.handleWebhook({ eventId: 'evt_1', eventType: 'checkout.session.completed', orderId: created.orderId, sessionId: 'cs_1', amountTotalCents: 1_000, currency: 'usd' });
    const duplicate = await service.handleWebhook({ eventId: 'evt_1', eventType: 'checkout.session.completed', orderId: created.orderId, sessionId: 'cs_1', amountTotalCents: 1_000, currency: 'usd' });
    expect(first.status?.status).toBe('funded');
    expect(duplicate.duplicate).toBe(true);
    expect(calls).toEqual(['fund:123:0']);
  });

  it('does not refund a slashed bundle and refunds a matured bundle through both rails', async () => {
    let clock = 1_000;
    const sponsor: BaseBondSponsor = {
      async fundBundle() { return { transaction: '0xfund' }; },
      async releaseBond() { return { transaction: '0xrelease' }; },
    };
    const refunds: StripeRefundService = { async refundBond() { return { refundId: 're_1' }; } };
    const service = new StripeBillingService({ sponsor, refunds, now: () => clock });
    const slashed = await service.createOrder({ tierId: 0, commitment: '124' });
    await service.handleWebhook({ eventId: 'evt_s', eventType: 'checkout.session.completed', orderId: slashed.orderId, sessionId: 'cs_s', amountTotalCents: 1_000 });
    await service.markSlashed(slashed.orderId);
    clock += 40 * 24 * 60 * 60 * 1000;
    expect((await service.runMaturityJob()).refunded).toBe(0);

    const mature = await service.createOrder({ tierId: 0, commitment: '125' });
    await service.handleWebhook({ eventId: 'evt_m', eventType: 'checkout.session.completed', orderId: mature.orderId, sessionId: 'cs_m', amountTotalCents: 1_000 });
    clock += 40 * 24 * 60 * 60 * 1000;
    const result = await service.runMaturityJob();
    expect(result.released).toBe(1);
    expect(result.refunded).toBe(1);
    expect((await service.getPublicStatus(mature.orderId))?.status).toBe('refunded');
  });

  it('recovers a failed sponsorship and rejects a duplicate Stripe payload mismatch', async () => {
    let shouldFail = true;
    let fundingCalls = 0;
    const sponsor: BaseBondSponsor = {
      async fundBundle() {
        fundingCalls += 1;
        if (shouldFail) throw new Error('rpc_temporarily_unavailable');
        return { transaction: '0xfund-retry' };
      },
      async releaseBond() { return { transaction: '0xrelease' }; },
    };
    const service = new StripeBillingService({ sponsor, now: () => 1_000 });
    const order = await service.createOrder({ tierId: 1, commitment: '126', accountId: 'github:retry' });
    await expect(service.handleWebhook({
      eventId: 'evt_retry', eventType: 'checkout.session.completed', orderId: order.orderId,
      sessionId: 'cs_retry', amountTotalCents: 4_000, currency: 'usd',
    })).rejects.toThrow('rpc_temporarily_unavailable');
    expect((await service.getPublicStatus(order.orderId))?.status).toBe('paid_pending_sponsorship');

    shouldFail = false;
    const retried = await service.handleWebhook({
      eventId: 'evt_retry', eventType: 'checkout.session.completed', orderId: order.orderId,
      sessionId: 'cs_retry', amountTotalCents: 4_000, currency: 'usd',
    });
    expect(retried.status?.status).toBe('funded');
    expect(fundingCalls).toBe(2);
    await expect(service.handleWebhook({
      eventId: 'evt_retry', eventType: 'checkout.session.completed', orderId: order.orderId,
      sessionId: 'cs_other', amountTotalCents: 4_000, currency: 'usd',
    })).rejects.toThrow('stripe_event_payload_mismatch');
  });

  it('blocks future purchases after a dispute and retries release/refund independently', async () => {
    let clock = 10_000;
    let releaseCalls = 0;
    let refundCalls = 0;
    const sponsor: BaseBondSponsor = {
      async fundBundle() { return { transaction: '0xfund' }; },
      async releaseBond() {
        releaseCalls += 1;
        if (releaseCalls === 1) throw new Error('release_rpc_down');
        return { transaction: '0xrelease-retry' };
      },
    };
    const refunds: StripeRefundService = {
      async refundBond() {
        refundCalls += 1;
        if (refundCalls === 1) throw new Error('stripe_refund_down');
        return { refundId: 're_retry' };
      },
    };
    const service = new StripeBillingService({ sponsor, refunds, now: () => clock });
    const disputed = await service.createOrder({ tierId: 0, commitment: '127', accountId: 'github:blocked' });
    await service.handleWebhook({ eventId: 'evt_dispute_fund', eventType: 'checkout.session.completed', orderId: disputed.orderId, sessionId: 'cs_dispute', amountTotalCents: 1_000 });
    await service.handleWebhook({ eventId: 'evt_dispute', eventType: 'charge.dispute.created', orderId: disputed.orderId });
    await expect(service.createOrder({ tierId: 0, commitment: '128', accountId: 'github:blocked' })).rejects.toThrow('account_purchase_blocked');

    const mature = await service.createOrder({ tierId: 0, commitment: '129', accountId: 'github:refund' });
    await service.handleWebhook({ eventId: 'evt_mature_fund', eventType: 'checkout.session.completed', orderId: mature.orderId, sessionId: 'cs_mature', amountTotalCents: 1_000 });
    clock += 40 * 24 * 60 * 60 * 1000;
    expect((await service.runMaturityJob()).retryable).toBe(1);
    expect((await service.getPublicStatus(mature.orderId))?.status).toBe('release_pending');
    expect((await service.runMaturityJob()).retryable).toBe(1);
    expect((await service.getPublicStatus(mature.orderId))?.status).toBe('refund_pending');
    expect((await service.runMaturityJob()).refunded).toBe(1);
    expect((await service.getPublicStatus(mature.orderId))?.status).toBe('refunded');
  });

  it('allows a stale sponsorship claim to be recovered exactly once', async () => {
    const store = new MemoryOrderStore();
    let clock = 1_000;
    let calls = 0;
    const service = new StripeBillingService({
      orderStore: store,
      sponsor: {
        async fundBundle() { calls += 1; return { transaction: '0xfund-stale' }; },
        async releaseBond() { return { transaction: '0xrelease' }; },
      },
      now: () => clock,
    });
    const order = await service.createOrder({ tierId: 0, commitment: '130' });
    await store.update(order.orderId, { status: 'sponsoring', sponsorshipStartedAt: 1_000 - 6 * 60 * 1000 });
    const result = await service.handleWebhook({ eventId: 'evt_stale', eventType: 'checkout.session.completed', orderId: order.orderId, sessionId: 'cs_stale', amountTotalCents: 1_000 });
    expect(result.status?.status).toBe('funded');
    expect(calls).toBe(1);
    clock += 1;
  });

  it('repairs sponsorship and terminal state from replayed Base events', async () => {
    const service = new StripeBillingService({ now: () => 2_000 });
    const order = await service.createOrder({ tierId: 0, commitment: '131' });
    const funded = await service.reconcileBaseEvents([{
      eventName: 'BundleFunded',
      transactionHash: '0xfund-chain',
      blockNumber: 10n,
      logIndex: 0,
      args: { commitment: `0x${BigInt(131).toString(16).padStart(64, '0')}`, tierId: '0', expiry: '2000000000' },
    }]);
    expect(funded).toEqual({ funded: 1, released: 0, slashed: 0 });
    expect((await service.getPublicStatus(order.orderId))?.status).toBe('funded');
    expect((await service.getPublicStatus(order.orderId))?.fundingTransaction).toBe('0xfund-chain');

    const slashed = await service.reconcileBaseEvents([{
      eventName: 'BondSlashed',
      transactionHash: '0xslash-chain',
      blockNumber: 11n,
      logIndex: 0,
      args: { commitment: `0x${BigInt(131).toString(16).padStart(64, '0')}` },
    }]);
    expect(slashed).toEqual({ funded: 0, released: 0, slashed: 1 });
    expect((await service.getPublicStatus(order.orderId))?.status).toBe('slashed');

    const replay = await service.reconcileBaseEvents([{
      eventName: 'BondSlashed',
      transactionHash: '0xslash-chain',
      blockNumber: 11n,
      logIndex: 0,
      args: { commitment: `0x${BigInt(131).toString(16).padStart(64, '0')}` },
    }]);
    expect(replay).toEqual({ funded: 0, released: 0, slashed: 0 });

    const releasedOrder = await service.createOrder({ tierId: 1, commitment: '132' });
    const releasedCommitment = `0x${BigInt(132).toString(16).padStart(64, '0')}`;
    expect(await service.reconcileBaseEvents([{
      eventName: 'BundleFunded',
      transactionHash: '0xfund-release-chain',
      blockNumber: 12n,
      logIndex: 0,
      args: { commitment: releasedCommitment, tierId: '1', expiry: '2000000000' },
    }])).toEqual({ funded: 1, released: 0, slashed: 0 });
    expect(await service.reconcileBaseEvents([{
      eventName: 'BondReleased',
      transactionHash: '0xrelease-chain',
      blockNumber: 13n,
      logIndex: 0,
      args: { commitment: releasedCommitment },
    }])).toEqual({ funded: 0, released: 1, slashed: 0 });
    expect((await service.getPublicStatus(releasedOrder.orderId))?.status).toBe('refund_pending');
    expect((await service.getPublicStatus(releasedOrder.orderId))?.bondReleaseTransaction).toBe('0xrelease-chain');
    expect(await service.reconcileBaseEvents([{
      eventName: 'BondReleased',
      transactionHash: '0xrelease-chain',
      blockNumber: 13n,
      logIndex: 0,
      args: { commitment: releasedCommitment },
    }])).toEqual({ funded: 0, released: 0, slashed: 0 });
  });
});
