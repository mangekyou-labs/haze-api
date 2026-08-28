'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

const TIERS = [
  { id: 'starter', label: 'Starter', amount: '$5', calls: '100 private tickets', available: true },
  { id: 'pro', label: 'Pro', amount: '$20', calls: 'Future package', available: false },
  { id: 'enterprise', label: 'Enterprise', amount: '$50', calls: 'Future package', available: false },
];

function getCommitmentFromDB(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = indexedDB.open('zk-credits-crypto', 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('keys', 'readonly');
      const getReq = tx.objectStore('keys').get('commitment');
      getReq.onsuccess = () => resolve(getReq.result ?? null);
      getReq.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });
}

export function BuyCreditsSection({
  stripeConfigured,
}: {
  stripeConfigured: boolean;
}) {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commitment, setCommitment] = useState<string | null>(null);
  const [checkoutOverride, setCheckoutOverride] = useState<
    'confirmed' | 'gateway-unavailable' | null
  >(null);

  const checkoutParam = searchParams.get('checkout');
  const derivedState:
    | 'idle'
    | 'pending'
    | 'confirmed'
    | 'cancelled'
    | 'missing-identity'
    | 'gateway-unavailable' =
    checkoutParam === 'cancelled'
      ? 'cancelled'
      : checkoutParam === 'success'
        ? commitment
          ? 'pending'
          : 'missing-identity'
        : 'idle';
  const checkoutState = checkoutOverride ?? derivedState;

  useEffect(() => {
    const loadCommitment = () => {
      void getCommitmentFromDB().then(setCommitment);
    };
    loadCommitment();
    window.addEventListener('zk-credits-identity-ready', loadCommitment);
    return () =>
      window.removeEventListener('zk-credits-identity-ready', loadCommitment);
  }, []);

  useEffect(() => {
    const result = searchParams.get('checkout');
    if (result !== 'success' || !commitment || checkoutOverride) return;

    let stopped = false;
    let attempts = 0;
    const poll = async () => {
      if (stopped) return;
      attempts += 1;
      try {
        const res = await fetch(
          `/api/dashboard/status?commitment=${encodeURIComponent(commitment)}`,
          { cache: 'no-store' },
        );
        if (res.status === 502 || res.status === 503) {
          setCheckoutOverride('gateway-unavailable');
        }
        if (res.ok) {
          const data = await res.json();
          if (data.depositStatus === 'active') {
            setCheckoutOverride('confirmed');
            window.dispatchEvent(new Event('zk-credits-status-refresh'));
            return;
          }
        }
      } catch {
        // Stripe's webhook and the Soroban transaction are asynchronous.
      }
      if (!stopped && attempts < 10) window.setTimeout(poll, 3000);
    };
    void poll();

    return () => {
      stopped = true;
    };
  }, [commitment, searchParams, checkoutOverride]);

  const handleCheckout = async (tierId: string) => {
    if (tierId !== 'starter') return;
    setLoading(tierId);
    setError(null);

    try {
      // The API-key panel can create the identity after this component first
      // mounted. Re-read storage at the payment boundary so Stripe metadata
      // always carries the commitment that will receive the deposit.
      const currentCommitment = commitment ?? (await getCommitmentFromDB());
      if (currentCommitment && !commitment) setCommitment(currentCommitment);
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: tierId, commitment: currentCommitment }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to start checkout');
        setLoading(null);
        return;
      }

      if (data.url) {
        window.location.assign(data.url);
      }
    } catch {
      setError('Network error — please try again');
      setLoading(null);
    }
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
      <h2 className="mb-2 text-lg font-semibold text-zinc-100">Buy Credits</h2>
      <p className="mb-4 text-sm text-zinc-400">
        Purchase the fixed Starter package. It issues exactly 100 one-time
        private tickets; each request spends one ticket regardless of prompt
        length.
      </p>

      {error && (
        <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/50 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {checkoutState === 'pending' && (
        <div className="mb-4 rounded-lg border border-blue-900/60 bg-blue-950/30 p-3 text-sm text-blue-300">
          Checkout completed. Waiting for the webhook and testnet deposit to
          confirm…
        </div>
      )}
      {checkoutState === 'confirmed' && (
        <div className="mb-4 rounded-lg border border-green-900/60 bg-green-950/30 p-3 text-sm text-green-300">
          Credits confirmed on the testnet deposit. Your API key can now make
          paid requests.
        </div>
      )}
      {checkoutState === 'gateway-unavailable' && (
        <div className="mb-4 rounded-lg border border-amber-900/60 bg-amber-950/30 p-3 text-sm text-amber-300">
          Checkout completed, but the credit gateway is unreachable. Do not
          pay again; the webhook must be retried after the gateway is restored.
        </div>
      )}
      {checkoutState === 'cancelled' && (
        <div className="mb-4 rounded-lg border border-zinc-700 bg-zinc-950/60 p-3 text-sm text-zinc-300">
          Checkout was cancelled. No credits were added.
        </div>
      )}
      {checkoutState === 'missing-identity' && (
        <div className="mb-4 rounded-lg border border-amber-900/60 bg-amber-950/30 p-3 text-sm text-amber-300">
          Checkout completed, but this browser has no ZK commitment to attach
          to the payment. Recover or generate your API identity before buying.
        </div>
      )}

      {!stripeConfigured && (
        <div className="mb-4 rounded-lg border border-amber-900/60 bg-amber-950/30 p-3 text-sm text-amber-300">
          Stripe checkout is unavailable because payments are not configured on
          this deployment.
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        {TIERS.map((t) => (
          <div
            key={t.id}
            className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 text-center transition-colors hover:border-indigo-500/60"
          >
            <h3 className="font-semibold text-zinc-100">{t.label}</h3>
            <p className="mt-1 text-2xl font-bold text-white">{t.amount}</p>
            <p className="mt-1 text-sm text-zinc-500">{t.calls}</p>
            <button
              onClick={() => handleCheckout(t.id)}
              disabled={
                loading !== null ||
                !stripeConfigured ||
                !t.available ||
                checkoutState === 'pending' ||
                checkoutState === 'gateway-unavailable'
              }
              className="mt-3 w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading === t.id ? 'Redirecting...' : t.available ? 'Buy Now' : 'Coming later'}
            </button>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        Payments via Stripe (test mode). Credits are added after payment
        confirmation.
      </p>
    </div>
  );
}
