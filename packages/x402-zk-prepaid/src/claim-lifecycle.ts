/**
 * Shared Claim decisions and orchestration for the gateway and facilitator.
 *
 * Persistence adapters keep each fenced mutation atomic. This module owns
 * reservation outcomes, retry and replay eligibility, idempotency keys,
 * successful completion, and safe cancellation.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type {
  ClaimFence,
  ClaimRecord,
  ClaimReservation,
  ClaimStore,
} from './claim-types.js';

export const CLAIM_RESERVATION_LEASE_MS = 5 * 60 * 1000;
export const CLAIM_REPLAY_TTL_MS = 24 * 60 * 60 * 1000;
export const CLAIM_MAX_DISPATCH_COUNT = 2;

export type ClaimDisposition =
  | { kind: 'in_progress' }
  | { kind: 'ambiguous_commit' }
  | { kind: 'committed'; replayAvailable: boolean }
  | { kind: 'cancelled'; retryAllowed: boolean };

export interface ClaimLifecycle {
  reserve(nullifier: string, signalHash: string, at?: number): Promise<ClaimReservation>;
  classify(record: ClaimRecord): ClaimDisposition;
  beginDispatch(record: ClaimRecord, at?: number): Promise<ClaimRecord>;
  stageReady(record: ClaimRecord, encryptedReplay: string, at?: number): Promise<ClaimRecord>;
  commit(record: ClaimRecord, at?: number): Promise<ClaimRecord>;
  complete(record: ClaimRecord, encryptedReplay: string, at?: number): Promise<ClaimRecord>;
  cancel(record: ClaimRecord, at?: number): Promise<ClaimRecord>;
  resetDispatchBudget(record: ClaimRecord, operatorToken: string, at?: number): Promise<ClaimRecord>;
  cancelIfReserved(
    nullifier: string,
    signalHash: string,
    fence: ClaimFence,
    at?: number,
  ): Promise<boolean>;
  lookup(nullifier: string, signalHash?: string, at?: number): Promise<ClaimRecord | undefined>;
  lookupByReservation(reservationId: string, at?: number): Promise<ClaimRecord | undefined>;
}

export interface ClaimLifecycleOptions {
  now?: () => number;
}

const CLAIM_LIFECYCLE_CONFLICTS = new Set([
  'conflicting_signal',
  'stale_fence',
  'claim_cancelled',
  'claim_not_dispatchable',
  'dispatch_in_progress',
  'dispatch_budget_exhausted',
  'reservation_lease_expired',
  'dispatch_not_started',
  'claim_not_stageable',
  'idempotency_conflict',
  'commit_requires_ready',
  'claim_not_cancellable',
  'claim_already_ready',
  'operator_auth_required',
  'reservation_not_found',
]);

/** Marks failures after `ready` as fail-closed commit ambiguity. */
export class ClaimCommitAmbiguousError extends Error {
  constructor(cause: unknown) {
    super('claim_store_unavailable', { cause });
    this.name = 'ClaimCommitAmbiguousError';
  }
}

export function claimFence(record: ClaimRecord): ClaimFence {
  return {
    reservationId: record.reservationId,
    generation: record.generation,
    fencingToken: record.fencingToken,
  };
}

export function classifyClaim(record: ClaimRecord): ClaimDisposition {
  switch (record.state) {
    case 'reserved':
      return { kind: 'in_progress' };
    case 'ready':
      return { kind: 'ambiguous_commit' };
    case 'committed':
      return { kind: 'committed', replayAvailable: Boolean(record.encryptedReplay) };
    case 'cancelled':
      return {
        kind: 'cancelled',
        retryAllowed: record.dispatchCount < CLAIM_MAX_DISPATCH_COUNT,
      };
  }
}

export function isClaimLifecycleConflict(code: string): boolean {
  return CLAIM_LIFECYCLE_CONFLICTS.has(code);
}

function sameFence(left: ClaimFence, right: ClaimFence): boolean {
  return left.reservationId === right.reservationId
    && left.generation === right.generation
    && left.fencingToken === right.fencingToken;
}

function idempotencyKey(record: ClaimRecord, phase: 'dispatch' | 'commit'): string {
  return `${record.nullifier}:${record.signalHash}:${record.generation}:${phase}`;
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : 'claim_store_error';
}

export function createClaimLifecycle(
  store: ClaimStore,
  options: ClaimLifecycleOptions = {},
): ClaimLifecycle {
  const now = options.now ?? Date.now;
  const at = (supplied?: number): number => supplied ?? now();

  const lifecycle: ClaimLifecycle = {
    reserve(nullifier, signalHash, timestamp) {
      return store.reserve(nullifier, signalHash, at(timestamp));
    },

    classify: classifyClaim,

    beginDispatch(record, timestamp) {
      return store.beginDispatch(
        claimFence(record),
        idempotencyKey(record, 'dispatch'),
        at(timestamp),
      );
    },

    stageReady(record, encryptedReplay, timestamp) {
      return store.stageReady(claimFence(record), encryptedReplay, at(timestamp));
    },

    async commit(record, timestamp) {
      try {
        return await store.commit(
          claimFence(record),
          idempotencyKey(record, 'commit'),
          at(timestamp),
        );
      } catch (error) {
        if (isClaimLifecycleConflict(errorCode(error))) throw error;
        throw new ClaimCommitAmbiguousError(error);
      }
    },

    async complete(record, encryptedReplay, timestamp) {
      const dispatch = record.state === 'reserved'
        ? await lifecycle.beginDispatch(record, timestamp)
        : record;
      const ready = dispatch.state === 'ready' || dispatch.state === 'committed'
        ? dispatch
        : await lifecycle.stageReady(dispatch, encryptedReplay, timestamp);
      return lifecycle.commit(ready, timestamp);
    },

    cancel(record, timestamp) {
      return store.cancel(claimFence(record), at(timestamp));
    },

    resetDispatchBudget(record, operatorToken, timestamp) {
      return store.resetDispatchBudget(claimFence(record), operatorToken, at(timestamp));
    },

    async cancelIfReserved(nullifier, signalHash, fence, timestamp) {
      const current = await lifecycle.lookup(nullifier, signalHash, timestamp);
      if (!current || current.state !== 'reserved' || !sameFence(claimFence(current), fence)) return false;
      await lifecycle.cancel(current, timestamp);
      return true;
    },

    lookup(nullifier, signalHash, timestamp) {
      return store.lookup(nullifier, signalHash, at(timestamp));
    },

    lookupByReservation(reservationId, timestamp) {
      return store.lookupByReservation(reservationId, at(timestamp));
    },
  };

  return lifecycle;
}
