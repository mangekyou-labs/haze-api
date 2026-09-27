/** Owns the verified claim through reservation, dispatch, and durable commit. */
import {
  ClaimCommitAmbiguousError,
  isClaimLifecycleConflict,
  type ClaimLifecycle,
  type ClaimRecord,
  type PaymentPayload,
} from '@zk-credits/x402-zk-prepaid';
import { claimFence, claimStoreErrorCode } from './claim-store.js';
import { encryptResponseReplay, MAX_ENCRYPTED_REPLAY_BYTES, MAX_REPLAY_BYTES } from './response-replay.js';
import { MAX_DISPATCH_COST_MICRO_USD, type NormalizedServiceClassRequest } from './service-class.js';
import type { ProviderAdapter } from './providerAdapter.js';
import type { LaunchControl } from './launch-control.js';
import type { LaunchMetrics } from './metrics.js';

export interface BufferedResponse {
  status: number;
  contentType: string;
  body: Uint8Array;
}

export type ClaimCompletionResult =
  | { kind: 'response'; response: BufferedResponse }
  | { kind: 'payment_required'; reason: 'conflicting_signal' | 'dispatch_budget_exhausted' | 'reservation_cancelled' }
  | { kind: 'committed'; encryptedReplay: string | null }
  | { kind: 'in_progress'; code: 'claim_commit_ambiguous' | 'claim_in_progress' };

export class ClaimCompletionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ClaimCompletionError';
  }
}

interface Options {
  lifecycle: ClaimLifecycle;
  provider: ProviderAdapter;
  providerConfigured: boolean;
  providerAuth: string;
  providerTimeoutMs: number;
  now: () => number;
  launchControl?: LaunchControl;
  metrics?: LaunchMetrics;
}

interface Input {
  payment: PaymentPayload;
  nullifier: string;
  signalHash: string;
  request: NormalizedServiceClassRequest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function claimCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const code = claimStoreErrorCode(error);
    if (error instanceof ClaimCommitAmbiguousError) throw new ClaimCompletionError('claim_commit_ambiguous', 503);
    if (isClaimLifecycleConflict(code)) throw new ClaimCompletionError(code, 409);
    throw new ClaimCompletionError('claim_store_unavailable', 503);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ClaimCompletionError('provider_timeout', 502)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

async function bufferResponse(response: Response): Promise<BufferedResponse> {
  const reader = response.body?.getReader();
  if (!reader) throw new ClaimCompletionError('provider_empty_response', 502);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_REPLAY_BYTES) throw new ClaimCompletionError('provider_response_too_large', 502);
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new ClaimCompletionError('provider_empty_response', 502);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const contentType = response.headers.get('content-type') ?? 'application/json; charset=utf-8';
  const normalizedContentType = contentType.split(';', 1)[0]!.trim().toLowerCase();
  if (normalizedContentType === 'application/json' || normalizedContentType.endsWith('+json')) {
    try {
      if (!isRecord(JSON.parse(new TextDecoder().decode(body)) as unknown)) throw new Error('provider_response_shape');
    } catch {
      throw new ClaimCompletionError('provider_response_malformed', 502);
    }
  }
  return { status: response.status, contentType, body };
}

/** The only entry point after proof verification. Exact retries share one operation. */
export function createClaimCompletion(options: Options) {
  const { lifecycle, provider, now, launchControl, metrics } = options;
  const inFlight = new Map<string, Promise<BufferedResponse>>();

  async function dispatch(record: ClaimRecord, input: Input): Promise<BufferedResponse> {
    let readyStaged = false;
    let dispatched = false;
    let debitId: string | undefined;
    const fence = claimFence(record);
    try {
      if (!options.providerConfigured) throw new ClaimCompletionError('provider_not_configured', 503);
      const dispatchRecord = await claimCall(() => lifecycle.beginDispatch(record, now()));
      if (launchControl) {
        let admission;
        try {
          admission = await launchControl.beginDispatch(MAX_DISPATCH_COST_MICRO_USD);
        } catch {
          throw new ClaimCompletionError('launch_control_unavailable', 503);
        }
        if (admission.kind === 'paused') throw new ClaimCompletionError('pilot_paused', 503);
        if (admission.kind === 'cap_exhausted') {
          metrics?.increment(admission.window === 'utc_day' ? 'cap_exhausted_utc_day' : 'cap_exhausted_rolling_30d');
          throw new ClaimCompletionError('provider_spend_cap_exhausted', 503);
        }
        debitId = admission.debitId;
      }

      let upstream: Response;
      try {
        const request = provider.forwardRequest(input.request, options.providerAuth, 'chat.completions');
        dispatched = true;
        upstream = await withTimeout(request, options.providerTimeoutMs);
      } catch (error) {
        throw error instanceof ClaimCompletionError ? error : new ClaimCompletionError('provider_request_failed', 502);
      }
      if (upstream.status < 200 || upstream.status >= 300) throw new ClaimCompletionError('provider_non_2xx', 502);
      const buffered = await bufferResponse(upstream);
      const encryptedReplay = encryptResponseReplay(input.payment.payload.responseKey, buffered.body, {
        contentType: buffered.contentType,
        status: buffered.status,
        now: now(),
      });
      if (!encryptedReplay || Buffer.byteLength(encryptedReplay, 'utf8') > MAX_ENCRYPTED_REPLAY_BYTES) {
        throw new ClaimCompletionError('provider_replay_unavailable', 502);
      }
      const readyRecord = await claimCall(() => lifecycle.stageReady(dispatchRecord, encryptedReplay, now()));
      readyStaged = true;
      await claimCall(() => lifecycle.commit(readyRecord, now()));
      metrics?.increment('claim_committed');
      metrics?.increment('dispatch_ok');
      return buffered;
    } catch (error) {
      if (error instanceof ClaimCompletionError && error.message === 'provider_timeout') metrics?.increment('dispatch_timeout');
      else if (dispatched) metrics?.increment('dispatch_error');
      if (!readyStaged) {
        try {
          if (await lifecycle.cancelIfReserved(input.nullifier, input.signalHash, fence)) metrics?.increment('claim_cancelled');
        } catch {
          // A persistence failure must never cancel with a stale fence.
        }
      }
      throw error;
    } finally {
      if (debitId && launchControl) {
        try {
          if (dispatched) await launchControl.retain(debitId);
          else await launchControl.release(debitId);
        } catch {
          // A held debit still counts toward the cap.
        }
      }
    }
  }

  return {
    async complete(input: Input): Promise<ClaimCompletionResult> {
      let reservation: Awaited<ReturnType<ClaimLifecycle['reserve']>>;
      try {
        reservation = await lifecycle.reserve(input.nullifier, input.signalHash, now());
      } catch (error) {
        if (claimStoreErrorCode(error) === 'conflicting_signal') {
          metrics?.increment('claim_conflict');
          return { kind: 'payment_required', reason: 'conflicting_signal' };
        }
        throw new ClaimCompletionError('claim_store_unavailable', 503);
      }
      metrics?.increment(reservation.kind === 'existing' ? 'reservation_existing' : 'reservation_new');
      const key = `${input.nullifier}:${input.signalHash}`;
      if (reservation.kind === 'existing') {
        const active = inFlight.get(key);
        if (active) return { kind: 'response', response: await active };
        const disposition = lifecycle.classify(reservation.record);
        if (disposition.kind === 'cancelled') {
          return { kind: 'payment_required', reason: disposition.retryAllowed ? 'reservation_cancelled' : 'dispatch_budget_exhausted' };
        }
        if (disposition.kind === 'committed') {
          metrics?.increment('claim_replayed');
          return { kind: 'committed', encryptedReplay: disposition.replayAvailable ? (reservation.record.encryptedReplay ?? null) : null };
        }
        return { kind: 'in_progress', code: disposition.kind === 'ambiguous_commit' ? 'claim_commit_ambiguous' : 'claim_in_progress' };
      }
      const operation = dispatch(reservation.record, input);
      inFlight.set(key, operation);
      try {
        return { kind: 'response', response: await operation };
      } finally {
        if (inFlight.get(key) === operation) inFlight.delete(key);
      }
    },
  };
}
