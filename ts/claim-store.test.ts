import { describe, expect, it } from 'vitest';
import { LocalClaimStore, MAX_DISPATCH_COUNT, REPLAY_TTL_MS, RESERVATION_LEASE_MS, claimFence } from './claim-store.js';

describe('fenced spend-plane claim lifecycle', () => {
  it('atomically coalesces concurrent reservations and rejects conflicting signals', async () => {
    const store = new LocalClaimStore();
    const reservations = await Promise.all([
      store.reserve('nullifier', 'signal', 1_000),
      store.reserve('nullifier', 'signal', 1_000),
    ]);

    expect(reservations.map((item) => item.kind).sort()).toEqual(['existing', 'new']);
    expect(reservations[0]!.record.reservationId).toBe(reservations[1]!.record.reservationId);
    await expect(store.reserve('nullifier', 'different-signal', 1_001)).rejects.toThrow('conflicting_signal');
  });

  it('takes over an expired lease with a new generation and fences stale workers', async () => {
    const store = new LocalClaimStore();
    const first = await store.reserve('nullifier', 'signal', 1_000);
    const takeover = await store.reserve('nullifier', 'signal', 1_000 + RESERVATION_LEASE_MS + 1);
    const stale = claimFence(first.record);
    const current = claimFence(takeover.record);

    expect(takeover.kind).toBe('new');
    expect(takeover.record.generation).toBe(first.record.generation + 1);
    expect(takeover.record.fencingToken).not.toBe(first.record.fencingToken);
    await expect(store.beginDispatch(stale, 'stale-dispatch', 2_000)).rejects.toThrow('stale_fence');
    await expect(store.cancel(stale, 2_000)).rejects.toThrow('stale_fence');
    await expect(store.commit(stale, 'stale-commit', 2_000)).rejects.toThrow('stale_fence');
    await expect(store.beginDispatch(current, 'current-dispatch', 2_000)).resolves.toMatchObject({ dispatchCount: 1 });
  });

  it('requires dispatch before ready, commits idempotently, and expires replay ciphertext', async () => {
    const store = new LocalClaimStore();
    const reservation = await store.reserve('nullifier', 'signal', 1_000);
    const fence = claimFence(reservation.record);
    await expect(store.stageReady(fence, 'encrypted', 1_001)).rejects.toThrow('dispatch_not_started');
    await store.beginDispatch(fence, 'dispatch-key', 1_001);
    const ready = await store.stageReady(fence, 'encrypted', 1_002);
    expect(ready).toMatchObject({ state: 'ready', encryptedReplay: 'encrypted', replayExpiresAt: 1_002 + REPLAY_TTL_MS });
    const committed = await store.commit(fence, 'commit-key', 1_003);
    expect(committed.state).toBe('committed');
    await expect(store.commit(fence, 'commit-key', 1_004)).resolves.toMatchObject({ state: 'committed' });
    await expect(store.commit(fence, 'other-commit', 1_004)).rejects.toThrow('idempotency_conflict');
    const expired = await store.lookup('nullifier', 'signal', 1_002 + REPLAY_TTL_MS + 1);
    expect(expired).toMatchObject({ state: 'committed' });
    expect(expired?.encryptedReplay).toBeUndefined();
  });

  it('does not let an expired fence stage or cancel a reserved claim', async () => {
    const store = new LocalClaimStore();
    const reservation = await store.reserve('expired', 'signal', 1_000);
    const fence = claimFence(reservation.record);
    const expiredAt = 1_000 + RESERVATION_LEASE_MS + 1;
    await store.beginDispatch(fence, 'dispatch', 1_001);
    await expect(store.stageReady(fence, 'encrypted', expiredAt)).rejects.toThrow('reservation_lease_expired');
    await expect(store.cancel(fence, expiredAt)).rejects.toThrow('reservation_lease_expired');
  });

  it('caps durable dispatches at two and permits only an operator reset', async () => {
    const store = new LocalClaimStore({ operatorToken: 'operator-secret' });
    const first = await store.reserve('nullifier', 'signal', 1_000);
    await store.beginDispatch(claimFence(first.record), 'dispatch-one', 1_001);
    await store.cancel(claimFence(first.record), 1_002);

    const second = await store.reserve('nullifier', 'signal', 1_003);
    await store.beginDispatch(claimFence(second.record), 'dispatch-two', 1_004);
    await store.cancel(claimFence(second.record), 1_005);

    const exhausted = await store.reserve('nullifier', 'signal', 1_006);
    expect(exhausted.kind).toBe('existing');
    expect(exhausted.record).toMatchObject({ state: 'cancelled', dispatchCount: MAX_DISPATCH_COUNT });
    await expect(store.resetDispatchBudget(claimFence(exhausted.record), 'wrong', 1_007)).rejects.toThrow('operator_auth_required');

    const reset = await store.resetDispatchBudget(claimFence(exhausted.record), 'operator-secret', 1_007);
    expect(reset).toMatchObject({ state: 'cancelled', dispatchCount: 0 });
    expect(reset.reservationId).not.toBe(exhausted.record.reservationId);
    const reopened = await store.reserve('nullifier', 'signal', 1_008);
    expect(reopened.kind).toBe('new');
    expect(reopened.record.dispatchCount).toBe(0);
  });

  it('cancels only reserved records and preserves committed state', async () => {
    const store = new LocalClaimStore();
    const reserved = await store.reserve('reserved', 'signal', 1_000);
    await expect(store.cancel(claimFence(reserved.record), 1_001)).resolves.toMatchObject({ state: 'cancelled' });

    const committed = await store.reserve('committed', 'signal', 1_000);
    const fence = claimFence(committed.record);
    await store.beginDispatch(fence, 'dispatch', 1_001);
    await store.stageReady(fence, 'encrypted', 1_002);
    await store.commit(fence, 'commit', 1_003);
    await expect(store.cancel(fence, 1_004)).rejects.toThrow('claim_not_cancellable');
    await expect(store.lookup('committed', 'signal', 1_004)).resolves.toMatchObject({ state: 'committed' });
  });
});
