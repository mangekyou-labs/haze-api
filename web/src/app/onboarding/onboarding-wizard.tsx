'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { generateSecretK, computeCommitment, deriveMnemonic } from '@/lib/crypto';

type Step = 'generate' | 'backup' | 'confirm' | 'done';

const STEP_LABELS: Record<Step, string> = {
  generate: 'Generate',
  backup: 'Backup',
  confirm: 'Confirm',
  done: 'Done',
};

export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('generate');
  const [secretK, setSecretK] = useState<Uint8Array | null>(null);
  const [mnemonic, setMnemonic] = useState<string[]>([]);
  const [commitment, setCommitment] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [confirmInputs, setConfirmInputs] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setError(null);
    setGenerating(true);
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
    } finally {
      setGenerating(false);
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
    <div className="mx-auto max-w-lg">
      <h1 className="text-3xl font-bold tracking-tight text-white">
        Set Up Your Account
      </h1>
      <p className="mt-2 text-sm text-zinc-400">
        Your browser will generate a secret key to protect your privacy.
      </p>

      <ol className="mt-6 flex items-center gap-2 text-xs font-medium">
        {(Object.keys(STEP_LABELS) as Step[]).map((s, i) => (
          <li
            key={s}
            className={`flex items-center gap-2 rounded-full px-3 py-1 ${
              step === s
                ? 'bg-indigo-600 text-white'
                : 'border border-zinc-800 bg-zinc-900 text-zinc-500'
            }`}
          >
            <span className="font-mono">{i + 1}</span>
            {STEP_LABELS[s]}
          </li>
        ))}
      </ol>

      {error && (
        <div className="mt-6 rounded-lg border border-red-900/60 bg-red-950/50 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {step === 'generate' && (
        <div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
          <p className="text-sm leading-relaxed text-zinc-400">
            Click below to generate your identity key. This happens entirely
            in your browser.
          </p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="mt-6 rounded-xl bg-indigo-600 px-6 py-3 font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {generating ? 'Generating…' : 'Generate Key'}
          </button>
        </div>
      )}

      {step === 'backup' && mnemonic.length > 0 && (
        <div className="mt-8 space-y-6">
          <div className="rounded-2xl border border-amber-900/60 bg-amber-950/30 p-6">
            <h2 className="font-semibold text-amber-300">
              Backup Your Recovery Phrase
            </h2>
            <p className="mt-2 text-sm text-amber-200/80">
              Write down these 24 words in order. They are the only way to
              recover your credits if you lose access to this browser.
            </p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {mnemonic.map((word, i) => (
                <div key={i} className="flex items-center gap-1.5 text-sm">
                  <span className="w-6 text-right font-mono text-zinc-500">
                    {i + 1}.
                  </span>
                  <span
                    data-testid="mnemonic-word"
                    className="rounded bg-zinc-900/80 px-1.5 py-0.5 font-mono text-zinc-100"
                  >
                    {word}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => setStep('confirm')}
            className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-indigo-500"
          >
            I&apos;ve Written It Down
          </button>
        </div>
      )}

      {step === 'confirm' && (
        <div className="mt-8 space-y-6">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
            <h2 className="font-semibold text-zinc-100">Confirm Your Backup</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Enter the words at positions{' '}
              {selectedIndices.map((i) => i + 1).join(', ')} to confirm.
            </p>
            {selectedIndices.map((idx, i) => (
              <div key={i} className="mt-4">
                <label
                  htmlFor={`confirm-word-${i}`}
                  className="mb-1 block text-sm font-medium text-zinc-300"
                >
                  Word #{idx + 1}
                </label>
                <input
                  id={`confirm-word-${i}`}
                  type="text"
                  data-testid="confirm-input"
                  data-word-index={idx + 1}
                  value={confirmInputs[i]}
                  onChange={(e) => handleConfirmWord(i, e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2.5 font-mono text-sm text-zinc-100 outline-none focus:border-indigo-500"
                  autoComplete="off"
                />
              </div>
            ))}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep('backup')}
              className="flex-1 rounded-xl border border-zinc-700 px-4 py-2.5 font-medium text-zinc-200 transition-colors hover:bg-zinc-800/60"
            >
              Back
            </button>
            <button
              onClick={handleVerify}
              disabled={confirmInputs.some((v) => !v)}
              className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
            >
              Confirm &amp; Continue
            </button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-10 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/15">
            <span className="text-2xl font-bold text-green-400">✓</span>
          </div>
          <h2 className="text-xl font-semibold text-white">All Set!</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Your private identity key is ready. Continue to your dashboard to fund Starter tickets and import your phrase into your local agent CLI (<code className="rounded bg-zinc-800 px-1 font-mono text-zinc-200">zk-credits import-mnemonic</code>).
          </p>
          <button
            onClick={handleFinish}
            className="mt-6 rounded-xl bg-indigo-600 px-6 py-3 font-medium text-white transition-colors hover:bg-indigo-500"
          >
            Go to Dashboard
          </button>
        </div>
      )}
    </div>
  );
}
