/**
 * Aggregate, privacy-safe proof metrics for the loopback `GET /metrics`
 * snapshot.
 *
 * Only attempt counts, fixed failure categories, and hot-prove percentiles
 * leave this module. Proofs, public signals, nullifiers, credentials,
 * requests, and any identifying label are never recorded here.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export const BASE_PROOF_FAILURE_CATEGORIES = [
  'artifact_missing',
  'artifact_remote',
  'artifact_escaped',
  'artifact_hash_mismatch',
  'artifact_manifest_malformed',
  'prover_unavailable',
  'worker_error',
  'timeout',
  'signal_mismatch',
  'self_verify_failed',
  'deadline_exhausted',
] as const;

export type BaseProofFailureCategory = (typeof BASE_PROOF_FAILURE_CATEGORIES)[number];

export interface BaseProofMetricsSnapshot {
  attempts: number;
  successes: number;
  failures: number;
  retries: number;
  failuresByCategory: Record<BaseProofFailureCategory, number>;
  /**
   * Warm prove latency. The first prove in a process compiles the WASM and is
   * recorded as the cold sample; percentiles cover the hot samples that
   * followed it.
   */
  hotProve: {
    samples: number;
    p50Ms: number | null;
    p95Ms: number | null;
  };
  updatedAt: string;
}

export interface BaseProofAttemptRecord {
  outcome: 'success' | 'failure';
  durationMs: number;
  category?: BaseProofFailureCategory;
}

export interface BaseProofMetrics {
  recordAttempt(record: BaseProofAttemptRecord): void;
  recordRetry(): void;
  snapshot(): BaseProofMetricsSnapshot;
}

export interface BaseProofMetricsOptions {
  now?: () => number;
  /** Hot samples retained for the percentiles. */
  hotWindow?: number;
}

const DEFAULT_HOT_WINDOW = 100;

function emptyCategories(): Record<BaseProofFailureCategory, number> {
  return Object.fromEntries(
    BASE_PROOF_FAILURE_CATEGORIES.map((category) => [category, 0]),
  ) as Record<BaseProofFailureCategory, number>;
}

function percentile(samples: readonly number[], fraction: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return Math.round(sorted[index]! * 100) / 100;
}

/** Records aggregate outcomes for one sidecar process. */
export function createBaseProofMetrics(options: BaseProofMetricsOptions = {}): BaseProofMetrics {
  const now = options.now ?? Date.now;
  const hotWindow = Number.isSafeInteger(options.hotWindow) && (options.hotWindow ?? 0) > 0
    ? options.hotWindow!
    : DEFAULT_HOT_WINDOW;
  const failuresByCategory = emptyCategories();
  const hotSamples: number[] = [];
  let attempts = 0;
  let successes = 0;
  let failures = 0;
  let retries = 0;
  let coldRecorded = false;
  let updatedAt = new Date(now()).toISOString();

  return {
    recordAttempt(record: BaseProofAttemptRecord): void {
      attempts += 1;
      updatedAt = new Date(now()).toISOString();
      if (record.outcome === 'success') successes += 1;
      else {
        failures += 1;
        if (record.category) failuresByCategory[record.category] += 1;
      }
      const duration = Number.isFinite(record.durationMs) && record.durationMs >= 0 ? record.durationMs : 0;
      if (!coldRecorded) {
        coldRecorded = true;
        return;
      }
      hotSamples.push(duration);
      while (hotSamples.length > hotWindow) hotSamples.shift();
    },
    recordRetry(): void {
      retries += 1;
      updatedAt = new Date(now()).toISOString();
    },
    snapshot(): BaseProofMetricsSnapshot {
      return {
        attempts,
        successes,
        failures,
        retries,
        failuresByCategory: { ...failuresByCategory },
        hotProve: {
          samples: hotSamples.length,
          p50Ms: percentile(hotSamples, 0.5),
          p95Ms: percentile(hotSamples, 0.95),
        },
        updatedAt,
      };
    },
  };
}
