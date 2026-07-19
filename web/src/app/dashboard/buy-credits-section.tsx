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
    <div className="p-6 border rounded-lg">
      <h2 className="text-lg font-semibold mb-2">Buy Credits</h2>
      <p className="text-sm text-gray-500 mb-4">
        Purchase credits to use with your API key. Each call costs $0.001.
      </p>

      {error && (
        <div className="p-3 mb-4 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        {TIERS.map((t) => (
          <div
            key={t.id}
            className="p-4 border rounded-lg text-center hover:border-blue-500 transition-colors"
          >
            <h3 className="font-semibold">{t.label}</h3>
            <p className="text-2xl font-bold mt-1">{t.amount}</p>
            <p className="text-sm text-gray-500 mt-1">{t.calls}</p>
            <button
              onClick={() => handleCheckout(t.id)}
              disabled={loading !== null}
              className="mt-3 w-full px-3 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading === t.id ? 'Redirecting...' : 'Buy Now'}
            </button>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400 mt-3">
        Payments via Stripe (test mode). Credits are added after payment confirmation.
      </p>
    </div>
  );
}
