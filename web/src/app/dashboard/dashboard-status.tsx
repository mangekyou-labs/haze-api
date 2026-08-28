'use client';

import { useEffect, useState } from 'react';
import { formatUsdc } from '@/lib/format';
import { STARTER_TICKET_COUNT, TicketLedger } from '@/lib/ticket-ledger';

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
    let unmounted = false;
    const fetchStatus = async () => {
      try {
        const dbReq = indexedDB.open('zk-credits-crypto', 1);
        dbReq.onupgradeneeded = () => dbReq.result.createObjectStore('keys');
        dbReq.onsuccess = async () => {
          if (unmounted) return;
          const db = dbReq.result;
          const tx = db.transaction('keys', 'readonly');
          const store = tx.objectStore('keys');
          const commitment = await new Promise<string | null>((resolve) => {
            const req = store.get('commitment');
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => resolve(null);
          });

          if (!commitment) {
            if (!unmounted) setLoading(false);
            return;
          }

          const res = await fetch(
            `/api/dashboard/status?commitment=${encodeURIComponent(commitment)}`,
          );
          if (!res.ok) {
            if (!unmounted) {
              setError('Failed to load status');
              setLoading(false);
            }
            return;
          }
          const data = (await res.json()) as StatusData;
          const ticketState = await new TicketLedger().getState();
          const used = ticketState.consumed.length + ticketState.skipped.length;
          const reserved = ticketState.reserved.length;
          if (!unmounted) {
            setStatus({
              ...data,
              callsThisEpoch: used,
              epochQuota: STARTER_TICKET_COUNT,
              remainingCalls: Math.max(
                0,
                STARTER_TICKET_COUNT - used - reserved,
              ),
            });
            setLoading(false);
          }
        };
        dbReq.onerror = () => {
          if (!unmounted) setLoading(false);
        };
      } catch {
        if (!unmounted) setLoading(false);
      }
    };

    void fetchStatus();
    const refresh = () => void fetchStatus();
    window.addEventListener('zk-credits-status-refresh', refresh);
    window.addEventListener('zk-credits-identity-ready', refresh);
    return () => {
      unmounted = true;
      window.removeEventListener('zk-credits-status-refresh', refresh);
      window.removeEventListener('zk-credits-identity-ready', refresh);
    };
  }, []);

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
          Generate your identity key to see your usage status.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
      <h2 className="mb-4 text-lg font-semibold text-zinc-100">Usage</h2>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl bg-blue-500/10 p-4">
          <p className="text-sm font-medium text-blue-300">Tickets Used</p>
          <p className="text-2xl font-bold text-blue-100">
            {status.callsThisEpoch}
          </p>
          <p className="text-xs text-blue-400/80">of {status.epochQuota} Starter tickets</p>
        </div>

        <div className="rounded-xl bg-green-500/10 p-4">
          <p className="text-sm font-medium text-green-300">Remaining</p>
          <p className="text-2xl font-bold text-green-100">
            {status.remainingCalls}
          </p>
          <p className="text-xs text-green-400/80">fixed tickets remaining</p>
        </div>

        <div className="rounded-xl bg-purple-500/10 p-4">
          <p className="text-sm font-medium text-purple-300">Balance</p>
          <p className="text-2xl font-bold text-purple-100">
            {formatUsdc(status.balanceUsdc)}
          </p>
          <p className="text-xs text-purple-400/80">USDC deposit (testnet)</p>
        </div>

        <div className="rounded-xl bg-zinc-500/10 p-4">
          <p className="text-sm font-medium text-zinc-300">Proof Authorization</p>
          <p className="text-2xl font-bold text-zinc-100">ZK</p>
          <p className="text-xs text-zinc-400">shared bearer + per-call proof</p>
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
