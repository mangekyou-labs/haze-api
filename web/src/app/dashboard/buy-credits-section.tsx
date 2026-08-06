'use client';

import { useState, useEffect } from 'react';

const TIERS = [
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
  const [commitment, setCommitment] = useState<string | null>(null);

  useEffect(() => {
    getCommitmentFromDB().then(setCommitment);
  }, []);

  const handleCheckout = async (tierId: string) => {
    setLoading(tierId);
    setError(null);

    try {
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
        window.location.href = data.url;
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
        Purchase credits to use with your API key. Each call costs $0.001.
      </p>

      {error && (
        <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/50 p-3 text-sm text-red-300">
          {error}
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
              disabled={loading !== null}
              className="mt-3 w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading === t.id ? 'Redirecting...' : 'Buy Now'}
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
