'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatDate, importCredentialFile, PILOT_TIER_ALLOWANCE } from '@/lib/credits';

export function RecoverCredentialForm() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [restored, setRestored] = useState<{ version: number; tierId: number; expiry: number; deploymentDomain: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function recover(): Promise<void> {
    setError(null);
    setRestored(null);
    if (!file || !password) {
      setError('Choose the encrypted credential export and enter its password.');
      return;
    }
    setBusy(true);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const { credential, activated } = await importCredentialFile(parsed, password);
      setRestored({
        version: activated ? 2 : 1,
        tierId: credential.tierId,
        expiry: credential.expiry,
        deploymentDomain: credential.deploymentDomain,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Credential recovery failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 shadow-2xl shadow-black/20">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-cyan-300/80">Local recovery</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-white">Restore an encrypted credential</h1>
      <p className="mt-3 text-sm leading-6 text-zinc-400">
        Version-2 activated credentials and legacy version-1 exports are both
        accepted. The file is decrypted in this browser, and the credential is
        verified against the secret it wraps. Nothing is uploaded and no
        commitment is displayed.
      </p>
      <label htmlFor="credential-file" className="mt-8 block text-sm font-medium text-zinc-200">Encrypted export</label>
      <input id="credential-file" type="file" accept="application/json,.json" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="mt-2 block min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 file:mr-3 file:rounded file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" />
      <label htmlFor="recovery-password" className="mt-5 block text-sm font-medium text-zinc-200">Backup password</label>
      <input id="recovery-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" />
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
      {restored && (
        <div className="mt-4 rounded-lg border border-emerald-300/20 bg-emerald-300/5 p-3 text-sm text-emerald-100">
          <p>Credential restored locally.</p>
          <p className="mt-1 text-emerald-200/80">
            {restored.version === 2 ? 'Activated credential' : 'Legacy version-1 export'} · tier {restored.tierId}
            {restored.tierId === 0 ? ` (${PILOT_TIER_ALLOWANCE} private calls)` : ''} · expires {formatDate(restored.expiry)} · domain {restored.deploymentDomain}
          </p>
          <Link href="/dashboard" className="mt-3 inline-flex text-sm underline underline-offset-4">Return to dashboard</Link>
        </div>
      )}
      <button type="button" onClick={() => void recover()} disabled={busy} className="mt-6 min-h-11 w-full rounded-lg bg-cyan-300 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Decrypting locally…' : 'Restore credential'}</button>
    </section>
  );
}
