import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { runMigrations } from './db/migrate.js';
import { PostgresClaimStore, MAX_DISPATCH_COUNT, REPLAY_TTL_MS, RESERVATION_LEASE_MS, claimFence } from './claim-store.js';

const enabled = process.env.RUN_DB_TESTS === '1';
const databaseUrl = process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/zk_credits_test';
const migrationsDir = resolve(import.meta.dirname, 'db/migrations');
const DB_TEST_LOCK = 8_402_062_006;

function fixture(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

describe.skipIf(!enabled)('Postgres claim lifecycle (integration)', () => {
  let pool: Pool;
  let store: PostgresClaimStore;
  let lockClient: Awaited<ReturnType<Pool['connect']>>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    lockClient = await pool.connect();
    await lockClient.query('SELECT pg_advisory_lock($1)', [DB_TEST_LOCK]);
    await runMigrations(pool, migrationsDir);
    await pool.query('TRUNCATE spend_plane.claims');
    store = new PostgresClaimStore(pool, { operatorToken: 'operator-secret' });
  });

  afterAll(async () => {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [DB_TEST_LOCK]);
    lockClient.release();
    await pool.end();
  });

  it('atomically coalesces concurrent reserve and preserves uniqueness', async () => {
    const nullifier = fixture('concurrent');
    const results = await Promise.all([
      store.reserve(nullifier, 'signal-a', 1_700_000_000_000),
      store.reserve(nullifier, 'signal-a', 1_700_000_000_000),
    ]);
    expect(results.map((result) => result.kind).sort()).toEqual(['existing', 'new']);
    expect(results[0]!.record.reservationId).toBe(results[1]!.record.reservationId);
    await expect(store.reserve(nullifier, 'signal-b', 1_700_000_000_001)).rejects.toThrow('conflicting_signal');
  });

  it('takes over expired leases and fences stale workers', async () => {
    const nullifier = fixture('lease');
    const first = await store.reserve(nullifier, 'signal', 1_700_000_000_000);
    const takeover = await store.reserve(nullifier, 'signal', 1_700_000_000_000 + RESERVATION_LEASE_MS + 1);
    expect(takeover.kind).toBe('new');
    await expect(store.beginDispatch(claimFence(first.record), 'stale-dispatch', 1_700_000_000_001)).rejects.toThrow('stale_fence');
    await expect(store.cancel(claimFence(first.record), 1_700_000_000_001)).rejects.toThrow('stale_fence');
    await expect(store.commit(claimFence(first.record), 'stale-commit', 1_700_000_000_001)).rejects.toThrow('stale_fence');
    await expect(store.beginDispatch(claimFence(takeover.record), 'current-dispatch', 1_700_000_300_002)).resolves.toMatchObject({ dispatchCount: 1 });
  });

  it('caps two dispatches, supports fenced reset, and preserves idempotency', async () => {
    const nullifier = fixture('budget');
    const first = await store.reserve(nullifier, 'signal', 1_700_000_000_000);
    await store.beginDispatch(claimFence(first.record), 'dispatch-one', 1_700_000_000_001);
    await store.cancel(claimFence(first.record), 1_700_000_000_002);
    const second = await store.reserve(nullifier, 'signal', 1_700_000_000_003);
    await store.beginDispatch(claimFence(second.record), 'dispatch-two', 1_700_000_000_004);
    await store.cancel(claimFence(second.record), 1_700_000_000_005);

    const exhausted = await store.reserve(nullifier, 'signal', 1_700_000_000_006);
    expect(exhausted).toMatchObject({ kind: 'existing', record: { state: 'cancelled', dispatchCount: MAX_DISPATCH_COUNT } });
    await expect(store.resetDispatchBudget(claimFence(exhausted.record), 'wrong-token', 1_700_000_000_007)).rejects.toThrow('operator_auth_required');
    const reset = await store.resetDispatchBudget(claimFence(exhausted.record), 'operator-secret', 1_700_000_000_007);
    expect(reset).toMatchObject({ state: 'cancelled', dispatchCount: 0 });
    const reopened = await store.reserve(nullifier, 'signal', 1_700_000_000_008);
    expect(reopened.kind).toBe('new');
  });

  it('stages encrypted replay before commit, expires it, and rejects post-ready cancellation', async () => {
    const nullifier = fixture('replay');
    const reserved = await store.reserve(nullifier, 'signal', 1_700_000_000_000);
    const fence = claimFence(reserved.record);
    await store.beginDispatch(fence, 'dispatch', 1_700_000_000_001);
    await store.stageReady(fence, 'ciphertext-only', 1_700_000_000_002);
    await expect(store.cancel(fence, 1_700_000_000_003)).rejects.toThrow('claim_not_cancellable');
    await expect(store.commit(fence, 'commit', 1_700_000_000_004)).resolves.toMatchObject({ state: 'committed' });
    await expect(store.commit(fence, 'commit', 1_700_000_000_005)).resolves.toMatchObject({ state: 'committed' });
    await expect(store.commit(fence, 'different-commit', 1_700_000_000_005)).rejects.toThrow('commit_requires_ready');
    const expired = await store.lookup(nullifier, 'signal', 1_700_000_000_002 + REPLAY_TTL_MS + 1);
    expect(expired).toMatchObject({ state: 'committed' });
    expect(expired?.encryptedReplay).toBeUndefined();
  });

  it('expires reserved leases without touching ready or committed rows', async () => {
    const reserved = await store.reserve(fixture('expiry'), 'signal', 1_700_000_000_000);
    const ready = await store.reserve(fixture('ready'), 'signal', 1_700_000_000_000);
    await store.beginDispatch(claimFence(ready.record), 'dispatch', 1_700_000_000_001);
    await store.stageReady(claimFence(ready.record), 'ciphertext-only', 1_700_000_000_002);
    const expired = await store.expireReservations(1_700_000_000_000 + RESERVATION_LEASE_MS + 1);
    expect(expired).toBeGreaterThanOrEqual(1);
    await expect(store.lookup(reserved.record.nullifier, reserved.record.signalHash)).resolves.toMatchObject({ state: 'cancelled' });
    await expect(store.lookup(ready.record.nullifier, ready.record.signalHash)).resolves.toMatchObject({ state: 'ready' });
  });
});
