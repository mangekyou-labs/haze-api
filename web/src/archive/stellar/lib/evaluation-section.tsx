'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  analyticsEnabled,
  enableAnalytics,
  resetAnalytics,
  trackEvaluationEvent,
  trackSurveySent,
} from '@/lib/analytics';
import { EVALUATION_CONSENT_VERSION } from '@/lib/evaluation-contract';

interface EvaluationStatus {
  participantCode: string;
  consentVersion: string;
  enrolledAt: string;
  retentionDeadline: string;
  wallet: { verified: boolean; addressRedacted: string | null };
  deposit: {
    confirmed: boolean;
    transactionHash: string | null;
    explorerUrl: string | null;
    newRoot: string | null;
  };
  feedbackSubmitted: boolean;
  complete: boolean;
}

interface Challenge {
  id: string;
  message: string;
  expiresAt: string;
}

type FreighterApi = {
  getNetwork?: () => Promise<unknown>;
  getNetworkDetails?: () => Promise<unknown>;
  getPublicKey?: () => Promise<string>;
  signMessage?: (message: string, options?: Record<string, unknown>) => Promise<unknown>;
};

declare global {
  interface Window {
    freighterApi?: FreighterApi;
  }
}

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
const INITIAL_FEEDBACK = {
  easeRating: 0,
  taskCompleted: false,
  wouldUseAgain: false,
  mostValuableAspect: '',
  biggestFriction: '',
  quoteConsent: false,
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

function readCommitmentFromBrowser(): Promise<string | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open('zk-credits-crypto', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('keys')) request.result.createObjectStore('keys');
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('keys')) {
        db.close();
        resolve(null);
        return;
      }
      const transaction = db.transaction('keys', 'readonly');
      const lookup = transaction.objectStore('keys').get('commitment');
      lookup.onsuccess = () => {
        db.close();
        resolve(typeof lookup.result === 'string' ? lookup.result : null);
      };
      lookup.onerror = () => {
        db.close();
        resolve(null);
      };
    };
    request.onerror = () => resolve(null);
  });
}

function normalizeSignature(value: unknown): string | null {
  const candidate = typeof value === 'object' && value !== null
    ? (value as { signedMessage?: unknown; signature?: unknown }).signedMessage
      ?? (value as { signedMessage?: unknown; signature?: unknown }).signature
    : value;

  if (typeof candidate === 'string') {
    if (/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(candidate)) {
      return candidate;
    }
    if (/^[a-f0-9]{128}$/i.test(candidate)) {
      const bytes = new Uint8Array(candidate.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)));
      return bytesToBase64(bytes);
    }
    return null;
  }
  if (candidate instanceof Uint8Array) return bytesToBase64(candidate);
  if (Array.isArray(candidate)) return bytesToBase64(new Uint8Array(candidate as number[]));
  return null;
}

function isTestnetNetwork(value: unknown): boolean {
  const text = typeof value === 'string' ? value.toLowerCase() : JSON.stringify(value ?? '').toLowerCase();
  return text.includes('testnet') || text.includes('test sdf') || text.includes('sdf network');
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(90_000),
  });
  const payload = await response.json().catch(() => ({ error: 'invalid_response' }));
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : 'request_failed');
  }
  return payload as T;
}

function safeErrorMessage(code: string, fallback: string): string {
  const messages: Record<string, string> = {
    unauthorized: 'Your session expired. Sign in again to continue.',
    server_misconfigured: 'Evaluation is not configured on this deployment yet.',
    gateway_unreachable: 'The evaluation gateway is waking up. Retry in a moment.',
    not_enrolled: 'Enroll in the evaluation before continuing.',
    already_enrolled: 'This session is already enrolled.',
    rate_limited: 'Too many wallet challenges. Wait a few minutes, then retry.',
    challenge_expired: 'That wallet challenge expired. Request a fresh one.',
    challenge_replayed: 'That wallet challenge was already used. Request a fresh one.',
    wallet_proof_invalid: 'Wallet signing was rejected or could not be verified.',
    wallet_already_used: 'That wallet is already associated with another participant.',
    commitment_required: 'Generate an API key first so the test deposit has a browser-held commitment.',
    enrollment_required: 'Enroll first, then start the test checkout.',
    evaluation_requires_stripe_test_mode: 'The evaluation checkout is available only with Stripe test mode.',
    stripe_not_configured: 'Stripe checkout is not configured on this deployment.',
    checkout_url_missing: 'Checkout did not return a redirect URL. Retry in a moment.',
    receipt_not_found: 'The checkout receipt is not available for this participant.',
    feedback_not_ready: 'Complete the wallet and test deposit steps before sending feedback.',
  };
  return messages[code] ?? fallback;
}

function evaluationStep(status: EvaluationStatus | null): number {
  if (!status) return 0;
  if (!status.wallet.verified) return 1;
  if (!status.deposit.confirmed) return 2;
  if (!status.feedbackSubmitted) return 3;
  return 4;
}

const PROGRESS_STEPS = [
  ['Consent', 'Join voluntarily'],
  ['Wallet', 'Freighter testnet proof'],
  ['Payment', '$1 test checkout'],
  ['Feedback', 'Six fixed fields'],
] as const;

export function EvaluationSection() {
  const [status, setStatus] = useState<EvaluationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [analyticsConsent, setAnalyticsConsent] = useState(() => analyticsEnabled());
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [walletState, setWalletState] = useState<'idle' | 'install' | 'wrong-network' | 'rejected' | 'expired'>('idle');
  const [feedback, setFeedback] = useState(INITIAL_FEEDBACK);
  const [commitment, setCommitment] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/evaluation/status', {
        signal: AbortSignal.timeout(90_000),
        cache: 'no-store',
      });
      if (response.status === 404) {
        setStatus(null);
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'evaluation_unavailable');
      setStatus(payload as EvaluationStatus);
      setError(null);
    } catch (requestError) {
      const code = requestError instanceof Error ? requestError.message : 'evaluation_unavailable';
      if (code !== 'not_enrolled') {
        setError(safeErrorMessage(code, 'Evaluation service is waking up. Retry in a moment.'));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    queueMicrotask(() => {
      if (!stopped) void refreshStatus();
    });
    void readCommitmentFromBrowser().then((value) => {
      if (!stopped) setCommitment(value);
    });

    const optedIn = analyticsEnabled();
    if (optedIn) {
      // Restore a prior explicit choice only after the server returns this
      // session's opaque public code. Analytics must never identify a user by
      // email, provider subject, wallet, prompt, commitment, or signature.
      void jsonRequest<{ participantCode: string }>('/api/evaluation/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optIn: true }),
      }).then(({ participantCode }) => {
        if (!stopped) enableAnalytics(participantCode);
      }).catch((requestError) => {
        if (!stopped && requestError instanceof Error && requestError.message === 'unauthorized') {
          resetAnalytics();
          setAnalyticsConsent(false);
        }
      });
    }
    return () => {
      stopped = true;
    };
  }, [refreshStatus]);

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get('session_id');
    if (!sessionId) return;
    let stopped = false;

    const reconcileCheckout = async () => {
      trackEvaluationEvent('checkout_returned', { status: 'received' });
      for (const delayMs of [0, 1_000, 2_000, 4_000]) {
        if (delayMs > 0) await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        if (stopped) return;
        try {
          const receipt = await jsonRequest<{
            processingStatus?: string;
            transactionHash?: string | null;
          }>(`/api/checkout/receipt?session_id=${encodeURIComponent(sessionId)}`);
          if (receipt.processingStatus === 'confirmed' && receipt.transactionHash) {
            trackEvaluationEvent('deposit_confirmed', { status: 'confirmed', outcome: 'success' });
            setNotice('Checkout confirmed; the Stellar testnet deposit is recorded.');
            await refreshStatus();
            return;
          }
          if (receipt.processingStatus === 'failed') {
            setError('Checkout was received but the testnet deposit failed. Retry the checkout.');
            return;
          }
        } catch {
          // The Stripe webhook and free gateway may still be waking up.
        }
      }
      if (!stopped) {
        setNotice('Checkout received. The free gateway may be waking up; retry status in a moment.');
        await refreshStatus();
      }
    };

    void reconcileCheckout();
    return () => {
      stopped = true;
    };
  }, [refreshStatus]);

  const doEnrollment = async () => {
    if (!consent) return;
    setBusy('enroll');
    setError(null);
    setNotice(null);
    trackEvaluationEvent('evaluation_enrollment_started');
    try {
      await jsonRequest<{ participantCode: string }>('/api/evaluation/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consentVersion: EVALUATION_CONSENT_VERSION }),
      });
      await refreshStatus();
      setNotice('You are enrolled. Wallet proof and feedback are retained for 90 days, then raw proof is removed.');
      trackEvaluationEvent('evaluation_enrollment_completed');
    } catch (requestError) {
      const code = requestError instanceof Error ? requestError.message : 'enrollment_failed';
      setError(safeErrorMessage(code, 'Enrollment could not be completed. Retry in a moment.'));
    } finally {
      setBusy(null);
    }
  };

  const verifyWallet = async () => {
    const freighter = window.freighterApi;
    if (!freighter?.signMessage || !freighter.getPublicKey) {
      setWalletState('install');
      return;
    }

    setBusy('wallet');
    setError(null);
    setNotice(null);
    const startedAt = performance.now();
    try {
      const networkDetails = freighter.getNetworkDetails
        ? await freighter.getNetworkDetails()
        : freighter.getNetwork ? await freighter.getNetwork() : null;
      if (networkDetails && !isTestnetNetwork(networkDetails)) {
        setWalletState('wrong-network');
        return;
      }

      const nextChallenge = await jsonRequest<Challenge>('/api/evaluation/challenge', { method: 'POST' });
      setChallenge(nextChallenge);
      trackEvaluationEvent('wallet_challenge_requested', { durationMs: performance.now() - startedAt });
      const address = await freighter.getPublicKey();
      trackEvaluationEvent('wallet_proof_started');
      const signed = await freighter.signMessage(nextChallenge.message, {
        address,
        networkPassphrase: TESTNET_PASSPHRASE,
      });
      const signature = normalizeSignature(signed);
      if (!signature) throw new Error('wallet_signature_format');

      const result = await jsonRequest<{ verified: boolean }>('/api/evaluation/wallet-proof', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: nextChallenge.id,
          address,
          signature,
          network: 'testnet',
        }),
      });
      if (!result.verified) throw new Error('wallet_proof_invalid');
      setWalletState('idle');
      setChallenge(null);
      setNotice('Wallet verified on Stellar testnet.');
      trackEvaluationEvent('wallet_proof_completed', {
        durationMs: performance.now() - startedAt,
        outcome: 'success',
      });
      await refreshStatus();
    } catch (requestError) {
      const code = requestError instanceof Error ? requestError.message : 'wallet_proof_failed';
      setWalletState(code === 'challenge_expired' ? 'expired' : 'rejected');
      setError(safeErrorMessage(code, 'Wallet signing was rejected or could not be verified. Retry when ready.'));
      trackEvaluationEvent('wallet_proof_rejected', { errorCode: code, outcome: 'failure' });
    } finally {
      setBusy(null);
    }
  };

  const beginCheckout = async () => {
    setBusy('checkout');
    setError(null);
    setNotice(null);
    trackEvaluationEvent('checkout_started');
    try {
      const localCommitment = commitment ?? await readCommitmentFromBrowser();
      if (!localCommitment) throw new Error('commitment_required');
      setCommitment(localCommitment);

      const result = await jsonRequest<{ url?: string }>('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: 'evaluation', commitment: localCommitment }),
      });
      if (!result.url) throw new Error('checkout_url_missing');
      window.location.assign(result.url);
    } catch (requestError) {
      const code = requestError instanceof Error ? requestError.message : 'checkout_failed';
      setError(safeErrorMessage(code, 'Checkout is unavailable while the gateway wakes up. Retry in a moment.'));
    } finally {
      setBusy(null);
    }
  };

  const submitFeedback = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy('feedback');
    setError(null);
    try {
      const nextStatus = await jsonRequest<EvaluationStatus>('/api/evaluation/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(feedback),
      });
      setStatus(nextStatus);
      setNotice('Thank you — your feedback was recorded.');
      trackSurveySent({
        easeRating: feedback.easeRating,
        taskCompleted: feedback.taskCompleted,
        wouldUseAgain: feedback.wouldUseAgain,
      });
    } catch (requestError) {
      const code = requestError instanceof Error ? requestError.message : 'feedback_failed';
      setError(safeErrorMessage(code, 'Feedback could not be saved. Retry in a moment.'));
    } finally {
      setBusy(null);
    }
  };

  const toggleAnalytics = async (enabled: boolean) => {
    setAnalyticsConsent(enabled);
    if (!enabled) {
      resetAnalytics();
      return;
    }
    try {
      const result = await jsonRequest<{ participantCode: string }>('/api/evaluation/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optIn: true }),
      });
      enableAnalytics(result.participantCode);
    } catch {
      setAnalyticsConsent(false);
      setError('Analytics opt-in could not be enabled. The evaluation still works without analytics.');
    }
  };

  const currentStep = evaluationStep(status);
  const canFeedback = Boolean(status?.wallet.verified && status.deposit.confirmed);
  const retentionDate = useMemo(
    () => status ? new Date(status.retentionDeadline).toLocaleDateString() : null,
    [status],
  );

  if (loading) {
    return (
      <section
        className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6"
        aria-busy="true"
        aria-label="Loading Level 4 evaluation"
      >
        <div className="h-5 w-48 rounded bg-zinc-800" />
        <div className="mt-3 h-4 w-full max-w-xl rounded bg-zinc-800/80" />
        <div className="mt-6 h-10 w-full rounded bg-zinc-800/60" />
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6" aria-labelledby="evaluation-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-300">Level 4 evaluation</p>
          <h2 id="evaluation-title" className="mt-2 text-xl font-semibold tracking-tight text-zinc-100">
            Help validate the Stellar testnet flow
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Optional, consent-based testing for the launch dashboard. We keep restricted evaluation records for 90 days;
            private prompts, API calls, commitments, mnemonics, and raw signatures are not part of the participant view.
          </p>
        </div>
        {status && (
          <span
            className="w-fit rounded-md border border-zinc-700 bg-zinc-950/70 px-3 py-2 font-mono text-xs tabular-nums text-zinc-300"
            data-testid="participant-code"
          >
            {status.participantCode}
          </span>
        )}
      </div>

      <ol className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Evaluation progress">
        {PROGRESS_STEPS.map(([label, description], index) => {
          const step = index + 1;
          const complete = currentStep > step;
          const active = currentStep === step || (!status && step === 1);
          return (
            <li
              key={label}
              className={`rounded-lg border px-3 py-3 ${complete
                ? 'border-green-900/70 bg-green-950/20'
                : active
                  ? 'border-indigo-700/70 bg-indigo-950/20'
                  : 'border-zinc-800 bg-zinc-950/40'}`}
            >
              <div className="flex items-center gap-2">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full font-mono text-xs tabular-nums ${complete
                  ? 'bg-green-500/20 text-green-300'
                  : active
                    ? 'bg-indigo-500/20 text-indigo-200'
                    : 'bg-zinc-800 text-zinc-500'}`}>
                  {complete ? '✓' : step}
                </span>
                <span className="text-sm font-medium text-zinc-200">{label}</span>
              </div>
              <p className="mt-2 text-xs text-zinc-500">{description}</p>
            </li>
          );
        })}
      </ol>

      {error && (
        <div className="mt-5 rounded-lg border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-300" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-5 rounded-lg border border-green-900/60 bg-green-950/30 p-3 text-sm text-green-300" role="status" aria-live="polite">
          {notice}
        </div>
      )}

      {!status ? (
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
          <label className="flex cursor-pointer items-start gap-3 text-sm leading-6 text-zinc-300">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-zinc-600 bg-zinc-900 accent-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              I consent to the Level 4 evaluation and understand the restricted 90-day retention and deletion policy.
            </span>
          </label>
          <button
            type="button"
            className="mt-4 min-h-10 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white motion-safe:transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={doEnrollment}
            disabled={!consent || busy !== null}
          >
            {busy === 'enroll' ? 'Enrolling…' : 'Enroll in evaluation'}
          </button>
        </div>
      ) : (
        <div className="mt-6 grid gap-3 lg:grid-cols-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Step 1</p>
            <h3 className="mt-2 font-medium text-zinc-100">Verify a Freighter testnet wallet</h3>
            <p className="mt-2 text-sm leading-5 text-zinc-400">
              A one-time challenge expires in ten minutes and can be attempted five times per fifteen-minute window.
            </p>
            {status.wallet.verified ? (
              <p className="mt-3 text-sm text-green-300">Verified {status.wallet.addressRedacted}</p>
            ) : (
              <button
                type="button"
                className="mt-4 min-h-10 rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 motion-safe:transition-colors hover:border-indigo-500/70 hover:bg-indigo-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={verifyWallet}
                disabled={busy !== null}
              >
                {busy === 'wallet' ? 'Waiting for Freighter…' : 'Verify wallet'}
              </button>
            )}
            {walletState === 'install' && <p className="mt-3 text-xs text-amber-300">Install Freighter, select Testnet, then retry.</p>}
            {walletState === 'wrong-network' && <p className="mt-3 text-xs text-amber-300">Freighter is on the wrong network. Select Stellar Testnet and retry.</p>}
            {walletState === 'rejected' && <p className="mt-3 text-xs text-red-300">The signature was rejected or invalid. Nothing was recorded; retry safely.</p>}
            {walletState === 'expired' && <p className="mt-3 text-xs text-amber-300">That challenge expired. Request a fresh one.</p>}
            {challenge && <p className="mt-3 text-xs text-zinc-500">Challenge expires {new Date(challenge.expiresAt).toLocaleTimeString()}.</p>}
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Step 2</p>
            <h3 className="mt-2 font-medium text-zinc-100">Complete the $1 test checkout</h3>
            <p className="mt-2 text-sm leading-5 text-zinc-400">
              Stripe test mode only. The checkout attaches your enrolled participant and browser-held commitment after consent.
            </p>
            {status.deposit.confirmed ? (
              <p className="mt-3 text-sm text-green-300">Deposit confirmed on Stellar testnet.</p>
            ) : (
              <>
                {!commitment && <p className="mt-3 text-xs text-amber-300">Generate an API key below first; its commitment stays in this browser.</p>}
                <button
                  type="button"
                  className="mt-4 min-h-10 rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 motion-safe:transition-colors hover:border-indigo-500/70 hover:bg-indigo-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={beginCheckout}
                  disabled={!status.wallet.verified || busy !== null}
                >
                  {busy === 'checkout' ? 'Opening checkout…' : 'Start $1 test checkout'}
                </button>
              </>
            )}
            {status.deposit.explorerUrl && (
              <a
                className="mt-3 block text-sm text-indigo-300 underline decoration-indigo-500/50 underline-offset-4 hover:text-indigo-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                href={status.deposit.explorerUrl}
                target="_blank"
                rel="noreferrer"
              >
                View Stellar Explorer transaction
              </a>
            )}
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Step 3</p>
            <h3 className="mt-2 font-medium text-zinc-100">Share six fixed feedback fields</h3>
            <p className="mt-2 text-sm leading-5 text-zinc-400">
              {status.feedbackSubmitted
                ? 'Feedback submitted. Thank you for helping us evaluate the flow.'
                : canFeedback
                  ? 'Your answers are stored with the restricted evaluation record.'
                  : 'Complete the wallet and deposit steps first.'}
            </p>
          </div>
        </div>
      )}

      {status && canFeedback && !status.feedbackSubmitted && (
        <form className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4" onSubmit={submitFeedback} onFocus={() => trackEvaluationEvent('survey_opened')}>
          <h3 className="text-base font-semibold text-zinc-100">Evaluation feedback</h3>
          <p className="mt-1 text-sm text-zinc-500">Please answer all six fields. Do not include prompts, wallet addresses, signatures, or API keys.</p>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-zinc-300">How easy was this? <span aria-hidden="true">*</span></legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5].map((rating) => (
                <label key={rating} className={`flex min-h-10 min-w-10 cursor-pointer items-center justify-center rounded-lg border px-3 font-mono text-sm tabular-nums focus-within:ring-2 focus-within:ring-indigo-300 ${feedback.easeRating === rating
                  ? 'border-indigo-500 bg-indigo-950/40 text-indigo-200'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500'}`}>
                  <input
                    type="radio"
                    name="easeRating"
                    value={rating}
                    className="sr-only"
                    checked={feedback.easeRating === rating}
                    onChange={() => setFeedback((current) => ({ ...current, easeRating: rating }))}
                    required
                  />
                  {rating}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer items-start gap-3 text-sm leading-6 text-zinc-300">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-zinc-600 bg-zinc-900 accent-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                checked={feedback.taskCompleted}
                onChange={(event) => setFeedback((current) => ({ ...current, taskCompleted: event.target.checked }))}
              />
              <span>I completed the requested task.</span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 text-sm leading-6 text-zinc-300">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-zinc-600 bg-zinc-900 accent-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                checked={feedback.wouldUseAgain}
                onChange={(event) => setFeedback((current) => ({ ...current, wouldUseAgain: event.target.checked }))}
              />
              <span>I would use this flow again.</span>
            </label>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-sm text-zinc-300">
              Most valuable aspect
              <textarea
                className="mt-2 min-h-24 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                value={feedback.mostValuableAspect}
                onChange={(event) => setFeedback((current) => ({ ...current, mostValuableAspect: event.target.value }))}
                maxLength={1_000}
                required
              />
            </label>
            <label className="text-sm text-zinc-300">
              Biggest friction
              <textarea
                className="mt-2 min-h-24 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                value={feedback.biggestFriction}
                onChange={(event) => setFeedback((current) => ({ ...current, biggestFriction: event.target.value }))}
                maxLength={1_000}
                required
              />
            </label>
          </div>

          <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm leading-6 text-zinc-300">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-zinc-600 bg-zinc-900 accent-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              checked={feedback.quoteConsent}
              onChange={(event) => setFeedback((current) => ({ ...current, quoteConsent: event.target.checked }))}
            />
            <span>You may quote this feedback without identifying me.</span>
          </label>
          <button
            type="submit"
            className="mt-5 min-h-10 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white motion-safe:transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy !== null || feedback.easeRating === 0}
          >
            {busy === 'feedback' ? 'Saving…' : 'Submit feedback'}
          </button>
        </form>
      )}

      {status && (
        <p className="mt-5 text-xs leading-5 text-zinc-500">
          Participant data is scheduled for deletion/anonymization after {retentionDate}.
        </p>
      )}

      <label className="mt-4 flex cursor-pointer items-start gap-3 text-xs leading-5 text-zinc-500">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-zinc-600 bg-zinc-900 accent-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          checked={analyticsConsent}
          onChange={(event) => void toggleAnalytics(event.target.checked)}
        />
        <span>Opt in to coarse product analytics only. No prompts, wallets, signatures, proofs, cookies, API keys, or raw identifiers are sent.</span>
      </label>
    </section>
  );
}
