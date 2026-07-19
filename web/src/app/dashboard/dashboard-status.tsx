'use client';

import { useEffect, useState } from 'react';

interface StatusData {
  commitment: string;
  callsThisEpoch: number;
  epochQuota: number;
  remainingCalls: number;
  activeKeys: number;
  balanceUsdc: string;
  depositStatus: { slashed: boolean; withdrawn: boolean } | null;
}

export function DashboardStatus() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStatus();
  }, []);

  async function loadStatus() {
    try {
      const dbReq = indexedDB.open('zk-credits-crypto', 1);
      dbReq.onupgradeneeded = () => dbReq.result.createObjectStore('keys');
      dbReq.onsuccess = async () => {
        const db = dbReq.result;
        const tx = db.transaction('keys', 'readonly');
        const store = tx.objectStore('keys');
        const commitment = await new Promise<string | null>((resolve) => {
          const req = store.get('commitment');
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => resolve(null);
        });

        if (!commitment) {
          setLoading(false);
          return;
        }

        const res = await fetch(`/api/dashboard/status?commitment=${encodeURIComponent(commitment)}`);
        if (!res.ok) {
          setError('Failed to load status');
          setLoading(false);
          return;
        }
        const data = await res.json();
        setStatus(data);
        setLoading(false);
      };
      dbReq.onerror = () => {
        setLoading(false);
      };
    } catch (e) {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 border rounded-lg animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-4" />
        <div className="h-8 bg-gray-200 rounded w-1/2 mb-2" />
        <div className="h-4 bg-gray-200 rounded w-2/3" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 border rounded-lg">
        <p className="text-red-600 text-sm">{error}</p>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="p-6 border rounded-lg">
        <p className="text-sm text-gray-500">
          Generate an API key to see your usage status.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 border rounded-lg">
      <h2 className="text-lg font-semibold mb-4">Usage</h2>

      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 bg-blue-50 rounded">
          <p className="text-sm text-blue-600 font-medium">Calls Today</p>
          <p className="text-2xl font-bold text-blue-900">{status.callsThisEpoch}</p>
          <p className="text-xs text-blue-500">
            of {status.epochQuota} (limit)
          </p>
        </div>

        <div className="p-4 bg-green-50 rounded">
          <p className="text-sm text-green-600 font-medium">Remaining</p>
          <p className="text-2xl font-bold text-green-900">{status.remainingCalls}</p>
          <p className="text-xs text-green-500">
            calls this epoch
          </p>
        </div>

        <div className="p-4 bg-purple-50 rounded">
          <p className="text-sm text-purple-600 font-medium">Balance</p>
          <p className="text-2xl font-bold text-purple-900">
            {Number(status.balanceUsdc) / 1_000_0000}
          </p>
          <p className="text-xs text-purple-500">
            USDC (on-chain in M8)
          </p>
        </div>

        <div className="p-4 bg-gray-50 rounded">
          <p className="text-sm text-gray-600 font-medium">Active Keys</p>
          <p className="text-2xl font-bold text-gray-900">{status.activeKeys}</p>
          <p className="text-xs text-gray-500">
            API keys for this account
          </p>
        </div>
      </div>

      {status.depositStatus?.slashed && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded">
          <p className="text-sm text-red-700 font-semibold">⚠ Slashed</p>
          <p className="text-xs text-red-600">
            This deposit has been slashed due to rate limit violation.
          </p>
        </div>
      )}
    </div>
  );
}
