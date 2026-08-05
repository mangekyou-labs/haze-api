'use client';

import { useState, useEffect } from 'react';
import { generateSecretK, computeCommitment, deriveMnemonic } from '@/lib/crypto';

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
    (async () => {
      const stored = await readFromStore('commitment');
      if (stored) {
        setExistingCommitment(stored);
      }
      setCheckingStorage(false);
    })();
  }, []);

  const generateKey = async () => {
    setLoading(true);
    setError(null);
    try {
      let commitment: string;
      let secretK: Uint8Array;
      let words: string;

      const existingSk = await readFromStore('secret_k');
      if (existingSk && existingCommitment) {
        // Reuse existing secret_k
        commitment = existingCommitment;
        secretK = new Uint8Array(
          existingSk.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)),
        );
        words = deriveMnemonic(secretK);
      } else {
        // Generate new secret_k
        secretK = generateSecretK();
        commitment = await computeCommitment(secretK);
        words = deriveMnemonic(secretK);

        // Persist to IndexedDB
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
      <div className="p-6 border rounded-lg animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-4" />
        <div className="h-8 bg-gray-200 rounded w-1/2" />
      </div>
    );
  }

  return (
    <div className="p-6 border rounded-lg">
      <h2 className="text-lg font-semibold mb-2">API Key</h2>
      <p className="text-sm text-gray-500 mb-4">
        Use this key as your <code className="bg-gray-100 px-1 rounded">OPENAI_API_KEY</code> when calling the gateway.
      </p>

      {error && (
        <div className="p-3 mb-4 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {mnemonic && !apiKey && (
        <div className="p-4 mb-4 bg-amber-50 border border-amber-200 rounded">
          <p className="font-semibold text-amber-800 mb-2">Backup your recovery phrase</p>
          <p className="text-sm text-amber-700 mb-3">
            Write down these 24 words. They are the only way to recover your credits if you lose browser access.
          </p>
          <div className="p-3 bg-white border rounded font-mono text-sm break-all">
            {mnemonic}
          </div>
        </div>
      )}

      {apiKey ? (
        <div className="space-y-3">
          <div className="p-3 bg-gray-50 border rounded font-mono text-sm break-all">
            {apiKey}
          </div>
          <p className="text-xs text-amber-600">
            Copy this key now. You will not be able to see it again.
          </p>
          <button
            onClick={() => navigator.clipboard.writeText(apiKey)}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Copy to clipboard
          </button>
          <div className="mt-4 p-3 bg-gray-50 border rounded text-sm font-mono">
            <p className="font-semibold mb-1">Setup snippet:</p>
            <code>
              export OPENAI_BASE_URL=http://localhost:3001/v1<br />
              export OPENAI_API_KEY={apiKey}
            </code>
          </div>
        </div>
      ) : (
        <button
          onClick={generateKey}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Generating...' : existingCommitment ? 'Generate New API Key' : 'Generate API Key'}
        </button>
      )}
    </div>
  );
}
