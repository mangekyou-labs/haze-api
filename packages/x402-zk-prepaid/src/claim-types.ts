/**
 * Claim records and the compatibility-facing persistence contract.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export type ClaimState = 'reserved' | 'ready' | 'committed' | 'cancelled';

export interface ClaimFence {
  reservationId: string;
  generation: number;
  fencingToken: string;
}

export interface ClaimRecord extends ClaimFence {
  nullifier: string;
  signalHash: string;
  state: ClaimState;
  createdAt: number;
  updatedAt: number;
  leaseExpiresAt: number;
  dispatchCount: number;
  encryptedReplay?: string;
  replayExpiresAt?: number;
  dispatchIdempotencyKey?: string;
  commitIdempotencyKey?: string;
}

export interface ClaimReservation {
  kind: 'new' | 'existing';
  record: ClaimRecord;
}

/**
 * Compatibility-facing atomic persistence contract consumed by ClaimLifecycle.
 * Each mutation carries the fence returned by reserve, so a stale worker
 * cannot mutate a takeover.
 */
export interface ClaimStore {
  reserve(nullifier: string, signalHash: string, now?: number): Promise<ClaimReservation>;
  beginDispatch(fence: ClaimFence, idempotencyKey: string, now?: number): Promise<ClaimRecord>;
  stageReady(fence: ClaimFence, encryptedReplay: string, now?: number): Promise<ClaimRecord>;
  commit(fence: ClaimFence, idempotencyKey: string, now?: number): Promise<ClaimRecord>;
  cancel(fence: ClaimFence, now?: number): Promise<ClaimRecord>;
  resetDispatchBudget(fence: ClaimFence, operatorToken: string, now?: number): Promise<ClaimRecord>;
  lookup(nullifier: string, signalHash?: string, now?: number): Promise<ClaimRecord | undefined>;
  lookupByReservation(reservationId: string, now?: number): Promise<ClaimRecord | undefined>;
  /** Read-only compatibility alias; mutating callers must use a fence. */
  get(nullifier: string, now?: number): Promise<ClaimRecord | undefined>;
  expireReservations(before: number): Promise<number>;
}
