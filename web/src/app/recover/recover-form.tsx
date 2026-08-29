'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { recoverSecretK, computeCommitment } from '@/lib/crypto';

export function RecoverForm() {
  const router = useRouter();
  const [mnemonic, setMnemonic] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleRecover = async () => {
    setError(null);
    setLoading(true);

    try {
      const words = mnemonic.trim().toLowerCase().split(/\s+/);
      if (words.length !== 24) {
        setError(`Expected 24 words, got ${words.length}. Please check your recovery phrase.`);
        setLoading(false);
        return;
      }

      let secretK: Uint8Array;
      try {
        secretK = recoverSecretK(words.join(' '));
      } catch {
        setError('Invalid recovery phrase. Check that all words are from the BIP-39 wordlist.');
        setLoading(false);
        return;
      }

      if (secretK.length !== 32) {
        setError('Recovered key has invalid length.');
        setLoading(false);
        return;
      }

      const commitment = await computeCommitment(secretK);

      // Store in IndexedDB (same pattern as onboarding)
      const dbReq = indexedDB.open('zk-credits-crypto', 1);
      dbReq.onupgradeneeded = () => dbReq.result.createObjectStore('keys');

      await new Promise<void>((resolve, reject) => {
        dbReq.onsuccess = () => {
          const db = dbReq.result;
          const tx = db.transaction('keys', 'readwrite');
          const hex = Array.from(secretK)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
          tx.objectStore('keys').put(hex, 'secret_k');
          tx.objectStore('keys').put(commitment, 'commitment');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(new Error('Failed to save to IndexedDB'));
        };
        dbReq.onerror = () => reject(new Error('Failed to open IndexedDB'));
      });

      setDone(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Recovery failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-3xl font-bold tracking-tight text-white">
        Recover Your Key
      </h1>
      <p className="mt-2 text-sm text-zinc-400">
        Enter your 24-word recovery phrase to restore your identity.
      </p>

      {error && (
        <div className="mt-6 rounded-lg border border-red-900/60 bg-red-950/50 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {done ? (
        <div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-10 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/15">
            <span className="text-2xl font-bold text-green-400">✓</span>
          </div>
          <h2 className="text-xl font-semibold text-white">Key Recovered!</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Your identity has been restored. You can now use your existing
            API keys.
          </p>
          <button
            onClick={() => router.push('/dashboard')}
            className="mt-6 rounded-xl bg-indigo-600 px-6 py-3 font-medium text-white transition-colors hover:bg-indigo-500"
          >
            Go to Dashboard
          </button>
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          <div>
            <label
              htmlFor="recovery-phrase"
              className="mb-1 block text-sm font-medium text-zinc-300"
            >
              Recovery Phrase (24 words)
            </label>
            <textarea
              id="recovery-phrase"
              value={mnemonic}
              onChange={(e) => setMnemonic(e.target.value)}
              className="h-32 w-full resize-none rounded-xl border border-zinc-700 bg-zinc-950 p-3 font-mono text-sm text-zinc-100 outline-none focus:border-indigo-500"
              placeholder="word1 word2 word3 ... word24"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <button
            onClick={handleRecover}
            disabled={loading || !mnemonic.trim()}
            className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {loading ? 'Recovering...' : 'Recover Key'}
          </button>

          <p className="text-center text-xs text-zinc-500">
            Your key is recovered entirely in your browser. Nothing is sent to
            any server.
          </p>
        </div>
      )}
    </div>
  );
}
