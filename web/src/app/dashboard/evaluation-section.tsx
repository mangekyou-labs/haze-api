'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  analyticsEnabled,
  enableAnalytics,
  resetAnalytics,
  trackEvaluationEvent,
  trackSurveySent,
} from '@/lib/analytics';
import { EVALUATION_CONSENT_VERSION } from '@/lib/evaluation-api';

interface EvaluationStatus {
  participantCode: string;
  consentVersion: string;
  enrolledAt: string;
  retentionDeadline: string;
  wallet: { verified: boolean; addressRedacted: string | null };
  deposit: { confirmed: boolean; transactionHash: string | null; explorerUrl: string | null; newRoot: string | null };
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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

async function readCommitmentFromBrowser(): Promise<string | null> {
  if (typeof indexedDB === 'undefined') return null;
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
    if (/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(candidate)) return candidate;
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
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(90_000) });
  const payload = await response.json().catch(() => ({ error: 'invalid_response' }));
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'request_failed');
  return payload as T;
}

const initialFeedback = {
  easeRating: 0,
  taskCompleted: false,
  wouldUseAgain: false,
  mostValuableAspect: '',
  biggestFriction: '',
  quoteConsent: false,
};

export function EvaluationSection() {
  const [status, setStatus] = useState<EvaluationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [analyticsConsent, setAnalyticsConsent] = useState(false);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [walletState, setWalletState] = useState<'idle' | 'install' | 'wrong-network' | 'rejected' | 'expired'>('idle');
  const [feedback, setFeedback] = useState(initialFeedback);
  const [commitment, setCommitment] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/evaluation/status', { signal: AbortSignal.timeout(90_000), cache: 'no-store' });
      if (response.status === 404) {
        setStatus(null);
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'evaluation_unavailable');
      setStatus(payload as EvaluationStatus);
    } catch (requestError) {
      setError(requestError instanceof Error && requestError.message === 'evaluation_not_configured'
        ? 'Evaluation is not configured on this deployment yet.'
        : 'Evaluation service is waking up. Retry in a moment.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    queueMicrotask(() => void refreshStatus());
    queueMicrotask(() => void readCommitmentFromBrowser().then(setCommitment));
    const optedIn = analyticsEnabled();
    setAnalyticsConsent(optedIn);
    if (optedIn) {
      // PostHog is initialized opted out on every page load. Restore a prior
      // explicit choice only after the server returns this session's opaque
      // HMAC; an unavailable analytics service must not block the evaluation.
      void jsonRequest<{ analyticsId: string }>('/api/evaluation/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optIn: true }),
      }).then(({ analyticsId }) => {
        if (!stopped) enableAnalytics(analyticsId);
      }).catch((requestError) => {
        // A stale browser consent after logout is the one case where it is
        // safe to clear the local choice. Keep it through transient 503s so a
        // temporary wake-up does not silently revoke user consent.
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
            setNotice('Stripe checkout confirmed; your Stellar testnet deposit is recorded.');
            await refreshStatus();
            return;
          }
          if (receipt.processingStatus === 'failed') {
            setError('Checkout was received but the testnet deposit failed. Retry the checkout.');
            return;
          }
        } catch {
          // The webhook or free gateway may still be waking up; bounded retries follow.
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
      setNotice('You are enrolled. Your wallet proof and feedback are retained for 90 days, then raw proof is removed.');
      trackEvaluationEvent('evaluation_enrollment_completed');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Enrollment failed');
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
        networkPassphrase: 'Test SDF Network ; September 2015',
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
      trackEvaluationEvent('wallet_proof_completed', { durationMs: performance.now() - startedAt, outcome: 'success' });
      await refreshStatus();
    } catch (requestError) {
      const code = requestError instanceof Error ? requestError.message : 'wallet_proof_failed';
      setWalletState(code === 'challenge_expired' ? 'expired' : code === 'wallet_proof_invalid' ? 'rejected' : 'rejected');
      setError(code === 'gateway_timeout' ? 'The free gateway is waking up. Retry wallet verification.' : 'Wallet signing was rejected or could not be verified. Retry when ready.');
      trackEvaluationEvent('wallet_proof_rejected', { errorCode: code, outcome: 'failure' });
    } finally {
      setBusy(null);
    }
  };

  const beginCheckout = async () => {
    setBusy('checkout');
    setError(null);
    trackEvaluationEvent('checkout_started');
    try {
      const localCommitment = commitment ?? await readCommitmentFromBrowser();
      if (!localCommitment) {
        setError('Generate an API key first so this test deposit uses your browser-held commitment.');
        return;
      }
      setCommitment(localCommitment);
      const result = await jsonRequest<{ url?: string }>('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: 'evaluation', commitment: localCommitment }),
      });
      if (!result.url) throw new Error('checkout_url_missing');
      window.location.assign(result.url);
    } catch (requestError) {
      setError(requestError instanceof Error && requestError.message === 'enrollment_required'
        ? 'Enroll first, then start the test checkout.'
        : 'Checkout is unavailable while the gateway wakes up. Retry in a moment.');
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
      trackEvaluationEvent('survey_submitted', {
        easeRating: feedback.easeRating,
        taskCompleted: feedback.taskCompleted,
        wouldUseAgain: feedback.wouldUseAgain,
      });
      trackSurveySent({
        easeRating: feedback.easeRating,
        taskCompleted: feedback.taskCompleted,
        wouldUseAgain: feedback.wouldUseAgain,
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Feedback could not be saved');
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
      const result = await jsonRequest<{ analyticsId: string }>('/api/evaluation/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optIn: true }),
      });
      enableAnalytics(result.analyticsId);
    } catch {
      setAnalyticsConsent(false);
      setError('Analytics opt-in could not be enabled. The evaluation still works without analytics.');
    }
  };

  const canFeedback = Boolean(status?.wallet.verified && status.deposit.confirmed);
  const retentionDate = useMemo(() => status ? new Date(status.retentionDeadline).toLocaleDateString() : null, [status]);

  if (loading) {
    return <section className="evaluation-card evaluation-loading" aria-busy="true" aria-label="Loading evaluation" />;
  }

  return (
    <section className="evaluation-card" aria-labelledby="evaluation-title">
      <div className="evaluation-heading">
        <div>
          <p className="eyebrow">Level 4 evaluation</p>
          <h2 id="evaluation-title">Help prove the Stellar testnet flow</h2>
        </div>
        {status && <span className="participant-code" data-testid="participant-code">{status.participantCode}</span>}
      </div>

      <p className="evaluation-copy">
        This is an optional, consent-based test. We keep wallet proof and feedback in a restricted evaluation store for 90 days;
        private prompts, API calls, commitments, mnemonics, and proofs are never joined to it.
      </p>

      {error && <div className="evaluation-alert evaluation-alert-error" role="alert">{error}</div>}
      {notice && <div className="evaluation-alert evaluation-alert-success" role="status">{notice}</div>}

      {!status ? (
        <div className="evaluation-consent-box">
          <label className="evaluation-checkbox">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span>I consent to the Level 4 evaluation and understand the 90-day retention/deletion policy.</span>
          </label>
          <button type="button" className="evaluation-button evaluation-button-primary" onClick={doEnrollment} disabled={!consent || busy !== null}>
            {busy === 'enroll' ? 'Enrolling…' : 'Enroll in evaluation'}
          </button>
        </div>
      ) : (
        <div className="evaluation-grid">
          <div className="evaluation-step">
            <span className="step-number">1</span>
            <div>
              <h3>Verify a Freighter testnet wallet</h3>
              <p>{status.wallet.verified ? `Verified ${status.wallet.addressRedacted}` : 'A one-time, ten-minute challenge is signed locally.'}</p>
              {!status.wallet.verified && (
                <button type="button" className="evaluation-button" onClick={verifyWallet} disabled={busy !== null}>
                  {busy === 'wallet' ? 'Waiting for Freighter…' : 'Verify wallet'}
                </button>
              )}
              {walletState === 'install' && <p className="evaluation-help">Install Freighter, select Testnet, then retry.</p>}
              {walletState === 'wrong-network' && <p className="evaluation-help">Freighter is on the wrong network. Select Stellar Testnet and retry.</p>}
              {walletState === 'rejected' && <p className="evaluation-help">The signature was rejected or invalid. Nothing was recorded; retry safely.</p>}
              {walletState === 'expired' && <p className="evaluation-help">That challenge expired. Request a fresh one.</p>}
              {challenge && <p className="evaluation-help">Challenge expires {new Date(challenge.expiresAt).toLocaleTimeString()}.</p>}
            </div>
          </div>

          <div className="evaluation-step">
            <span className="step-number">2</span>
            <div>
              <h3>Complete the $1 test checkout</h3>
              <p>{status.deposit.confirmed ? 'Deposit confirmed on Stellar testnet.' : 'Stripe test mode only; no mainnet assets or real charge.'}</p>
              {!status.deposit.confirmed && !commitment && (
                <p className="evaluation-help">Generate an API key below first; the deposit uses its browser-held commitment.</p>
              )}
              {!status.deposit.confirmed && (
                <button type="button" className="evaluation-button" onClick={beginCheckout} disabled={!status.wallet.verified || busy !== null}>
                  {busy === 'checkout' ? 'Opening checkout…' : 'Start $1 test checkout'}
                </button>
              )}
              {status.deposit.explorerUrl && <a className="evaluation-link" href={status.deposit.explorerUrl} target="_blank" rel="noreferrer">View Stellar Explorer transaction</a>}
            </div>
          </div>

          <div className="evaluation-step">
            <span className="step-number">3</span>
            <div>
              <h3>Share six fixed feedback fields</h3>
              <p>{status.feedbackSubmitted ? 'Feedback submitted.' : canFeedback ? 'Your answers are aggregated for the submission evidence.' : 'Complete the wallet and deposit steps first.'}</p>
            </div>
          </div>
        </div>
      )}

      {status && canFeedback && !status.feedbackSubmitted && (
        <form className="evaluation-feedback" onSubmit={submitFeedback} onFocus={() => trackEvaluationEvent('survey_opened')}>
          <h3>Evaluation feedback</h3>
          <fieldset>
            <legend>How easy was this? <span aria-hidden="true">*</span></legend>
            <div className="rating-row">
              {[1, 2, 3, 4, 5].map((rating) => (
                <label key={rating} className={`rating-option ${feedback.easeRating === rating ? 'selected' : ''}`}>
                  <input type="radio" name="easeRating" value={rating} checked={feedback.easeRating === rating} onChange={() => setFeedback((current) => ({ ...current, easeRating: rating }))} required />
                  {rating}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="evaluation-checkbox"><input type="checkbox" checked={feedback.taskCompleted} onChange={(event) => setFeedback((current) => ({ ...current, taskCompleted: event.target.checked }))} /> I completed the requested task.</label>
          <label className="evaluation-checkbox"><input type="checkbox" checked={feedback.wouldUseAgain} onChange={(event) => setFeedback((current) => ({ ...current, wouldUseAgain: event.target.checked }))} /> I would use this flow again.</label>
          <label>Most valuable aspect<textarea value={feedback.mostValuableAspect} onChange={(event) => setFeedback((current) => ({ ...current, mostValuableAspect: event.target.value }))} maxLength={1000} required /></label>
          <label>Biggest friction<textarea value={feedback.biggestFriction} onChange={(event) => setFeedback((current) => ({ ...current, biggestFriction: event.target.value }))} maxLength={1000} required /></label>
          <label className="evaluation-checkbox"><input type="checkbox" checked={feedback.quoteConsent} onChange={(event) => setFeedback((current) => ({ ...current, quoteConsent: event.target.checked }))} /> You may quote this feedback without identifying me.</label>
          <button type="submit" className="evaluation-button evaluation-button-primary" disabled={busy !== null || feedback.easeRating === 0}>
            {busy === 'feedback' ? 'Saving…' : 'Submit feedback'}
          </button>
        </form>
      )}

      {status && <p className="evaluation-retention">Participant data is scheduled for deletion/anonymization after {retentionDate}.</p>}
      <label className="evaluation-analytics"><input type="checkbox" checked={analyticsConsent} onChange={(event) => void toggleAnalytics(event.target.checked)} /> Share coarse opt-in product analytics (no prompts, wallets, signatures, proofs, cookies, or API keys).</label>
    </section>
  );
}
