'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { generateSecretK, computeCommitment, deriveMnemonic } from '@/lib/crypto';

// Shown in the agent setup snippet; defaults to the local gateway.
const GATEWAY_BASE =
  process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('zk-credits-crypto', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keys');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readFromStore(key: string): Promise<string | null> {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction('keys', 'readonly');
      const req = tx.objectStore('keys').get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function writeToStore(key: string, value: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keys', 'readwrite');
    tx.objectStore('keys').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function ApiKeySection({ userId }: { userId: string }) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [existingCommitment, setExistingCommitment] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingStorage, setCheckingStorage] = useState(true);

  useEffect(() => {
    void userId;
    (async () => {
      const stored = await readFromStore('commitment');
      if (stored) {
        setExistingCommitment(stored);
      }
      setCheckingStorage(false);
    })();
  }, [userId]);

  const generateKey = async () => {
    setLoading(true);
    setError(null);
    try {
      let commitment: string;
      let secretK: Uint8Array;
      let words: string;

      const existingSk = await readFromStore('secret_k');
      if (existingSk && existingCommitment) {
        commitment = existingCommitment;
        secretK = new Uint8Array(
          existingSk.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)),
        );
        words = deriveMnemonic(secretK);
      } else {
        secretK = generateSecretK();
        commitment = await computeCommitment(secretK);
        words = deriveMnemonic(secretK);

        const hex = Array.from(secretK)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        await writeToStore('secret_k', hex);
        await writeToStore('commitment', commitment);
        setExistingCommitment(commitment);
      }

      setMnemonic(words);

      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commitment }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to generate key');
        return;
      }
      setApiKey(data.apiKey);
    } catch (e) {
      console.error('Failed to generate key:', e);
      setError('Failed to generate key. See console for details.');
    } finally {
      setLoading(false);
    }
  };
  if (checkingStorage) {
    return (
      <div className="animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <div className="mb-4 h-4 w-1/3 rounded bg-zinc-800" />
        <div className="h-8 w-1/2 rounded bg-zinc-800" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
      <h2 className="mb-2 text-lg font-semibold text-zinc-100">API Key</h2>
      <p className="mb-4 text-sm text-zinc-400">
        Use this key as your{' '}
        <code className="rounded bg-zinc-800 px-1 font-mono text-zinc-200">
          OPENAI_API_KEY
        </code>{' '}
        when calling the gateway.
      </p>

      {error && (
        <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/50 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {mnemonic && !apiKey && (
        <div className="mb-4 rounded-xl border border-amber-900/60 bg-amber-950/30 p-4">
          <p className="mb-2 font-semibold text-amber-300">
            Backup your recovery phrase
          </p>
          <p className="mb-3 text-sm text-amber-200/80">
            Write down these 24 words. They are the only way to recover your
            credits if you lose browser access.
          </p>
          <div className="break-all rounded-lg border border-zinc-700 bg-zinc-950 p-3 font-mono text-sm text-zinc-100">
            {mnemonic}
          </div>
        </div>
      )}

      {apiKey ? (
        <div className="space-y-3">
          <div className="break-all rounded-lg border border-zinc-700 bg-zinc-950 p-3 font-mono text-sm text-zinc-100">
            {apiKey}
          </div>
          <p className="text-xs text-amber-400/90">
            Copy this key now. You will not be able to see it again.
          </p>
          <button
            onClick={() => navigator.clipboard.writeText(apiKey)}
            className="text-sm text-indigo-400 transition-colors hover:text-indigo-300"
          >
            Copy to clipboard
          </button>
          <div className="mt-4 rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm font-mono text-zinc-200">
            <p className="mb-1 font-semibold">Setup snippet:</p>
            <code>
              export OPENAI_BASE_URL={GATEWAY_BASE}/v1
              <br />
              export OPENAI_API_KEY={apiKey}
            </code>
          </div>
        </div>
      ) : (
        <button
          onClick={generateKey}
          disabled={loading}
          className="rounded-xl bg-indigo-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
        >
          {loading
            ? 'Generating...'
            : existingCommitment
              ? 'Generate New API Key'
              : 'Generate API Key'}
        </button>
      )}

      <p className="mt-4 text-xs text-zinc-500">
        New device?{' '}
        <Link href="/recover" className="text-indigo-400 hover:text-indigo-300">
          Recover from mnemonic
        </Link>{' '}
        &middot; Prefer a guided flow?{' '}
        <Link
          href="/onboarding"
          className="text-indigo-400 hover:text-indigo-300"
        >
          Guided setup
        </Link>
      </p>
    </div>
  );
}

