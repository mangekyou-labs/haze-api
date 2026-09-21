/**
 * Fixed exchange lifecycle for the `zk-prepaid` client.
 *
 * An operator needs to know whether an exchange moved through the x402
 * handshake, and nothing else. Every value that leaves this module is a member
 * of a closed enum, a count, or a timestamp, so there is no field a request
 * body, URL, header, proof, public signal, nullifier, secret, or credential
 * identifier could travel in. Observers receive no exchange identity at all,
 * so two observations can never be joined into a spend-plane record.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export const ZK_PREPAID_LIFECYCLE_STAGES = [
  'challenge_received',
  'payment_prepared',
  'settlement_confirmed',
  'exchange_succeeded',
] as const;

export type ZkPrepaidLifecycleStage = (typeof ZK_PREPAID_LIFECYCLE_STAGES)[number];

/**
 * Fixed failure categories. `challenge_unreadable` and
 * `payment_preparation_failed` accompany a thrown error, so the caller sees
 * both the category and the original failure.
 */
export const ZK_PREPAID_LIFECYCLE_FAILURES = [
  'challenge_unreadable',
  'challenge_unsupported',
  'challenge_stale',
  'payment_preparation_failed',
  'payment_rejected',
  'settlement_failed',
  'transport_failed',
] as const;

export type ZkPrepaidLifecycleFailure = (typeof ZK_PREPAID_LIFECYCLE_FAILURES)[number];

export interface ZkPrepaidLifecycleStageEvent {
  readonly type: 'stage';
  readonly stage: ZkPrepaidLifecycleStage;
}

export interface ZkPrepaidLifecycleFailureEvent {
  readonly type: 'failure';
  readonly failure: ZkPrepaidLifecycleFailure;
}

export type ZkPrepaidLifecycleEvent = ZkPrepaidLifecycleStageEvent | ZkPrepaidLifecycleFailureEvent;

/** Receives one fixed-shape event per exchange transition. */
export type ZkPrepaidLifecycleObserver = (event: ZkPrepaidLifecycleEvent) => void;

export function lifecycleStage(stage: ZkPrepaidLifecycleStage): ZkPrepaidLifecycleStageEvent {
  return Object.freeze({ type: 'stage', stage });
}

export function lifecycleFailure(failure: ZkPrepaidLifecycleFailure): ZkPrepaidLifecycleFailureEvent {
  return Object.freeze({ type: 'failure', failure });
}

export interface ZkPrepaidLifecycleSnapshot {
  challengesReceived: number;
  paymentsPrepared: number;
  settlementsConfirmed: number;
  exchangeSuccesses: number;
  failures: number;
  failuresByCategory: Record<ZkPrepaidLifecycleFailure, number>;
  updatedAt: string;
}

export interface ZkPrepaidLifecycleMetrics {
  /** Usable directly as the client's `lifecycle` option. */
  observe: ZkPrepaidLifecycleObserver;
  snapshot(): ZkPrepaidLifecycleSnapshot;
}

export interface ZkPrepaidLifecycleMetricsOptions {
  now?: () => number;
}

type ZkPrepaidLifecycleCounters = Pick<
  ZkPrepaidLifecycleSnapshot,
  'challengesReceived' | 'paymentsPrepared' | 'settlementsConfirmed' | 'exchangeSuccesses' | 'failures'
>;

const STAGE_COUNTER = {
  challenge_received: 'challengesReceived',
  payment_prepared: 'paymentsPrepared',
  settlement_confirmed: 'settlementsConfirmed',
  exchange_succeeded: 'exchangeSuccesses',
} as const satisfies Record<ZkPrepaidLifecycleStage, keyof ZkPrepaidLifecycleCounters>;

function emptyFailures(): Record<ZkPrepaidLifecycleFailure, number> {
  return Object.fromEntries(
    ZK_PREPAID_LIFECYCLE_FAILURES.map((failure) => [failure, 0]),
  ) as Record<ZkPrepaidLifecycleFailure, number>;
}

/**
 * Counts exchange lifecycle transitions for one process. The snapshot holds
 * aggregate counters only: no per-exchange row, no ordering, no timing that
 * could distinguish two operators.
 */
export function createZkPrepaidLifecycleMetrics(
  options: ZkPrepaidLifecycleMetricsOptions = {},
): ZkPrepaidLifecycleMetrics {
  const now = options.now ?? Date.now;
  const counters: ZkPrepaidLifecycleCounters = {
    challengesReceived: 0,
    paymentsPrepared: 0,
    settlementsConfirmed: 0,
    exchangeSuccesses: 0,
    failures: 0,
  };
  const failuresByCategory = emptyFailures();
  let updatedAt = new Date(now()).toISOString();

  return {
    observe(event: ZkPrepaidLifecycleEvent): void {
      updatedAt = new Date(now()).toISOString();
      if (event.type === 'stage') {
        counters[STAGE_COUNTER[event.stage]] += 1;
        return;
      }
      counters.failures += 1;
      failuresByCategory[event.failure] += 1;
    },
    snapshot(): ZkPrepaidLifecycleSnapshot {
      return {
        challengesReceived: counters.challengesReceived,
        paymentsPrepared: counters.paymentsPrepared,
        settlementsConfirmed: counters.settlementsConfirmed,
        exchangeSuccesses: counters.exchangeSuccesses,
        failures: counters.failures,
        failuresByCategory: { ...failuresByCategory },
        updatedAt,
      };
    },
  };
}
