/**
 * Durable launch controls against real Postgres: cap enforcement is
 * transactional, the pause and the spend ledger both survive a process
 * restart, and neither table can be joined to spend-plane identifiers.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { runMigrations } from './db/migrate.js';
import {
  DAILY_CAP_MICRO_USD,
  LaunchControl,
  MICRO_USD_PER_USD,
  PostgresLaunchControlStore,
  ROLLING_CAP_MICRO_USD,
} from './launch-control.js';

const enabled = process.env.RUN_DB_TESTS === '1';
const databaseUrl = process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/zk_credits_test';
const migrationsDir = resolve(import.meta.dirname, 'db/migrations');
const NOW = Date.UTC(2026, 5, 1, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!enabled)('Postgres launch controls (integration)', () => {
  let pool: Pool;
  let lockClient: Awaited<ReturnType<Pool['connect']>>;

  async function reset(): Promise<PostgresLaunchControlStore> {
    await pool.query('TRUNCATE spend_plane.dispatch_debits');
    await pool.query(`UPDATE control_plane.launch_control SET state = 'enabled', reason = NULL, updated_at = now()`);
    return new PostgresLaunchControlStore(pool);
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    lockClient = await pool.connect();
    await lockClient.query('SELECT pg_advisory_lock($1)', [8_402_062_006]);
    await runMigrations(pool, migrationsDir);
  });

  afterAll(async () => {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [8_402_062_006]);
    lockClient.release();
    await pool.end();
  });

  it('seeds exactly one enabled control row', async () => {
    const store = await reset();
    const rows = await pool.query('SELECT control_id, state, reason FROM control_plane.launch_control');
    expect(rows.rowCount).toBe(1);
    await expect(store.status()).resolves.toMatchObject({ state: 'enabled', reason: null });
  });

  it('persists a pause across a fresh store instance', async () => {
    const store = await reset();
    await store.pause('provider incident', NOW);

    const restarted = new LaunchControl({ store: new PostgresLaunchControlStore(pool), now: () => NOW });
    await expect(restarted.isPaused()).resolves.toBe(true);
    await expect(restarted.status()).resolves.toMatchObject({ state: 'paused', reason: 'provider incident' });

    await restarted.resume();
    await expect(new PostgresLaunchControlStore(pool).status()).resolves.toMatchObject({ state: 'enabled', reason: null });
  });

  it('refuses admission while paused without recording a debit', async () => {
    const store = await reset();
    await store.pause('operator review', NOW);
    await expect(store.debit(25_000n, NOW)).resolves.toEqual({ kind: 'paused' });
    const spend = await store.spend(NOW);
    expect(spend.utcDayMicroUsd).toBe(0n);
    expect(spend.debits).toEqual({ held: 0, retained: 0, released: 0 });
  });

  it('settles a debit to retained or released exactly once', async () => {
    const store = await reset();
    const first = await store.debit(25_000n, NOW);
    if (first.kind !== 'debited') throw new Error('expected a debit');
    await store.retain(first.debitId, NOW);
    await store.release(first.debitId, NOW);
    await expect(store.spend(NOW)).resolves.toMatchObject({
      utcDayMicroUsd: 25_000n,
      debits: { held: 0, retained: 1, released: 0 },
    });

    const second = await store.debit(25_000n, NOW);
    if (second.kind !== 'debited') throw new Error('expected a debit');
    await store.release(second.debitId, NOW);
    await expect(store.spend(NOW)).resolves.toMatchObject({
      utcDayMicroUsd: 25_000n,
      debits: { held: 0, retained: 1, released: 1 },
    });
  });

  it('persists the ledger across a fresh store instance', async () => {
    const store = await reset();
    const debit = await store.debit(1_000_000n, NOW);
    if (debit.kind !== 'debited') throw new Error('expected a debit');
    await store.retain(debit.debitId, NOW);

    await expect(new PostgresLaunchControlStore(pool).spend(NOW)).resolves.toMatchObject({
      utcDayMicroUsd: 1_000_000n,
      rolling30dMicroUsd: 1_000_000n,
      debits: { held: 0, retained: 1, released: 0 },
    });
  });

  it('admits exactly the daily cap under concurrent callers', async () => {
    const store = await reset();
    const amount = MICRO_USD_PER_USD; // $1 per dispatch
    const attempts = 60;
    const dailyCapUsd = Number(DAILY_CAP_MICRO_USD / MICRO_USD_PER_USD);

    // Two independent connections race the same singleton control row, which is
    // the same contention a multi-instance deployment produces.
    const pools = [new Pool({ connectionString: databaseUrl }), new Pool({ connectionString: databaseUrl })];
    const stores = pools.map((candidate) => new PostgresLaunchControlStore(candidate));
    try {
      const outcomes = await Promise.all(
        Array.from({ length: attempts }, (_unused, index) => stores[index % 2]!.debit(amount, NOW)),
      );
      expect(outcomes.filter((outcome) => outcome.kind === 'debited')).toHaveLength(dailyCapUsd);
    } finally {
      await Promise.all(pools.map((candidate) => candidate.end()));
    }

    await expect(store.spend(NOW)).resolves.toMatchObject({ utcDayMicroUsd: DAILY_CAP_MICRO_USD });
    await expect(store.status()).resolves.toMatchObject({
      state: 'paused',
      reason: 'provider_spend_cap_exhausted:utc_day',
    });
  });

  it('scores the UTC day and the rolling window with the database clock', async () => {
    const store = await reset();
    const lateUtc = Date.UTC(2026, 5, 1, 23, 0, 0);
    const nextUtcDay = Date.UTC(2026, 5, 2, 1, 0, 0);

    expect((await store.debit(DAILY_CAP_MICRO_USD, lateUtc)).kind).toBe('debited');
    await expect(store.spend(lateUtc + 30 * 60 * 1000)).resolves.toMatchObject({
      utcDayMicroUsd: DAILY_CAP_MICRO_USD,
      debits: { held: 1, retained: 0, released: 0 },
    });
    // The next UTC day starts at zero even though the debit is 2 hours old.
    await expect(store.spend(nextUtcDay)).resolves.toMatchObject({
      utcDayMicroUsd: 0n,
      rolling30dMicroUsd: DAILY_CAP_MICRO_USD,
    });

    expect((await store.debit(DAILY_CAP_MICRO_USD, nextUtcDay)).kind).toBe('debited');
    await expect(store.spend(nextUtcDay)).resolves.toMatchObject({ utcDayMicroUsd: DAILY_CAP_MICRO_USD });

    // Two daily ceilings are already recorded; three more fill the rolling cap.
    for (let day = 2; day < 5; day += 1) {
      expect((await store.debit(DAILY_CAP_MICRO_USD, nextUtcDay + (day - 1) * DAY_MS)).kind).toBe('debited');
    }
    const filledAt = nextUtcDay + 3 * DAY_MS;
    await expect(store.spend(filledAt)).resolves.toMatchObject({
      rolling30dMicroUsd: ROLLING_CAP_MICRO_USD,
      rollingHeadroomMicroUsd: 0n,
    });
    // The next UTC day has no daily spend, so only the rolling cap can refuse.
    await expect(store.debit(1n, filledAt + DAY_MS)).resolves.toEqual({
      kind: 'cap_exhausted',
      window: 'rolling_30d',
    });
  });

  it('drops a released debit out of both windows', async () => {
    const store = await reset();
    const debit = await store.debit(DAILY_CAP_MICRO_USD, NOW);
    if (debit.kind !== 'debited') throw new Error('expected a debit');
    await store.release(debit.debitId, NOW);

    // The daily cap is clear again, so a fresh dispatch is admitted.
    await expect(store.debit(DAILY_CAP_MICRO_USD, NOW)).resolves.toMatchObject({ kind: 'debited' });
    await expect(store.spend(NOW)).resolves.toMatchObject({ utcDayMicroUsd: DAILY_CAP_MICRO_USD });
  });

  it('stores no credential, nullifier, signal, generation id, or identity', async () => {
    const store = await reset();
    const debit = await store.debit(25_000n, NOW);
    if (debit.kind !== 'debited') throw new Error('expected a debit');

    const columns = await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'control_plane' AND table_name = 'launch_control'
           OR table_schema = 'spend_plane' AND table_name = 'dispatch_debits'
        ORDER BY table_name, column_name`,
    );
    const actual = columns.rows.map((row) => `${row.table_name}.${row.column_name}`);
    expect(actual).toEqual([
      'dispatch_debits.amount_micro_usd',
      'dispatch_debits.created_at',
      'dispatch_debits.debit_id',
      'dispatch_debits.settled_at',
      'dispatch_debits.state',
      'launch_control.control_id',
      'launch_control.reason',
      'launch_control.state',
      'launch_control.updated_at',
    ]);

    const row = await pool.query('SELECT * FROM spend_plane.dispatch_debits WHERE debit_id = $1', [debit.debitId]);
    expect(Object.keys(row.rows[0]!)).toEqual(
      ['debit_id', 'amount_micro_usd', 'state', 'created_at', 'settled_at'],
    );
    // The only durable identifier is the ledger's own sequence value.
    expect(JSON.stringify(row.rows[0])).not.toMatch(/nullifier|signal|proof|commitment|account|github|secret/iu);
  });
});
