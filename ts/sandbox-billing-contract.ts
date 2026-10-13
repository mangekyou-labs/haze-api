import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SandboxBillingService, FundingRevertedError, type SandboxStore } from './sandbox-billing.js';
import { FundingPreBroadcastError } from './pilot-funding.js';
import { CONTRACT, HASH, ready } from './sandbox-test-support.js';

export function billingContract(makeStore: () => SandboxStore) {
  function setup() {
    const store = makeStore();
    const accountId = randomUUID();
    const commitment = BigInt('0x' + randomUUID().replaceAll('-', '')).toString();
    let now = 1_800_000_000_000;
    const sponsor = {
      status: vi.fn(async () => ready),
      fund: vi.fn(async (_commitment: string, broadcast: (hash: string) => Promise<void>) => {
        await broadcast(HASH); return { transactionHash: HASH, expiry: 1_900_000_000 };
      }),
      reconcile: vi.fn(async (): Promise<{ state: 'funded'; transactionHash: string; expiry: number } | { state: 'reverted' } | undefined> => undefined),
    };
    const service = () => new SandboxBillingService({ store, sponsor, contractAddress: CONTRACT, now: () => now });
    const billing = service();
    async function pay(id = accountId) {
      const topup = await billing.createTopup(id, randomUUID());
      const sessionId = `cs_test_${topup.id.replaceAll('-', '')}`;
      await billing.bindSession(id, topup.id, sessionId);
      const event = { topupId: topup.id, sessionId, livemode: false, mode: 'payment', paymentStatus: 'paid', currency: 'usd', amountTotal: 2000 };
      await billing.creditTopup(event);
      return event;
    }
    return { store, sponsor, billing, service, accountId, commitment, pay, advance: () => { now += 120_001; } };
  }
  it('credits a $5 top-up once and keeps activation at $20', async () => {
    const s = setup();
    const topup = await s.billing.createTopup(s.accountId, randomUUID(), 500);
    await s.billing.bindSession(s.accountId, topup.id, 'cs_test_small');
    const event = { topupId: topup.id, sessionId: 'cs_test_small', livemode: false, mode: 'payment', paymentStatus: 'paid', currency: 'usd', amountTotal: 500 };
    await s.billing.creditTopup(event);
    await s.service().creditTopup(event);
    expect(await s.billing.snapshot(s.accountId)).toMatchObject({ balanceCents: 500, bundlePriceCents: 2000 });
    await expect(s.billing.fund(s.accountId, s.commitment)).rejects.toThrow('insufficient_sandbox_balance');
  });
  it('binds top-up retries to their original amount and rejects payment tampering', async () => {
    const s = setup(); const requestId = randomUUID();
    const topup = await s.billing.createTopup(s.accountId, requestId, 10000);
    expect(await s.service().createTopup(s.accountId, requestId, 10000)).toEqual(topup);
    await expect(s.billing.createTopup(s.accountId, requestId, 500)).rejects.toThrow('topup_amount_conflict');
    for (const amount of [0, 1999, 500.5, 200000]) await expect(s.billing.createTopup(s.accountId, randomUUID(), amount)).rejects.toThrow('invalid_topup_amount');
    await s.billing.bindSession(s.accountId, topup.id, 'cs_test_large');
    const event = { topupId: topup.id, sessionId: 'cs_test_large', livemode: false, mode: 'payment', paymentStatus: 'paid', currency: 'usd', amountTotal: 2000 };
    await expect(s.billing.creditTopup(event)).rejects.toThrow('invalid_sandbox_payment');
    await s.billing.creditTopup({ ...event, amountTotal: 10000 });
    await s.service().creditTopup({ ...event, amountTotal: 10000 });
    await s.billing.fund(s.accountId, s.commitment);
    expect(await s.billing.snapshot(s.accountId)).toMatchObject({ balanceCents: 8000, bundlePriceCents: 2000 });
  });
  it('credits duplicate deliveries and concurrent clicks exactly once across restart', async () => {
    const s = setup(); const event = await s.pay();
    await Promise.all(Array.from({ length: 12 }, () => s.service().creditTopup(event)));
    expect((await s.billing.snapshot(s.accountId)).availableCents).toBe(2000);
    const results = await Promise.all(Array.from({ length: 12 }, () => s.service().fund(s.accountId, s.commitment)));
    expect(s.sponsor.fund).toHaveBeenCalledTimes(1);
    expect(results.some(b => b.state === 'funded')).toBe(true);
    const account = await s.service().snapshot(s.accountId);
    expect(account).toMatchObject({ balanceCents: 0, reservedCents: 0 });
    expect(account.bundles).toHaveLength(1);
    expect((await s.billing.fund(s.accountId, s.commitment)).state).toBe('funded');
  });
  it('rejects unpaid, live, wrong-amount, and conflicting sessions', async () => {
    const s = setup(); const event = await s.pay();
    for (const change of [{ livemode: true }, { amountTotal: 1999 }, { currency: 'eur' }, { paymentStatus: 'unpaid' }, { sessionId: 'cs_test_other' }]) {
      await expect(s.billing.creditTopup({ ...event, ...change })).rejects.toThrow();
    }
    await expect(s.billing.bindSession(randomUUID(), event.topupId, event.sessionId)).rejects.toThrow('topup_not_found');
    expect((await s.billing.snapshot(s.accountId)).balanceCents).toBe(2000);
  });
  it('prevents spending reserved balance on another bundle', async () => {
    const s = setup(); await s.pay();
    s.sponsor.fund.mockRejectedValue(new Error('timeout'));
    await s.billing.fund(s.accountId, s.commitment);
    await expect(s.billing.fund(s.accountId, '2')).rejects.toThrow('insufficient_sandbox_balance');
  });
  it.each(['insufficient_usdc', 'insufficient_gas', 'insufficient_allowance'])('releases %s failures before broadcast', async reason => {
    const s = setup(); await s.pay();
    s.sponsor.status.mockResolvedValue({ ...ready, ready: false, reason });
    expect((await s.billing.fund(s.accountId, s.commitment)).reason).toBe(reason);
    expect((await s.billing.snapshot(s.accountId)).reservedCents).toBe(0);
    s.sponsor.status.mockResolvedValue(ready);
    expect((await s.billing.fund(s.accountId, s.commitment)).state).toBe('funded');
    expect(s.sponsor.fund).toHaveBeenCalledTimes(1);
  });
  it('releases readiness RPC and preflight failures', async () => {
    const s = setup(); await s.pay();
    s.sponsor.status.mockRejectedValueOnce(new Error('rpc_down'));
    expect((await s.billing.fund(s.accountId, s.commitment)).state).toBe('failed');
    s.sponsor.fund.mockRejectedValueOnce(new FundingPreBroadcastError('preflight_failed'));
    expect((await s.billing.fund(s.accountId, s.commitment)).state).toBe('failed');
    expect((await s.billing.snapshot(s.accountId)).availableCents).toBe(2000);
  });
  it.each(['approval_pending', 'approval_failed'])('keeps balance available after %s without recording approval as bundle funding', async reason => {
    const s = setup(); await s.pay();
    s.sponsor.fund.mockRejectedValueOnce(new FundingPreBroadcastError(reason));
    expect(await s.billing.fund(s.accountId, s.commitment)).toMatchObject({ state: 'failed', reason, transactionHash: null });
    expect(await s.billing.snapshot(s.accountId)).toMatchObject({ availableCents: 2000, reservedCents: 0 });
    expect((await s.billing.fund(s.accountId, s.commitment)).state).toBe('funded');
    expect(await s.billing.snapshot(s.accountId)).toMatchObject({ balanceCents: 0, reservedCents: 0 });
  });
  it('holds a persisted hash after timeout, reconciles after restart, and debits once', async () => {
    const s = setup(); await s.pay();
    s.sponsor.fund.mockImplementationOnce(async (_, broadcast) => { await broadcast(HASH); throw new Error('timeout'); });
    expect(await s.billing.fund(s.accountId, s.commitment)).toMatchObject({ state: 'unknown', transactionHash: HASH });
    await s.service().fund(s.accountId, s.commitment);
    expect(s.sponsor.fund).toHaveBeenCalledTimes(1);
    expect((await s.billing.snapshot(s.accountId)).reservedCents).toBe(2000);
    s.sponsor.reconcile.mockResolvedValue({ state: 'funded', transactionHash: HASH, expiry: 1_900_000_000 });
    await Promise.all([s.service().snapshot(s.accountId), s.service().snapshot(s.accountId)]);
    expect(await s.billing.snapshot(s.accountId)).toMatchObject({ balanceCents: 0, reservedCents: 0 });
  });
  it('holds hashless ambiguous writes and stale funding leases without rebroadcast', async () => {
    const s = setup(); await s.pay();
    s.sponsor.fund.mockRejectedValue(new Error('write_timeout'));
    await s.billing.fund(s.accountId, s.commitment);
    await s.store.transaction(s.accountId, a => { a.bundles[0]!.state = 'funding'; });
    s.advance();
    expect((await s.service().snapshot(s.accountId)).bundles[0]!.state).toBe('unknown');
    await s.billing.fund(s.accountId, s.commitment);
    expect(s.sponsor.fund).toHaveBeenCalledTimes(1);
  });
  it('releases a confirmed revert, including one discovered by reconciliation', async () => {
    const s = setup(); await s.pay();
    s.sponsor.fund.mockRejectedValueOnce(new FundingRevertedError());
    expect((await s.billing.fund(s.accountId, s.commitment)).state).toBe('failed');
    s.sponsor.fund.mockRejectedValueOnce(new Error('timeout'));
    await s.billing.fund(s.accountId, s.commitment);
    s.sponsor.reconcile.mockResolvedValue({ state: 'reverted' });
    expect(await s.billing.snapshot(s.accountId)).toMatchObject({ balanceCents: 2000, reservedCents: 0 });
  });
  it('rejects cross-account ownership races without debiting the loser', async () => {
    const s = setup(); const other = randomUUID(); await s.pay(); await s.pay(other);
    const outcomes = await Promise.allSettled([s.billing.fund(s.accountId, s.commitment), s.service().fund(other, s.commitment)]);
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
    expect(s.sponsor.fund).toHaveBeenCalledTimes(1);
    const balances = await Promise.all([s.billing.snapshot(s.accountId), s.billing.snapshot(other)]);
    expect(balances.map(b => b.balanceCents).sort()).toEqual([0, 2000]);
    expect(JSON.stringify(await s.billing.publicBundle(s.commitment))).not.toContain(s.accountId);
  });
}
