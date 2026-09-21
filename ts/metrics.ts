/**
 * Bounded aggregate counters for the pilot service.
 *
 * Every counter name is fixed at build time and every value is an integer, so
 * a metric can never carry an account, order, wallet, commitment, nullifier,
 * request signal, proof, prompt, or response. Counters are process-local
 * aggregates only; the durable spend ledger lives in `launch-control.ts`.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export const METRIC_NAMES = [
  /** Missing authorization produced a fresh challenge. */
  'challenge_issued',
  /** Structurally valid authorization from the scheme's verifier. */
  'proof_valid',
  /** Rejected authorization: bad proof, root, domain, or timestamp. */
  'proof_invalid',
  /** First reservation for a nullifier. */
  'reservation_new',
  /** Exact retry that coalesced onto an existing reservation. */
  'reservation_existing',
  /** Reservation reached the committed state. */
  'claim_committed',
  /** Reservation was cancelled before commit. */
  'claim_cancelled',
  /** Exact retry of a committed claim returned the encrypted replay. */
  'claim_replayed',
  /** Same nullifier presented with a different request signal. */
  'claim_conflict',
  /** Provider dispatch returned a usable 2xx. */
  'dispatch_ok',
  /** Provider dispatch failed with a non-2xx or a transport error. */
  'dispatch_error',
  /** Provider dispatch exceeded the class timeout. */
  'dispatch_timeout',
  /** Daily provider-spend cap reached; the launch paused. */
  'cap_exhausted_utc_day',
  /** Rolling 30-day provider-spend cap reached; the launch paused. */
  'cap_exhausted_rolling_30d',
  /** Work was refused because the launch is paused. */
  'paused_rejected',
  /** Request rejected before any payment work. */
  'request_rejected',
] as const;

export type MetricName = (typeof METRIC_NAMES)[number];

const ALLOWED = new Set<string>(METRIC_NAMES);

export class LaunchMetrics {
  private readonly counters = new Map<MetricName, number>();

  increment(name: MetricName, amount = 1): void {
    if (!ALLOWED.has(name) || !Number.isSafeInteger(amount) || amount <= 0) return;
    this.counters.set(name, (this.counters.get(name) ?? 0) + amount);
  }

  snapshot(): Record<MetricName, number> {
    const snapshot = {} as Record<MetricName, number>;
    for (const name of METRIC_NAMES) snapshot[name] = this.counters.get(name) ?? 0;
    return snapshot;
  }
}
