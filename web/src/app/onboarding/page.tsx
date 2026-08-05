'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { generateSecretK, computeCommitment, deriveMnemonic } from '@/lib/crypto';

type Step = 'generate' | 'backup' | 'confirm' | 'done';

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('generate');
  const [secretK, setSecretK] = useState<Uint8Array | null>(null);
  const [mnemonic, setMnemonic] = useState<string[]>([]);
  const [commitment, setCommitment] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmWords, setConfirmWords] = useState<string[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [confirmInputs, setConfirmInputs] = useState<string[]>([]);

  const handleGenerate = async () => {
    setError(null);
    try {
      const sk = generateSecretK();
      setSecretK(sk);
      const words = deriveMnemonic(sk).split(' ');
      setMnemonic(words);

      const comm = await computeCommitment(sk);
      setCommitment(comm);

      // Pick 3 random words to confirm
      const indices: number[] = [];
      while (indices.length < 3) {
        const idx = Math.floor(Math.random() * words.length);
        if (!indices.includes(idx)) {
          indices.push(idx);
        }
      }
      setSelectedIndices(indices);
      setConfirmInputs(['', '', '']);
      setStep('backup');
    } catch (e) {
      setError('Failed to generate key material. See console for details.');
      console.error(e);
    }
  };

  const handleConfirmWord = (pos: number, value: string) => {
    const next = [...confirmInputs];
    next[pos] = value.trim().toLowerCase();
    setConfirmInputs(next);
  };

  const handleVerify = async () => {
    setError(null);
    const correct = selectedIndices.every(
      (idx, i) => confirmInputs[i].toLowerCase() === mnemonic[idx].toLowerCase(),
    );
    if (!correct) {
      setError('Words do not match. Please check your backup.');
      return;
    }

    // Store in IndexedDB
    try {
      const dbReq = indexedDB.open('zk-credits-crypto', 1);
      dbReq.onupgradeneeded = () => dbReq.result.createObjectStore('keys');
      dbReq.onsuccess = () => {
        const db = dbReq.result;
        const tx = db.transaction('keys', 'readwrite');
        tx.objectStore('keys').put(
          Array.from(secretK!).map((b) => b.toString(16).padStart(2, '0')).join(''),
          'secret_k',
        );
        tx.objectStore('keys').put(commitment!, 'commitment');
        setStep('done');
      };
      dbReq.onerror = () => {
        setError('Failed to save to browser storage.');
      };
    } catch (e) {
      setError('Failed to save key material.');
    }
  };

  const handleFinish = () => {
    router.push('/dashboard');
  };

  return (
    <main className="min-h-screen p-8 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-2">Set Up Your Account</h1>
      <p className="text-sm text-gray-500 mb-8">
        Your browser will generate a secret key to protect your privacy.
      </p>

      {error && (
        <div className="p-3 mb-4 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {step === 'generate' && (
        <div className="text-center py-12">
          <p className="text-gray-600 mb-6">
            Click below to generate your identity key. This happens entirely in your browser.
          </p>
          <button
            onClick={handleGenerate}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            Generate Key
          </button>
        </div>
      )}

      {step === 'backup' && mnemonic.length > 0 && (
        <div className="space-y-6">
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <h2 className="font-semibold text-amber-800 mb-2">Backup Your Recovery Phrase</h2>
            <p className="text-sm text-amber-700 mb-4">
              Write down these 24 words in order. They are the only way to recover your credits
              if you lose access to this browser.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {mnemonic.map((word, i) => (
                <div key={i} className="flex items-center gap-1 text-sm">
                  <span className="text-gray-400 w-5 text-right">{i + 1}.</span>
                  <span className="font-mono">{word}</span>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => setStep('confirm')}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            I've Written It Down
          </button>
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-6">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h2 className="font-semibold text-blue-800 mb-2">Confirm Your Backup</h2>
            <p className="text-sm text-blue-700 mb-4">
              Enter the words at positions {selectedIndices.map((i) => i + 1).join(', ')} to confirm.
            </p>
            {selectedIndices.map((idx, i) => (
              <div key={i} className="mb-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Word #{idx + 1}
                </label>
                <input
                  type="text"
                  value={confirmInputs[i]}
                  onChange={(e) => handleConfirmWord(i, e.target.value)}
                  className="w-full p-2 border rounded font-mono"
                  autoComplete="off"
                />
              </div>
            ))}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep('backup')}
              className="flex-1 px-4 py-2 border rounded hover:bg-gray-50"
            >
              Back
            </button>
            <button
              onClick={handleVerify}
              disabled={confirmInputs.some((v) => !v)}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Confirm & Continue
            </button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl text-green-600 font-bold">✓</span>
          </div>
          <h2 className="text-xl font-semibold mb-2">All Set!</h2>
          <p className="text-gray-600 mb-6">
            Your key has been generated and backed up. You can now create API keys and start using the gateway.
          </p>
          <button
            onClick={handleFinish}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            Go to Dashboard
          </button>
        </div>
      )}
    </main>
  );
}
