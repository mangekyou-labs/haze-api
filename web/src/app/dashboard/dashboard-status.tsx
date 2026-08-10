'use client';

import { useEffect, useState } from 'react';
import { formatUsdc } from '@/lib/format';

interface StatusData {
  commitment: string;
  callsThisEpoch: number;
  epochQuota: number;
  remainingCalls: number;
  activeKeys: number;
  balanceUsdc: string;
  depositStatus: 'active' | 'unfunded' | 'slashed' | 'withdrawn';
}

export function DashboardStatus() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadStatus();
    const refresh = () => void loadStatus();
    window.addEventListener('zk-credits-status-refresh', refresh);
    window.addEventListener('zk-credits-identity-ready', refresh);
    return () => {
      window.removeEventListener('zk-credits-status-refresh', refresh);
      window.removeEventListener('zk-credits-identity-ready', refresh);
    };
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
      <div className="animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <div className="mb-4 h-4 w-1/3 rounded bg-zinc-800" />
        <div className="mb-2 h-8 w-1/2 rounded bg-zinc-800" />
        <div className="h-4 w-2/3 rounded bg-zinc-800" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <p className="text-sm text-zinc-400">
          Generate an API key to see your usage status.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
      <h2 className="mb-4 text-lg font-semibold text-zinc-100">Usage</h2>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl bg-blue-500/10 p-4">
          <p className="text-sm font-medium text-blue-300">Calls Today</p>
          <p className="text-2xl font-bold text-blue-100">
            {status.callsThisEpoch}
          </p>
          <p className="text-xs text-blue-400/80">of {status.epochQuota} (limit)</p>
        </div>

        <div className="rounded-xl bg-green-500/10 p-4">
          <p className="text-sm font-medium text-green-300">Remaining</p>
          <p className="text-2xl font-bold text-green-100">
            {status.remainingCalls}
          </p>
          <p className="text-xs text-green-400/80">calls this epoch</p>
        </div>

        <div className="rounded-xl bg-purple-500/10 p-4">
          <p className="text-sm font-medium text-purple-300">Balance</p>
          <p className="text-2xl font-bold text-purple-100">
            {formatUsdc(status.balanceUsdc)}
          </p>
          <p className="text-xs text-purple-400/80">USDC deposit (testnet)</p>
        </div>

        <div className="rounded-xl bg-zinc-500/10 p-4">
          <p className="text-sm font-medium text-zinc-300">Active Keys</p>
          <p className="text-2xl font-bold text-zinc-100">{status.activeKeys}</p>
          <p className="text-xs text-zinc-400">API keys for this account</p>
        </div>
      </div>

      {status.depositStatus === 'slashed' && (
        <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/50 p-3">
          <p className="text-sm font-semibold text-red-300">⚠ Slashed</p>
          <p className="text-xs text-red-400/90">
            This deposit has been slashed due to rate limit violation.
          </p>
        </div>
      )}
    </div>
  );
}
