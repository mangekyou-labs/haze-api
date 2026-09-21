/**
 * Durable launch controls for the invite-only unpaid pilot.
 *
 * Two independent capabilities share one module because both must be decided
 * inside the same transaction that admits a dispatch:
 *
 * - a single manual kill switch (`enabled` / `paused`), and
 * - integer micro-USD provider-spend accounting with a $40 per UTC day and
 *   $200 rolling 30-day cap.
 *
 * The ledger is deliberately unlinked: a debit carries its own sequence id, an
 * amount, a state, and a timestamp, and nothing else. No credential, nullifier,
 * request signal, provider generation id, or participant identity is stored
 * here, so no control or monitoring read can be joined to a spend-plane claim.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Pool } from 'pg';

export const MICRO_USD_PER_USD = 1_000_000n;
export const DAILY_CAP_MICRO_USD = 40n * MICRO_USD_PER_USD;
export const ROLLING_CAP_MICRO_USD = 200n * MICRO_USD_PER_USD;
export const ROLLING_WINDOW_DAYS = 30;
export const MAX_PAUSE_REASON_LENGTH = 200;

export type LaunchState = 'enabled' | 'paused';
export type SpendWindow = 'utc_day' | 'rolling_30d';
export type DebitState = 'held' | 'retained' | 'released';

export interface LaunchStatus {
  state: LaunchState;
  reason: string | null;
  updatedAt: number;
}

export interface SpendSnapshot {
  utcDayMicroUsd: bigint;
  rolling30dMicroUsd: bigint;
  dailyCapMicroUsd: bigint;
  rollingCapMicroUsd: bigint;
  dailyHeadroomMicroUsd: bigint;
  rollingHeadroomMicroUsd: bigint;
  debits: Record<DebitState, number>;
}

export type DebitOutcome =
  | { kind: 'debited'; debitId: string }
  | { kind: 'cap_exhausted'; window: SpendWindow }
  | { kind: 'paused' };

export interface LaunchControlStore {
  status(): Promise<LaunchStatus>;
  pause(reason: string, at: number): Promise<LaunchStatus>;
  resume(at: number): Promise<LaunchStatus>;
  /** Admits one dispatch or refuses it. Serialized against concurrent callers. */
  debit(amountMicroUsd: bigint, at: number): Promise<DebitOutcome>;
  retain(debitId: string, at: number): Promise<void>;
  release(debitId: string, at: number): Promise<void>;
  spend(at: number): Promise<SpendSnapshot>;
}

export class LaunchControlUnavailableError extends Error {
  constructor(message = 'launch_control_unavailable') {
    super(message);
    this.name = 'LaunchControlUnavailableError';
  }
}

export class InvalidPauseReasonError extends Error {
  constructor() {
    super('invalid_pause_reason');
    this.name = 'InvalidPauseReasonError';
  }
}

function toMillis(value: unknown): number {
  return new Date(value as string | Date).getTime();
}

function toStatus(row: Record<string, unknown>): LaunchStatus {
  return {
    state: String(row.state) as LaunchState,
    reason: row.reason === null || row.reason === undefined ? null : String(row.reason),
    updatedAt: toMillis(row.updated_at),
  };
}

function assertReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PAUSE_REASON_LENGTH) throw new InvalidPauseReasonError();
  return trimmed;
}

/** Durable control-plane and spend-plane implementation used by the gateway. */
export class PostgresLaunchControlStore implements LaunchControlStore {
  constructor(private readonly pool: Pool) {}

  async status(): Promise<LaunchStatus> {
    const result = await this.pool.query(
      `SELECT state, reason, updated_at FROM control_plane.launch_control WHERE control_id = 1`,
    );
    if (!result.rows[0]) throw new LaunchControlUnavailableError();
    return toStatus(result.rows[0] as Record<string, unknown>);
  }

  async pause(reason: string, at: number): Promise<LaunchStatus> {
    const result = await this.pool.query(
      `UPDATE control_plane.launch_control
          SET state = 'paused', reason = $1, updated_at = to_timestamp($2 / 1000.0)
        WHERE control_id = 1
      RETURNING state, reason, updated_at`,
      [assertReason(reason), at],
    );
    if (!result.rows[0]) throw new LaunchControlUnavailableError();
    return toStatus(result.rows[0] as Record<string, unknown>);
  }

  async resume(at: number): Promise<LaunchStatus> {
    const result = await this.pool.query(
      `UPDATE control_plane.launch_control
          SET state = 'enabled', reason = NULL, updated_at = to_timestamp($1 / 1000.0)
        WHERE control_id = 1
      RETURNING state, reason, updated_at`,
      [at],
    );
    if (!result.rows[0]) throw new LaunchControlUnavailableError();
    return toStatus(result.rows[0] as Record<string, unknown>);
  }

  async debit(amountMicroUsd: bigint, at: number): Promise<DebitOutcome> {
    if (amountMicroUsd <= 0n) throw new Error('invalid_debit_amount');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Locking the singleton control row serializes every admission, so the
      // window sums below cannot race another dispatch's insert.
      const control = await client.query(
        `SELECT state FROM control_plane.launch_control WHERE control_id = 1 FOR UPDATE`,
      );
      if (!control.rows[0]) throw new LaunchControlUnavailableError();
      if (String(control.rows[0].state) === 'paused') {
        await client.query('COMMIT');
        return { kind: 'paused' };
      }
      const sums = await client.query(
        `SELECT
           COALESCE(SUM(amount_micro_usd) FILTER (
             WHERE created_at >= date_trunc('day', to_timestamp($1 / 1000.0) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
           ), 0)::text AS utc_day,
           COALESCE(SUM(amount_micro_usd) FILTER (
             WHERE created_at >= to_timestamp($1 / 1000.0) - ($2 || ' days')::interval
           ), 0)::text AS rolling
         FROM spend_plane.dispatch_debits
         WHERE state <> 'released'`,
        [at, String(ROLLING_WINDOW_DAYS)],
      );
      const row = sums.rows[0] as Record<string, unknown>;
      const utcDay = BigInt(String(row.utc_day));
      const rolling = BigInt(String(row.rolling));
      const window: SpendWindow | undefined = utcDay + amountMicroUsd > DAILY_CAP_MICRO_USD
        ? 'utc_day'
        : rolling + amountMicroUsd > ROLLING_CAP_MICRO_USD
          ? 'rolling_30d'
          : undefined;
      if (window) {
        // The exhausted cap is a durable launch state, not a per-request error:
        // it pauses the pilot until an operator reviews spend and resumes.
        await client.query(
          `UPDATE control_plane.launch_control
              SET state = 'paused', reason = $1, updated_at = to_timestamp($2 / 1000.0)
            WHERE control_id = 1`,
          [`provider_spend_cap_exhausted:${window}`, at],
        );
        await client.query('COMMIT');
        return { kind: 'cap_exhausted', window };
      }
      const inserted = await client.query(
        `INSERT INTO spend_plane.dispatch_debits (amount_micro_usd, state, created_at)
         VALUES ($1, 'held', to_timestamp($2 / 1000.0))
         RETURNING debit_id`,
        [amountMicroUsd.toString(), at],
      );
      await client.query('COMMIT');
      return { kind: 'debited', debitId: String((inserted.rows[0] as Record<string, unknown>).debit_id) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async retain(debitId: string, at: number): Promise<void> {
    await this.pool.query(
      `UPDATE spend_plane.dispatch_debits
          SET state = 'retained', settled_at = to_timestamp($2 / 1000.0)
        WHERE debit_id = $1 AND state = 'held'`,
      [debitId, at],
    );
  }

  async release(debitId: string, at: number): Promise<void> {
    await this.pool.query(
      `UPDATE spend_plane.dispatch_debits
          SET state = 'released', settled_at = to_timestamp($2 / 1000.0)
        WHERE debit_id = $1 AND state = 'held'`,
      [debitId, at],
    );
  }

  async spend(at: number): Promise<SpendSnapshot> {
    const sums = await this.pool.query(
      `SELECT
         COALESCE(SUM(amount_micro_usd) FILTER (
           WHERE state <> 'released'
             AND created_at >= date_trunc('day', to_timestamp($1 / 1000.0) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
         ), 0)::text AS utc_day,
         COALESCE(SUM(amount_micro_usd) FILTER (
           WHERE state <> 'released'
             AND created_at >= to_timestamp($1 / 1000.0) - ($2 || ' days')::interval
         ), 0)::text AS rolling,
         COALESCE(COUNT(*) FILTER (WHERE state = 'held'), 0)::int AS held,
         COALESCE(COUNT(*) FILTER (WHERE state = 'retained'), 0)::int AS retained,
         COALESCE(COUNT(*) FILTER (WHERE state = 'released'), 0)::int AS released
       FROM spend_plane.dispatch_debits`,
      [at, String(ROLLING_WINDOW_DAYS)],
    );
    const row = sums.rows[0] as Record<string, unknown>;
    const utcDayMicroUsd = BigInt(String(row.utc_day));
    const rolling30dMicroUsd = BigInt(String(row.rolling));
    return {
      utcDayMicroUsd,
      rolling30dMicroUsd,
      dailyCapMicroUsd: DAILY_CAP_MICRO_USD,
      rollingCapMicroUsd: ROLLING_CAP_MICRO_USD,
      dailyHeadroomMicroUsd: DAILY_CAP_MICRO_USD > utcDayMicroUsd ? DAILY_CAP_MICRO_USD - utcDayMicroUsd : 0n,
      rollingHeadroomMicroUsd: ROLLING_CAP_MICRO_USD > rolling30dMicroUsd ? ROLLING_CAP_MICRO_USD - rolling30dMicroUsd : 0n,
      debits: {
        held: Number(row.held),
        retained: Number(row.retained),
        released: Number(row.released),
      },
    };
  }
}

interface MemoryDebit {
  debitId: string;
  amountMicroUsd: bigint;
  state: DebitState;
  createdAt: number;
}

/** Deterministic fallback for local runs and focused tests. */
export class MemoryLaunchControlStore implements LaunchControlStore {
  private state: LaunchState = 'enabled';
  private reason: string | null = null;
  private updatedAt = 0;
  private readonly debits: MemoryDebit[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  /** Serializes every mutation the way the Postgres row lock does. */
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async status(): Promise<LaunchStatus> {
    return { state: this.state, reason: this.reason, updatedAt: this.updatedAt };
  }

  async pause(reason: string, at: number): Promise<LaunchStatus> {
    const trimmed = assertReason(reason);
    return this.serialize(async () => {
      this.state = 'paused';
      this.reason = trimmed;
      this.updatedAt = at;
      return this.status();
    });
  }

  async resume(at: number): Promise<LaunchStatus> {
    return this.serialize(async () => {
      this.state = 'enabled';
      this.reason = null;
      this.updatedAt = at;
      return this.status();
    });
  }

  async debit(amountMicroUsd: bigint, at: number): Promise<DebitOutcome> {
    if (amountMicroUsd <= 0n) throw new Error('invalid_debit_amount');
    return this.serialize(async () => {
      if (this.state === 'paused') return { kind: 'paused' as const };
      const snapshot = this.snapshotAt(at);
      const window: SpendWindow | undefined = snapshot.utcDayMicroUsd + amountMicroUsd > DAILY_CAP_MICRO_USD
        ? 'utc_day'
        : snapshot.rolling30dMicroUsd + amountMicroUsd > ROLLING_CAP_MICRO_USD
          ? 'rolling_30d'
          : undefined;
      if (window) {
        this.state = 'paused';
        this.reason = `provider_spend_cap_exhausted:${window}`;
        this.updatedAt = at;
        return { kind: 'cap_exhausted' as const, window };
      }
      const debit: MemoryDebit = {
        debitId: `debit_${this.debits.length + 1}`,
        amountMicroUsd,
        state: 'held',
        createdAt: at,
      };
      this.debits.push(debit);
      return { kind: 'debited' as const, debitId: debit.debitId };
    });
  }

  async retain(debitId: string, _at: number): Promise<void> {
    await this.serialize(async () => {
      const debit = this.debits.find((candidate) => candidate.debitId === debitId);
      if (debit && debit.state === 'held') debit.state = 'retained';
    });
  }

  async release(debitId: string, _at: number): Promise<void> {
    await this.serialize(async () => {
      const debit = this.debits.find((candidate) => candidate.debitId === debitId);
      if (debit && debit.state === 'held') debit.state = 'released';
    });
  }

  async spend(at: number): Promise<SpendSnapshot> {
    return this.snapshotAt(at);
  }

  private snapshotAt(at: number): SpendSnapshot {
    const open = this.debits.filter((debit) => debit.state !== 'released');
    const dayStart = utcDayStart(at);
    const rollingStart = at - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const utcDayMicroUsd = open
      .filter((debit) => debit.createdAt >= dayStart)
      .reduce((total, debit) => total + debit.amountMicroUsd, 0n);
    const rolling30dMicroUsd = open
      .filter((debit) => debit.createdAt >= rollingStart)
      .reduce((total, debit) => total + debit.amountMicroUsd, 0n);
    const count = (state: DebitState) => this.debits.filter((debit) => debit.state === state).length;
    return {
      utcDayMicroUsd,
      rolling30dMicroUsd,
      dailyCapMicroUsd: DAILY_CAP_MICRO_USD,
      rollingCapMicroUsd: ROLLING_CAP_MICRO_USD,
      dailyHeadroomMicroUsd: DAILY_CAP_MICRO_USD > utcDayMicroUsd ? DAILY_CAP_MICRO_USD - utcDayMicroUsd : 0n,
      rollingHeadroomMicroUsd: ROLLING_CAP_MICRO_USD > rolling30dMicroUsd ? ROLLING_CAP_MICRO_USD - rolling30dMicroUsd : 0n,
      debits: { held: count('held'), retained: count('retained'), released: count('released') },
    };
  }
}

/** Start of the UTC day containing `at`. */
export function utcDayStart(at: number): number {
  return Date.UTC(
    new Date(at).getUTCFullYear(),
    new Date(at).getUTCMonth(),
    new Date(at).getUTCDate(),
  );
}

export interface LaunchControlOptions {
  store: LaunchControlStore;
  now?: () => number;
}

/** Applies launch state to admission decisions and records debit settlement. */
export class LaunchControl {
  private readonly store: LaunchControlStore;
  private readonly now: () => number;

  constructor(options: LaunchControlOptions) {
    this.store = options.store;
    this.now = options.now ?? Date.now;
  }

  status(): Promise<LaunchStatus> {
    return this.store.status();
  }

  spend(): Promise<SpendSnapshot> {
    return this.store.spend(this.now());
  }

  async isPaused(): Promise<boolean> {
    return (await this.store.status()).state === 'paused';
  }

  pause(reason: string): Promise<LaunchStatus> {
    return this.store.pause(reason, this.now());
  }

  resume(): Promise<LaunchStatus> {
    return this.store.resume(this.now());
  }

  /**
   * Debits the conservative dispatch ceiling before the request leaves the
   * process. A refused admission (paused or cap exhausted) never dispatches.
   */
  beginDispatch(amountMicroUsd: bigint): Promise<DebitOutcome> {
    return this.store.debit(amountMicroUsd, this.now());
  }

  /** Retains the debit once dispatch began, including provider errors. */
  retain(debitId: string): Promise<void> {
    return this.store.retain(debitId, this.now());
  }

  /** Releases the debit only when the failure happened before dispatch. */
  release(debitId: string): Promise<void> {
    return this.store.release(debitId, this.now());
  }
}
