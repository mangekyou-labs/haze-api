/**
 * Isolated spend-plane persistence for the zk-prepaid scheme.
 *
 * This module intentionally has no account, wallet, Stripe, commitment, or
 * prompt/response fields. Nullifiers and request-signal digests stay inside
 * this claim store and are never copied into control-plane records.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Pool } from 'pg';
import {
  InMemoryClaimStore,
  type ClaimFence,
  type ClaimRecord,
  type ClaimState,
  type ClaimStore,
} from '@zk-credits/x402-zk-prepaid';

export const RESERVATION_LEASE_MS = 5 * 60 * 1000;
export const REPLAY_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_DISPATCH_COUNT = 2;

const CLAIM_COLUMNS = `
  nullifier, signal_hash, state, reservation_id, generation,
  fencing_token, created_at, updated_at, lease_expires_at, dispatch_count,
  encrypted_replay, replay_expires_at, dispatch_idempotency_key,
  commit_idempotency_key`;

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function toRecord(row: Record<string, unknown>): ClaimRecord {
  return {
    nullifier: String(row.nullifier),
    signalHash: String(row.signal_hash),
    state: String(row.state) as ClaimState,
    reservationId: String(row.reservation_id),
    generation: Number(row.generation),
    fencingToken: String(row.fencing_token),
    createdAt: new Date(String(row.created_at)).getTime(),
    updatedAt: new Date(String(row.updated_at)).getTime(),
    leaseExpiresAt: new Date(String(row.lease_expires_at)).getTime(),
    dispatchCount: Number(row.dispatch_count),
    ...(optionalString(row.encrypted_replay) ? { encryptedReplay: String(row.encrypted_replay) } : {}),
    ...(row.replay_expires_at ? { replayExpiresAt: new Date(String(row.replay_expires_at)).getTime() } : {}),
    ...(optionalString(row.dispatch_idempotency_key) ? { dispatchIdempotencyKey: String(row.dispatch_idempotency_key) } : {}),
    ...(optionalString(row.commit_idempotency_key) ? { commitIdempotencyKey: String(row.commit_idempotency_key) } : {}),
  };
}

function fenceMatches(record: ClaimRecord, fence: ClaimFence): boolean {
  return record.reservationId === fence.reservationId
    && record.generation === fence.generation
    && record.fencingToken === fence.fencingToken;
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : 'claim_store_error';
}

export interface PostgresClaimStoreOptions {
  operatorToken?: string;
}

/** A Postgres-backed implementation used by the gateway process. */
export class PostgresClaimStore implements ClaimStore {
  private readonly operatorToken: string;

  constructor(private readonly pool: Pool, options: PostgresClaimStoreOptions = {}) {
    this.operatorToken = options.operatorToken ?? process.env.CLAIM_STORE_OPERATOR_TOKEN ?? '';
  }

  async reserve(nullifier: string, signalHash: string, now = Date.now()): Promise<{ kind: 'new' | 'existing'; record: ClaimRecord }> {
    const reservationId = crypto.randomUUID();
    const fencingToken = crypto.randomUUID();
    await this.pool.query(
      `INSERT INTO spend_plane.claims AS existing
         (nullifier, signal_hash, state, reservation_id, generation, fencing_token,
          created_at, updated_at, lease_expires_at, dispatch_count)
       VALUES ($1, $2, 'reserved', $3, 1, $4,
          to_timestamp($5 / 1000.0), to_timestamp($5 / 1000.0),
          to_timestamp($6 / 1000.0), 0)
       ON CONFLICT (nullifier) DO UPDATE SET
         state = 'reserved',
         reservation_id = EXCLUDED.reservation_id,
         generation = existing.generation + 1,
         fencing_token = EXCLUDED.fencing_token,
         updated_at = EXCLUDED.updated_at,
         lease_expires_at = EXCLUDED.lease_expires_at,
         encrypted_replay = NULL,
         replay_expires_at = NULL,
         dispatch_idempotency_key = NULL,
         commit_idempotency_key = NULL
       WHERE existing.signal_hash = EXCLUDED.signal_hash
         AND (
           (existing.state = 'cancelled' AND existing.dispatch_count < ${MAX_DISPATCH_COUNT})
           OR (existing.state = 'reserved'
               AND existing.lease_expires_at <= EXCLUDED.updated_at
               AND existing.dispatch_count < ${MAX_DISPATCH_COUNT})
         )`,
      [nullifier, signalHash, reservationId, fencingToken, now, now + RESERVATION_LEASE_MS],
    );
    const result = await this.pool.query(
      `SELECT ${CLAIM_COLUMNS} FROM spend_plane.claims WHERE nullifier = $1`,
      [nullifier],
    );
    if (!result.rows[0]) throw new Error('claim_not_found_after_reservation');
    const record = toRecord(result.rows[0] as Record<string, unknown>);
    if (record.signalHash !== signalHash) throw new Error('conflicting_signal');
    return { kind: record.reservationId === reservationId ? 'new' : 'existing', record };
  }

  async beginDispatch(fence: ClaimFence, idempotencyKey: string, now = Date.now()): Promise<ClaimRecord> {
    const result = await this.pool.query(
      `UPDATE spend_plane.claims
          SET dispatch_count = CASE
                WHEN dispatch_idempotency_key = $4 THEN dispatch_count
                ELSE dispatch_count + 1
              END,
              dispatch_idempotency_key = COALESCE(dispatch_idempotency_key, $4),
              updated_at = to_timestamp($5 / 1000.0),
              lease_expires_at = to_timestamp($6 / 1000.0)
        WHERE reservation_id = $1
          AND generation = $2
          AND fencing_token = $3
          AND state = 'reserved'
          AND lease_expires_at > to_timestamp($5 / 1000.0)
          AND (
            dispatch_idempotency_key = $4
            OR (dispatch_idempotency_key IS NULL AND dispatch_count < ${MAX_DISPATCH_COUNT})
          )
      RETURNING ${CLAIM_COLUMNS}`,
      [fence.reservationId, fence.generation, fence.fencingToken, idempotencyKey, now, now + RESERVATION_LEASE_MS],
    );
    if (result.rows[0]) return toRecord(result.rows[0] as Record<string, unknown>);
    const current = await this.lookupByReservation(fence.reservationId, now);
    if (!current || !fenceMatches(current, fence)) throw new Error('stale_fence');
    if (current.state === 'reserved' && current.leaseExpiresAt <= now) throw new Error('reservation_lease_expired');
    if (current.state === 'reserved' && current.dispatchCount >= MAX_DISPATCH_COUNT) throw new Error('dispatch_budget_exhausted');
    if (current.state === 'reserved' && current.dispatchIdempotencyKey && current.dispatchIdempotencyKey !== idempotencyKey) throw new Error('dispatch_in_progress');
    if (current.dispatchIdempotencyKey === idempotencyKey) return current;
    throw new Error('claim_not_dispatchable');
  }

  async stageReady(fence: ClaimFence, encryptedReplay: string, now = Date.now()): Promise<ClaimRecord> {
    const result = await this.pool.query(
      `UPDATE spend_plane.claims
          SET state = 'ready',
              encrypted_replay = $4,
              replay_expires_at = to_timestamp($5 / 1000.0),
              updated_at = to_timestamp($6 / 1000.0)
        WHERE reservation_id = $1
          AND generation = $2
          AND fencing_token = $3
          AND state = 'reserved'
          AND lease_expires_at > to_timestamp($6 / 1000.0)
          AND dispatch_idempotency_key IS NOT NULL
      RETURNING ${CLAIM_COLUMNS}`,
      [fence.reservationId, fence.generation, fence.fencingToken, encryptedReplay, now + REPLAY_TTL_MS, now],
    );
    if (result.rows[0]) return toRecord(result.rows[0] as Record<string, unknown>);
    const current = await this.lookupByReservation(fence.reservationId, now);
    if (!current || !fenceMatches(current, fence)) throw new Error('stale_fence');
    if ((current.state === 'ready' || current.state === 'committed') && current.encryptedReplay === encryptedReplay) return current;
    if (current.state === 'cancelled') throw new Error('claim_cancelled');
    if (current.state === 'reserved' && current.leaseExpiresAt <= now) throw new Error('reservation_lease_expired');
    throw new Error(current.state === 'reserved' ? 'dispatch_not_started' : 'idempotency_conflict');
  }

  async commit(fence: ClaimFence, idempotencyKey: string, now = Date.now()): Promise<ClaimRecord> {
    const result = await this.pool.query(
      `UPDATE spend_plane.claims
          SET state = 'committed',
              commit_idempotency_key = COALESCE(commit_idempotency_key, $4),
              updated_at = to_timestamp($5 / 1000.0)
        WHERE reservation_id = $1
          AND generation = $2
          AND fencing_token = $3
          AND state = 'ready'
          AND (commit_idempotency_key IS NULL OR commit_idempotency_key = $4)
      RETURNING ${CLAIM_COLUMNS}`,
      [fence.reservationId, fence.generation, fence.fencingToken, idempotencyKey, now],
    );
    if (result.rows[0]) return toRecord(result.rows[0] as Record<string, unknown>);
    const current = await this.lookupByReservation(fence.reservationId, now);
    if (!current || !fenceMatches(current, fence)) throw new Error('stale_fence');
    if (current.state === 'committed' && (!current.commitIdempotencyKey || current.commitIdempotencyKey === idempotencyKey)) return current;
    if (current.state === 'cancelled') throw new Error('claim_cancelled');
    throw new Error('commit_requires_ready');
  }

  async cancel(fence: ClaimFence, now = Date.now()): Promise<ClaimRecord> {
    const result = await this.pool.query(
      `UPDATE spend_plane.claims
          SET state = 'cancelled', updated_at = to_timestamp($4 / 1000.0)
        WHERE reservation_id = $1
          AND generation = $2
          AND fencing_token = $3
          AND state = 'reserved'
          AND lease_expires_at > to_timestamp($4 / 1000.0)
      RETURNING ${CLAIM_COLUMNS}`,
      [fence.reservationId, fence.generation, fence.fencingToken, now],
    );
    if (result.rows[0]) return toRecord(result.rows[0] as Record<string, unknown>);
    const current = await this.lookupByReservation(fence.reservationId, now);
    if (!current || !fenceMatches(current, fence)) throw new Error('stale_fence');
    if (current.state === 'cancelled') return current;
    if (current.state === 'reserved' && current.leaseExpiresAt <= now) throw new Error('reservation_lease_expired');
    throw new Error('claim_not_cancellable');
  }

  async resetDispatchBudget(fence: ClaimFence, operatorToken: string, now = Date.now()): Promise<ClaimRecord> {
    if (!this.operatorToken || operatorToken !== this.operatorToken) throw new Error('operator_auth_required');
    const current = await this.lookupByReservation(fence.reservationId, now);
    if (!current || !fenceMatches(current, fence)) throw new Error('stale_fence');
    if (current.state === 'ready' || current.state === 'committed') throw new Error('claim_already_ready');
    const nextReservationId = crypto.randomUUID();
    const nextFencingToken = crypto.randomUUID();
    const result = await this.pool.query(
      `UPDATE spend_plane.claims
          SET state = 'cancelled',
              reservation_id = $4,
              generation = generation + 1,
              fencing_token = $5,
              dispatch_count = 0,
              dispatch_idempotency_key = NULL,
              commit_idempotency_key = NULL,
              encrypted_replay = NULL,
              replay_expires_at = NULL,
              lease_expires_at = to_timestamp($6 / 1000.0),
              updated_at = to_timestamp($7 / 1000.0)
        WHERE reservation_id = $1
          AND generation = $2
          AND fencing_token = $3
          AND state IN ('reserved', 'cancelled')
      RETURNING ${CLAIM_COLUMNS}`,
      [fence.reservationId, fence.generation, fence.fencingToken, nextReservationId, nextFencingToken, now + RESERVATION_LEASE_MS, now],
    );
    if (!result.rows[0]) throw new Error('stale_fence');
    return toRecord(result.rows[0] as Record<string, unknown>);
  }

  async lookup(nullifier: string, signalHash?: string, now = Date.now()): Promise<ClaimRecord | undefined> {
    await this.clearExpiredReplay(nullifier, now);
    const result = await this.pool.query(
      `SELECT ${CLAIM_COLUMNS} FROM spend_plane.claims WHERE nullifier = $1`,
      [nullifier],
    );
    if (!result.rows[0]) return undefined;
    const record = toRecord(result.rows[0] as Record<string, unknown>);
    if (signalHash !== undefined && record.signalHash !== signalHash) throw new Error('conflicting_signal');
    return record;
  }

  async get(nullifier: string, now = Date.now()): Promise<ClaimRecord | undefined> {
    return this.lookup(nullifier, undefined, now);
  }

  async lookupByReservation(reservationId: string, now = Date.now()): Promise<ClaimRecord | undefined> {
    await this.clearExpiredReplayByReservation(reservationId, now);
    const result = await this.pool.query(
      `SELECT ${CLAIM_COLUMNS} FROM spend_plane.claims WHERE reservation_id = $1`,
      [reservationId],
    );
    return result.rows[0] ? toRecord(result.rows[0] as Record<string, unknown>) : undefined;
  }

  async expireReservations(before: number): Promise<number> {
    const result = await this.pool.query(
      `UPDATE spend_plane.claims
          SET state = 'cancelled', updated_at = to_timestamp($1 / 1000.0)
        WHERE state = 'reserved' AND lease_expires_at <= to_timestamp($1 / 1000.0)`,
      [before],
    );
    return result.rowCount ?? 0;
  }

  private async clearExpiredReplay(nullifier: string, now: number): Promise<void> {
    await this.pool.query(
      `UPDATE spend_plane.claims
          SET encrypted_replay = NULL, replay_expires_at = NULL
        WHERE nullifier = $1 AND replay_expires_at IS NOT NULL AND replay_expires_at <= to_timestamp($2 / 1000.0)`,
      [nullifier, now],
    );
  }

  private async clearExpiredReplayByReservation(reservationId: string, now: number): Promise<void> {
    await this.pool.query(
      `UPDATE spend_plane.claims
          SET encrypted_replay = NULL, replay_expires_at = NULL
        WHERE reservation_id = $1 AND replay_expires_at IS NOT NULL AND replay_expires_at <= to_timestamp($2 / 1000.0)`,
      [reservationId, now],
    );
  }
}

export function createClaimStore(pool?: Pool): ClaimStore {
  if (pool) return new PostgresClaimStore(pool);
  return new LocalClaimStore({ operatorToken: process.env.CLAIM_STORE_OPERATOR_TOKEN });
}

/** Small local fallback used by focused tests and unpaid local runs. */
export class LocalClaimStore extends InMemoryClaimStore {
  constructor(options: { operatorToken?: string } = {}) {
    super(options);
  }
}

export function claimFence(record: ClaimRecord): ClaimFence {
  return {
    reservationId: record.reservationId,
    generation: record.generation,
    fencingToken: record.fencingToken,
  };
}

export function claimStoreErrorCode(error: unknown): string {
  return errorCode(error);
}
