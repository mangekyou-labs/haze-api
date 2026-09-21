'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  BASE_SEPOLIA_EXPLORER,
  PILOT_TIER_ALLOWANCE,
  explorerTransactionUrl,
  createRecoveryCapsule,
  confirmRecoveryCapsule,
  downloadRecoveryCapsule,
  downloadActivatedCredential,
  formatDate,
  readLocalCredential,
  readPendingCapsule,
  readFundingToken,
  saveFundingToken,
  savePendingCapsule,
  clearFundingToken,
  wrapWithActivation,
  type LocalCredentialMetadata,
} from '@/lib/credits';
import { verifyActivatedCredential, type RecoveryCapsuleFile } from '@zk-credits/shared/base';

type Step = 'invite' | 'capsule' | 'backup' | 'fund' | 'active';

interface Activation {
  network: string;
  chainId: number;
  contractAddress: string;
  deploymentDomain: string;
  tierId: number;
  expiry: number;
  transactionHash: string;
}

interface NetworkStatus {
  network: string;
  chainId: number;
  contractAddress: string | null;
  healthy: boolean;
  generatedAt: string;
  explorer: { address: string } | null;
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function PilotOnboardingFlow({ network, gatewayBaseUrl }: { network: NetworkStatus | null; gatewayBaseUrl: string }) {
  const [step, setStep] = useState<Step>(() => 'invite');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [capsule, setCapsule] = useState<RecoveryCapsuleFile | null>(null);
  const [commitment, setCommitment] = useState<string | null>(null);
  const [activation, setActivation] = useState<Activation | null>(null);
  const [credential, setCredential] = useState<LocalCredentialMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pending = useMemo(() => (typeof window === 'undefined' ? null : readPendingCapsule()), []);

  const redeemInvite = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch('/api/invites/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await response.json() as { fundingToken?: string; error?: string };
      if (!response.ok || !data.fundingToken) throw new Error(data.error ?? 'invite_redemption_failed');
      saveFundingToken(data.fundingToken);
      setStep('capsule');
    } catch (cause) {
      setError(errorMessage(cause, 'Invite redemption failed.'));
    } finally {
      setBusy(false);
    }
  }, [code]);

  const generateCapsule = useCallback(async () => {
    setError(null);
    if (password.length < 12) {
      setError('Choose a backup password of at least 12 characters.');
      return;
    }
    if (password !== confirmation) {
      setError('The backup password and confirmation do not match.');
      return;
    }
    setBusy(true);
    try {
      const generated = await createRecoveryCapsule(password);
      downloadRecoveryCapsule(generated.file, generated.commitment);
      savePendingCapsule(generated.file);
      setCapsule(generated.file);
      setCommitment(generated.commitment);
      setStep('backup');
    } catch (cause) {
      setError(errorMessage(cause, 'Local capsule generation failed.'));
    } finally {
      setBusy(false);
    }
  }, [password, confirmation]);

  const reimportCapsule = useCallback(async (file: File | null) => {
    setError(null);
    setNotice(null);
    if (!file || !capsule || !commitment) {
      setError('Choose the recovery capsule you just downloaded.');
      return;
    }
    setBusy(true);
    try {
      const parsed = JSON.parse(await file.text()) as RecoveryCapsuleFile;
      await confirmRecoveryCapsule(parsed, password, commitment);
      setNotice('Backup verified locally. The capsule decrypts to the same credential.');
      setStep('fund');
    } catch (cause) {
      setError(errorMessage(cause, 'That capsule could not be verified.'));
    } finally {
      setBusy(false);
    }
  }, [capsule, commitment, password]);

  const fund = useCallback(async () => {
    setError(null);
    if (!commitment) {
      setError('Generate and re-import a recovery capsule first.');
      return;
    }
    const fundingToken = readFundingToken();
    if (!fundingToken) {
      setError('The funding capability expired or was cleared. Redeem a new invite.');
      setStep('invite');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/pilot/funding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fundingToken, commitment }),
      });
      const data = await response.json() as Activation & { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'funding_failed');
      clearFundingToken();

      const metadata: Activation = {
        network: data.network,
        chainId: data.chainId,
        contractAddress: data.contractAddress,
        deploymentDomain: data.deploymentDomain,
        tierId: data.tierId,
        expiry: data.expiry,
        transactionHash: data.transactionHash,
      };
      const capsuleFile = capsule ?? readPendingCapsule();
      if (!capsuleFile) throw new Error('The local recovery capsule is missing; restore it before funding.');
      const activated = wrapWithActivation(capsuleFile, { ...metadata, commitment });
      // Local verification: the wrapped metadata must match the secret in the capsule.
      const verified = await verifyActivatedCredential(activated, password);
      downloadActivatedCredential(activated);
      setCredential({
        version: 2,
        tierId: verified.tierId,
        expiry: verified.expiry,
        deploymentDomain: verified.deploymentDomain,
        payload: activated,
        savedAt: Date.now(),
      });
      setActivation(metadata);
      setStep('active');
    } catch (cause) {
      setError(errorMessage(cause, 'Funding failed. The detached capability can be retried.'));
    } finally {
      setBusy(false);
    }
  }, [capsule, commitment, password]);

  const stored = useMemo(() => (typeof window === 'undefined' ? null : readLocalCredential()), []);

  return (
    <div className="space-y-6">
      <NetworkStatusCard network={network} />

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl shadow-black/10">
        <StepHeader
          index="01"
          title="Redeem your pilot invite"
          state={step === 'invite' ? 'current' : 'done'}
          description="Founder-issued, single-use, and bound to your GitHub account. The pilot is unpaid and experimental."
        />
        {step === 'invite' && (
          <div className="mt-4 space-y-3">
            <label htmlFor="invite-code" className="block text-sm font-medium text-zinc-200">Pilot invite code</label>
            <input
              id="invite-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 font-mono text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
            />
            <button
              type="button"
              onClick={() => void redeemInvite()}
              disabled={busy || code.length === 0}
              className="min-h-11 rounded-lg bg-cyan-300 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Redeeming…' : 'Redeem invite'}
            </button>
          </div>
        )}
        {step !== 'invite' && (
          <p className="mt-3 text-sm text-emerald-200/80">Invite redeemed. A detached funding capability is held for this browser session only.</p>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl shadow-black/10">
        <StepHeader
          index="02"
          title="Create your local credential"
          state={step === 'invite' ? 'upcoming' : step === 'capsule' ? 'current' : 'done'}
          description="Your browser generates the secret and encrypts only that secret into a recovery capsule. The service never receives it."
        />
        {step === 'capsule' && (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-100/80">
              Choose a backup password you will keep. Without it the capsule cannot be opened, and nobody can reset it for you.
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="capsule-password" className="block text-sm font-medium text-zinc-200">Backup password</label>
                <input
                  id="capsule-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                />
              </div>
              <div>
                <label htmlFor="capsule-password-confirmation" className="block text-sm font-medium text-zinc-200">Confirm password</label>
                <input
                  id="capsule-password-confirmation"
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => void generateCapsule()}
              disabled={busy}
              className="min-h-11 rounded-lg bg-cyan-300 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Generating locally…' : 'Generate and download recovery capsule'}
            </button>
          </div>
        )}
        {step !== 'capsule' && step !== 'invite' && (
          <p className="mt-3 text-sm text-zinc-400">Recovery capsule generated and downloaded. Keep it with the password.</p>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl shadow-black/10">
        <StepHeader
          index="03"
          title="Re-import the capsule"
          state={step === 'backup' ? 'current' : step === 'invite' || step === 'capsule' ? 'upcoming' : 'done'}
          description="Funding stays locked until the downloaded capsule decrypts back to the same credential in this browser."
        />
        {step === 'backup' && (
          <div className="mt-4 space-y-3">
            <label htmlFor="capsule-file" className="block text-sm font-medium text-zinc-200">Recovery capsule file</label>
            <input
              id="capsule-file"
              type="file"
              accept="application/json,.json"
              onChange={(event) => void reimportCapsule(event.target.files?.[0] ?? null)}
              className="block min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 file:mr-3 file:rounded file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
            />
            <p className="text-xs text-zinc-500">Enter the same backup password above before choosing the file.</p>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl shadow-black/10">
        <StepHeader
          index="04"
          title="Fund on Base Sepolia"
          state={step === 'fund' ? 'current' : step === 'active' ? 'done' : 'upcoming'}
          description="The gateway provisions tier 0 (250 private calls) of founder-funded test credits for your commitment on Base Sepolia and returns the authoritative expiry and transaction hash. No payment is involved."
        />
        {step === 'fund' && (
          <button
            type="button"
            onClick={() => void fund()}
            disabled={busy}
            className="mt-4 min-h-11 rounded-lg bg-cyan-300 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Funding on Base Sepolia…' : 'Fund my pilot credential'}
          </button>
        )}
      </section>

      {(step === 'active' || stored || credential) && (
        <section className="rounded-2xl border border-emerald-300/20 bg-emerald-300/5 p-6">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-emerald-200/80">Activated credential</p>
          <h2 className="mt-2 text-lg font-semibold text-emerald-50">Verified locally</h2>
          <dl className="mt-4 grid gap-3 text-sm text-emerald-100/80 sm:grid-cols-2">
            <div>
              <dt className="text-emerald-200/60">Tier</dt>
              <dd>0 · {PILOT_TIER_ALLOWANCE} private calls</dd>
            </div>
            <div>
              <dt className="text-emerald-200/60">Expires</dt>
              <dd>{formatDate((activation ?? credential ?? stored)?.expiry ?? null)}</dd>
            </div>
            {activation && (
              <>
                <div>
                  <dt className="text-emerald-200/60">Contract</dt>
                  <dd>
                    <a className="underline underline-offset-4" href={`${BASE_SEPOLIA_EXPLORER}/address/${activation.contractAddress}`} rel="noreferrer" target="_blank">
                      {activation.contractAddress}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt className="text-emerald-200/60">Funding transaction</dt>
                  <dd>
                    <a className="underline underline-offset-4" href={explorerTransactionUrl(activation.transactionHash)} rel="noreferrer" target="_blank">
                      {activation.transactionHash}
                    </a>
                  </dd>
                </div>
              </>
            )}
          </dl>
          <p className="mt-4 text-sm text-emerald-100/70">
            The activated credential was downloaded and verified against the secret in your capsule. Store it with the recovery capsule and password.
          </p>
        </section>
      )}

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-500">Local setup</p>
        <h2 className="mt-2 text-lg font-semibold text-zinc-100">Point your proxy at the activated credential</h2>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-xs leading-5 text-zinc-300">
{`export ZK_CREDITS_CREDENTIAL_PATH=/absolute/path/to/zk-credits-credential.json
export ZK_CREDITS_CREDENTIAL_PASSWORD='your backup password'
export ZK_CREDITS_GATEWAY_URL=${gatewayBaseUrl}
zk-credits setup`}
        </pre>
        <p className="mt-3 text-sm text-zinc-400">
          The sidecar decrypts the credential locally and proves each prepaid
          request; an x402-native agent that registers the custom zk-prepaid
          adapter can present the same proof. Pilot telemetry does not collect
          prompts, responses, secrets, proofs, nullifiers, request signals, or
          payer/spend-plane joins, and the gateway and the upstream provider
          can still observe request content and traffic metadata.
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          Invite-only, unpaid, experimental pilot on Base Sepolia. The circuit
          is experimental and not independently audited, nothing here is
          production-ready, and generic x402 clients are unsupported.
        </p>
      </section>

      {notice && <p role="status" className="rounded-xl border border-emerald-300/20 bg-emerald-300/5 p-4 text-sm text-emerald-100/80">{notice}</p>}
      {error && <p role="alert" className="rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
      {pending && step === 'invite' && (
        <p className="text-xs text-zinc-500">A pending recovery capsule from an earlier attempt is present in this browser. Redemption restarts the flow, which is safe: no funding happens without a re-import.</p>
      )}
    </div>
  );
}

function StepHeader({ index, title, description, state }: { index: string; title: string; description: string; state: 'upcoming' | 'current' | 'done' }) {
  const badge = state === 'done' ? 'border-emerald-300/30 text-emerald-200' : state === 'current' ? 'border-cyan-300/30 text-cyan-200' : 'border-zinc-700 text-zinc-500';
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-500">Step {index}</p>
        <h2 className="mt-1 text-lg font-semibold text-zinc-100">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-400">{description}</p>
      </div>
      <span className={`shrink-0 rounded-full border px-3 py-1 text-xs ${badge}`}>{state === 'done' ? 'Done' : state === 'current' ? 'Current' : 'Locked'}</span>
    </div>
  );
}

function NetworkStatusCard({ network }: { network: NetworkStatus | null }) {
  if (!network) {
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-500">Base Sepolia</p>
        <p className="mt-2 text-sm text-zinc-400">Network status is unavailable from this deployment.</p>
      </section>
    );
  }
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-500">Base Sepolia</p>
          <p className="mt-1 text-sm text-zinc-300">
            {network.healthy ? 'Contract reachable' : 'Contract status unavailable'}
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs ${network.healthy ? 'border-emerald-300/30 text-emerald-200' : 'border-amber-300/30 text-amber-200'}`}>
          {network.healthy ? 'Healthy' : 'Degraded'}
        </span>
      </div>
      <dl className="mt-4 grid gap-2 text-xs text-zinc-400 sm:grid-cols-2">
        <div>
          <dt className="text-zinc-500">Network</dt>
          <dd className="font-mono">{network.network}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Generated</dt>
          <dd>{network.generatedAt}</dd>
        </div>
        {network.contractAddress && network.explorer && (
          <div className="sm:col-span-2">
            <dt className="text-zinc-500">Credit contract</dt>
            <dd>
              <a className="font-mono underline underline-offset-4" href={network.explorer.address} rel="noreferrer" target="_blank">
                {network.contractAddress}
              </a>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
