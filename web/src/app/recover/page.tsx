'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { recoverSecretK, computeCommitment } from '@/lib/crypto';

export default function RecoverPage() {
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
    <main className="min-h-screen p-8 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-2">Recover Your Key</h1>
      <p className="text-sm text-gray-500 mb-8">
        Enter your 24-word recovery phrase to restore your identity.
      </p>

      {error && (
        <div className="p-3 mb-4 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {done ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl text-green-600 font-bold">✓</span>
          </div>
          <h2 className="text-xl font-semibold mb-2">Key Recovered!</h2>
          <p className="text-gray-600 mb-6">
            Your identity has been restored. You can now use your existing API keys.
          </p>
          <button
            onClick={() => router.push('/dashboard')}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            Go to Dashboard
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Recovery Phrase (24 words)
            </label>
            <textarea
              value={mnemonic}
              onChange={(e) => setMnemonic(e.target.value)}
              className="w-full p-3 border rounded-lg font-mono text-sm h-32 resize-none"
              placeholder="word1 word2 word3 ... word24"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <button
            onClick={handleRecover}
            disabled={loading || !mnemonic.trim()}
            className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
          >
            {loading ? 'Recovering...' : 'Recover Key'}
          </button>

          <p className="text-xs text-gray-400 text-center">
            Your key is recovered entirely in your browser. Nothing is sent to any server.
          </p>
        </div>
      )}
    </main>
  );
}
