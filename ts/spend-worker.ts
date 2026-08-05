// Per-call async on-chain spend() worker (M2.6).
//
// Drains the durable settlement queue (accepted calls pending on-chain spend)
// and submits each RLN proof to the contract's spend(). Idempotent across
// restarts: the queue lives in `gateway.accepted_calls` (proof + pub signals
// persisted), so a crash between submissions resumes from durable rows. When
// the contract reports NullifierAlreadySpent (e.g. a prior submission landed
// but the response was lost, or another actor spent it), the call is marked
// spent rather than retried forever.

import type { AcceptedCall, GatewayStore } from './db/index.js';

/** Thrown when the contract says the nullifier is already spent. */
export class NullifierAlreadySpentError extends Error {
  constructor(message = 'NullifierAlreadySpent') {
    super(message);
    this.name = 'NullifierAlreadySpentError';
  }
}

export type SpendSubmitter = (
  spenderSecretKey: string,
  proof: object,
  pubSignals: string[],
) => Promise<string>;

export interface SpendWorkerDeps {
  store: GatewayStore;
  secretKey: string;
  submitSpend: SpendSubmitter;
  /** Called after each drain pass; used to schedule the next tick. */
  onTick?: (processed: number) => void;
}

export function isNullifierAlreadySpent(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /NullifierAlreadySpent|Transaction failed|already been spent/i.test(message);
}

/**
 * Drain the pending settlement queue once. Returns the number of calls
 * settled. Failure to submit a call (network error, etc.) leaves it pending
 * for the next pass; only a definitive NullifierAlreadySpent marks it spent.
 */
export async function drainSpendQueue(deps: SpendWorkerDeps): Promise<number> {
  const pending = await deps.store.listAcceptedCalls({ onlyPendingSpend: true });
  let settled = 0;

  for (const call of pending) {
    if (!call.proof || !call.pubSignals) {
      // No proof data persisted (e.g. a pre-M2.6 row) — cannot submit on-chain.
      // Leave it pending but log; do not block the queue.
      console.warn(`[spend] accepted call ${call.proofHash} has no persisted proof; skipping`);
      continue;
    }
    try {
      const txHash = await deps.submitSpend(deps.secretKey, call.proof, call.pubSignals);
      await deps.store.markSpendResult(call.proofHash, txHash);
      settled++;
    } catch (err: unknown) {
      if (isNullifierAlreadySpent(err)) {
        // Already settled on-chain (durable replay guard) — mark spent so we
        // don't retry forever.
        await deps.store.markSpendResult(call.proofHash, 'already-spent');
        settled++;
      } else {
        console.error(`[spend] submit failed for ${call.proofHash}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  deps.onTick?.(settled);
  return settled;
}

/**
 * Start a persistent spend worker that drains the queue on an interval and
 * returns a stop() handle. Polling is used (no socket) so it works on any
 * host; the interval is configurable for tests.
 */
export function startSpendWorker(
  deps: SpendWorkerDeps,
  intervalMs: number,
): { stop: () => void } {
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await drainSpendQueue(deps);
    } catch (err: unknown) {
      console.error('[spend] drain error:', err instanceof Error ? err.message : String(err));
    } finally {
      running = false;
      if (timer) timer = setTimeout(tick, intervalMs);
    }
  };

  // Kick off after the first interval (let the gateway finish booting).
  timer = setTimeout(tick, intervalMs);

  return {
    stop: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export type { AcceptedCall };