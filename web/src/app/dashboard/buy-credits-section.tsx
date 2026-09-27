'use client';

import { useState, useEffect } from 'react';

const TIERS = [
  { id: 'evaluation', label: 'Testnet evaluation', amount: '$1', calls: 'Stripe test mode only', evaluation: true },
  { id: 'starter', label: 'Starter', amount: '$5', calls: '~5,000 calls' },
  { id: 'pro', label: 'Pro', amount: '$20', calls: '~25,000 calls' },
  { id: 'enterprise', label: 'Enterprise', amount: '$50', calls: '~75,000 calls' },
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

export function BuyCreditsSection() {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [commitment, setCommitment] = useState<string | null>(null);
  const [isDevMode, setIsDevMode] = useState(false);

  useEffect(() => {
    getCommitmentFromDB().then(setCommitment);
    // Use a simpler heuristic: check if we're on localhost (dev mode indicator)
    queueMicrotask(() => setIsDevMode(window.location.hostname === 'localhost'));
  }, []);

  const handleCheckout = async (tierId: string) => {
    setLoading(tierId);
    setError(null);
    setSuccess(null);

    try {
      if (isDevMode && tierId !== 'evaluation') {
        // Dev mode: bypass Stripe, call gateway deposit directly
        const res = await fetch('/api/dev/deposit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tier: tierId, commitment }),
        });

        const data = await res.json();
        if (!res.ok) {
          setError(data.error === 'missing_commitment'
            ? 'Complete onboarding first (generate your secret key).'
            : data.message || data.error || 'Dev deposit failed');
          setLoading(null);
          return;
        }

        setSuccess(
          data.simulated
            ? `Dev deposit simulated: $${tierId === 'starter' ? '5' : tierId === 'pro' ? '20' : '50'} USDC (no on-chain tx)`
            : `Dev deposit: $${tierId === 'starter' ? '5' : tierId === 'pro' ? '20' : '50'} USDC credited! TX: ${data.txHash?.slice(0, 12)}...`
        );
        setLoading(null);
        return;
      }

      // Production: use Stripe checkout
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: tierId, commitment }),
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
    <div className="purchase-panel p-6 border rounded-lg">
      <h2 className="text-lg font-semibold mb-2">
        Buy Credits {isDevMode && <span className="text-xs text-amber-600 font-normal">(dev mode)</span>}
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        {isDevMode
          ? 'Dev mode: deposits are simulated via the gateway. No real payment needed.'
          : 'Purchase credits to use with your API key. Each call costs $0.001.'}
      </p>

      {error && (
        <div className="p-3 mb-4 bg-red-50 border border-red-200 rounded text-sm text-red-700" data-testid="deposit-error">
          {error}
        </div>
      )}

      {success && (
        <div className="p-3 mb-4 bg-green-50 border border-green-200 rounded text-sm text-green-700" data-testid="deposit-success">
          {success}
        </div>
      )}

      <div className="purchase-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {TIERS.map((t) => (
          <div
            key={t.id}
            className="purchase-tier p-4 border rounded-lg text-center hover:border-blue-500 transition-colors"
          >
            <h3 className="font-semibold">{t.label}</h3>
            <p className="text-2xl font-bold mt-1">{t.amount}</p>
            <p className="text-sm text-gray-500 mt-1">{t.calls}</p>
            <button
              onClick={() => handleCheckout(t.id)}
              disabled={loading !== null}
              className="purchase-tier-button mt-3 w-full px-3 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid={`buy-${t.id}`}
            >
              {loading === t.id
                ? isDevMode ? 'Depositing...' : 'Redirecting...'
                : isDevMode ? `Add ${t.amount}` : 'Buy Now'}
            </button>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400 mt-3">
        {isDevMode
          ? 'Dev mode: deposits go directly to the gateway. No Stripe involved.'
          : 'Payments via Stripe (test mode). Credits are added after payment confirmation.'}
      </p>
    </div>
  );
}
