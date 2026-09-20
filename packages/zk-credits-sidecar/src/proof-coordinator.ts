/**
 * Local proof coordinator for the Base pilot.
 *
 * Every prove runs inside a terminable worker with a fixed deadline, one at a
 * time per process, then self-verifies locally against the pinned verification
 * key. Only a proof whose six public signals exactly match the canonical
 * `[root, timestamp, domain, requestSignal, nullifier, share]` order is
 * returned, so no payment can carry an unverified or reordered statement.
 *
 * A failed attempt keeps the caller's slot, request signal, nonce, response
 * key, and gateway `issuedAt` untouched: the same payment identity is retried
 * while more than one deadline remains in the gateway challenge window.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { fork, type ChildProcess } from 'node:child_process';
import {
  ArtifactBundleError,
  loadCircuitManifest,
  resolvePinnedArtifactBundle,
  type CircuitManifest,
  type PinnedArtifactBundle,
} from './artifact-bundle.js';
import {
  createBaseProofMetrics,
  type BaseProofFailureCategory,
  type BaseProofMetrics,
} from './proof-metrics.js';
import type {
  BaseProofContext,
  BaseProofGenerator,
  BaseProofInput,
  BaseProofResult,
} from './base-sidecar.js';
import type { ProofWorkerRequest, ProofWorkerResult } from './proof-child.js';

export const PUBLIC_SIGNAL_COUNT = 6;
export const DEFAULT_PROVE_TIMEOUT_MS = 10_000;

export interface ProofWorkerHandle {
  result: Promise<ProofWorkerResult>;
  terminate(): Promise<void>;
}

export type ProofWorkerFactory = (request: ProofWorkerRequest) => ProofWorkerHandle;

export class ProofCoordinatorError extends Error {
  constructor(
    readonly category: BaseProofFailureCategory,
    message: string,
  ) {
    super(message);
    this.name = 'ProofCoordinatorError';
  }
}

export interface PinnedBaseProofGeneratorOptions {
  artifactDirectory: string;
  timeoutMs?: number;
  metrics?: BaseProofMetrics;
  manifest?: CircuitManifest;
  manifestPath?: string;
  /**
   * Compiled prover worker entry. Defaults to the `proof-child.js` emitted
   * next to this module; embedded runtimes and the opt-in artifact test point
   * at the built file explicitly.
   */
  proverPath?: URL;
  /** Injection point for deterministic tests and embedded runtimes. */
  workerFactory?: ProofWorkerFactory;
  verifyProof?: (
    verificationKey: unknown,
    publicSignals: string[],
    proof: Record<string, unknown>,
  ) => Promise<boolean>;
  now?: () => number;
}

function proverProcessFactory(proverPath: URL): ProofWorkerFactory {
  return (request) => {
    // The worker owns its own process: never inherit the parent's loader or
    // input flags, which would change how the compiled worker is parsed.
    const child: ChildProcess = fork(proverPath, [], {
      execArgv: [],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const result = new Promise<ProofWorkerResult>((resolve, reject) => {
      child.once('message', (message: unknown) => resolve(message as ProofWorkerResult));
      child.once('error', (error: Error) => reject(error));
      child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
        if (code !== 0 && signal === null) reject(new Error(`proof_worker_exited:${code ?? 'signal'}`));
      });
    });
    // The race may settle first; keep the loser observed so it never surfaces as
    // an unhandled rejection after termination.
    result.catch(() => undefined);
    child.send(request);
    return {
      result,
      terminate: async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) resolve();
          else child.once('exit', () => resolve());
        });
      },
    };
  };
}

async function defaultVerifyProof(
  verificationKey: unknown,
  publicSignals: string[],
  proof: Record<string, unknown>,
): Promise<boolean> {
  const module = await import('snarkjs') as unknown as {
    groth16?: {
      verify(verificationKey: unknown, publicSignals: string[], proof: Record<string, unknown>): Promise<boolean>;
    };
  };
  if (!module.groth16?.verify) throw new ProofCoordinatorError('prover_unavailable', 'snarkjs Groth16 verifier is unavailable');
  return module.groth16.verify(verificationKey, publicSignals, proof);
}

class ProofTimeoutError extends Error {
  constructor() {
    super('Proof attempt exceeded the local prove deadline');
    this.name = 'ProofTimeoutError';
  }
}

function failureCategory(error: unknown): BaseProofFailureCategory {
  if (error instanceof ProofTimeoutError) return 'timeout';
  if (error instanceof ProofCoordinatorError) return error.category;
  return 'worker_error';
}

/** Exactly the canonical six field-encoded signals, in order. */
export function signalsMatchPublicOrder(actual: unknown, expected: readonly string[]): actual is string[] {
  if (expected.length !== PUBLIC_SIGNAL_COUNT) return false;
  if (!Array.isArray(actual) || actual.length !== PUBLIC_SIGNAL_COUNT) return false;
  return actual.every((value, index) => typeof value === 'string' && value === expected[index]);
}

function expectedSignals(context: BaseProofContext): readonly string[] {
  const expected = context.expectedPublicSignals;
  if (!Array.isArray(expected) || expected.length !== PUBLIC_SIGNAL_COUNT || !expected.every((value) => typeof value === 'string')) {
    throw new Error('The proof context must carry the six expected public signals');
  }
  return expected;
}

function challengeDeadline(context: BaseProofContext): number {
  const issuedAt = context.requirements.extra.issuedAt;
  const windowSeconds = Number.isSafeInteger(context.requirements.maxTimeoutSeconds) && context.requirements.maxTimeoutSeconds > 0
    ? context.requirements.maxTimeoutSeconds
    : 300;
  return (issuedAt + windowSeconds) * 1000;
}

const RETRYABLE_FAILURES: ReadonlySet<BaseProofFailureCategory> = new Set([
  'timeout',
  'worker_error',
  'prover_unavailable',
]);

// One fullProve at a time per sidecar process, across every generator instance.
let proveChain: Promise<unknown> = Promise.resolve();

function serializeProve<T>(task: () => Promise<T>): Promise<T> {
  const run = proveChain.then(task, task);
  proveChain = run.then(() => undefined, () => undefined);
  return run;
}

const NO_METRICS = createBaseProofMetrics();

/**
 * Builds the sidecar's only proving boundary: pinned local artifacts, one
 * serialized terminable prove at a time, and mandatory local self-verification.
 */
export async function createPinnedBaseProofGenerator(
  options: PinnedBaseProofGeneratorOptions,
): Promise<BaseProofGenerator> {
  const timeoutMs = Number.isFinite(options.timeoutMs) && (options.timeoutMs ?? 0) > 0
    ? Math.floor(options.timeoutMs!)
    : DEFAULT_PROVE_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const metrics = options.metrics ?? NO_METRICS;
  const workerFactory = options.workerFactory
    ?? proverProcessFactory(options.proverPath ?? new URL('./proof-child.js', import.meta.url));
  const verifyProof = options.verifyProof ?? defaultVerifyProof;

  let bundle: PinnedArtifactBundle;
  try {
    const manifest = options.manifest ?? await loadCircuitManifest(options.manifestPath);
    bundle = await resolvePinnedArtifactBundle({
      artifactDirectory: options.artifactDirectory,
      manifest,
      expectedPublicSignals: PUBLIC_SIGNAL_COUNT,
    });
  } catch (error) {
    if (error instanceof ArtifactBundleError) {
      metrics.recordAttempt({ outcome: 'failure', durationMs: 0, category: error.category });
    }
    throw error;
  }

  const runAttempt = async (input: BaseProofInput): Promise<ProofWorkerResult> => serializeProve(async () => {
    const handle = workerFactory({ input: input as unknown as Record<string, unknown>, wasmPath: bundle.wasmPath, zkeyPath: bundle.zkeyPath });
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new ProofTimeoutError()), timeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([handle.result, deadline]);
    } finally {
      clearTimeout(timer);
      await handle.terminate();
    }
  });

  return async (input: BaseProofInput, context: BaseProofContext): Promise<BaseProofResult> => {
    const expected = expectedSignals(context);
    const windowEnd = challengeDeadline(context);
    let lastFailure: ProofCoordinatorError | undefined;

    for (;;) {
      if (windowEnd - now() <= timeoutMs) {
        const category: BaseProofFailureCategory = 'deadline_exhausted';
        if (!lastFailure) {
          metrics.recordAttempt({ outcome: 'failure', durationMs: 0, category });
          throw new ProofCoordinatorError(category, 'Gateway challenge is too stale for another local prove');
        }
        throw lastFailure;
      }
      if (lastFailure) metrics.recordRetry();

      const started = now();
      let failure: ProofCoordinatorError | undefined;
      let result: BaseProofResult | undefined;
      try {
        const workerResult = await runAttempt(input);
        const { proof, publicSignals } = workerResult;
        if (proof === undefined || typeof proof !== 'object' || Array.isArray(proof)) {
          failure = new ProofCoordinatorError('worker_error', 'Proof worker returned no proof');
        } else if (!signalsMatchPublicOrder(publicSignals, expected)) {
          failure = new ProofCoordinatorError('signal_mismatch', 'Proof public signals do not match the canonical statement');
        } else if (!await verifyProof(bundle.verificationKey, publicSignals, proof)) {
          failure = new ProofCoordinatorError('self_verify_failed', 'Local self-verification rejected the proof');
        } else {
          result = { proof, publicSignals };
        }
      } catch (error) {
        failure = error instanceof ProofCoordinatorError
          ? error
          : new ProofCoordinatorError(failureCategory(error), error instanceof Error ? error.message : 'Local prove failed');
      }

      const durationMs = Math.max(0, now() - started);
      if (result) {
        metrics.recordAttempt({ outcome: 'success', durationMs });
        return result;
      }
      metrics.recordAttempt({ outcome: 'failure', durationMs, category: failure!.category });
      lastFailure = failure!;
      if (!RETRYABLE_FAILURES.has(failure!.category)) throw failure!;
    }
  };
}
