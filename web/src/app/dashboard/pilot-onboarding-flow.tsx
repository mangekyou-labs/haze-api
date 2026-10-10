'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BASE_SEPOLIA_EXPLORER, createRecoveryCapsule, downloadRecoveryCapsule, downloadActivatedCredential, wrapWithActivation, explorerTransactionUrl, formatDate } from '@/lib/credits';
import { verifyActivatedCredential, verifyRecoveryCapsule, type ActivatedCredentialFile, type RecoveryCapsuleFile } from '@zk-credits/shared/base';

type Activation = { commitment: string; network: string; chainId: number; contractAddress: string; deploymentDomain: string; tierId: number; expiry: number; transactionHash: string };
type Bundle = { commitment: string; state: 'funding' | 'unknown' | 'funded' | 'waiting_funds' | 'failed'; reason: string | null; transactionHash: string | null; activation: Activation | null };
type Snapshot = {
  balanceCents: number; reservedCents: number; availableCents: number; bundlePriceCents: number; bundles: Bundle[];
  funder: { address: string; tokenAddress: string; usdcBalance: string; ready: boolean; reason: string | null; faucetUrl: string } | null;
};
interface NetworkStatus { network: string; chainId: number; contractAddress: string | null; healthy: boolean; generatedAt: string; explorer: { address: string } | null }
const button = 'min-h-11 rounded-lg bg-cyan-300 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:cursor-not-allowed disabled:opacity-50';
const card = 'rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6';
const usd = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const usdc = (units: string) => { const value = BigInt(units); return `${value / 1_000_000n}.${(value % 1_000_000n / 10_000n).toString().padStart(2, '0')}`; };
const messages: Record<string, string> = {
  unsupported_tier: 'The deployed contract does not match the sandbox bundle. Its operator must check the configuration.',
  sponsor_pending: 'Another funding transaction is being checked. Refresh status and retry when the funder is ready.',
  checkout_expired: 'Checkout expired. Select top up again to open a new session.',
  insufficient_sandbox_balance: 'Top up your simulated balance before activating.',
  insufficient_usdc: 'The shared funder needs 20 test USDC. Use the faucet, send to its address below, then retry.',
  insufficient_gas: 'The funder needs Base Sepolia ETH for gas. Its operator must replenish it before retrying.',
  insufficient_allowance: 'The funder needs a USDC allowance for the credit contract. Its operator must approve it before retrying.',
  sponsor_not_configured: 'The funding service is not configured yet. Try again after the operator enables it.',
  sponsor_mismatch: 'The configured wallet does not match the contract funder. The operator must correct it.',
  wrong_chain: 'The funding service must connect to Base Sepolia.',
  preflight_failed: 'Funding could not pass its preflight check. No transaction was sent and your balance was released.',
  transaction_reverted: 'The funding transaction reverted. Your simulated balance was released; you can retry.',
  confirmation_pending: 'Waiting for confirmation. Your simulated balance is held until the transaction is resolved.',
  checkout_unavailable: 'Checkout is unavailable. Retry to resume the same top-up.',
  stripe_sandbox_not_configured: 'Stripe sandbox is not configured on this deployment yet.',
  sandbox_unavailable: 'Sandbox billing is not available on this deployment yet.',
  gateway_unavailable: 'The service is unavailable. Try refreshing your status.',
};
function message(cause: unknown) { const code = cause instanceof Error ? cause.message : 'Something went wrong. Try again.'; return messages[code] ?? code; }
async function jsonRequest<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'The request failed. Try again.');
  return data as T;
}

export function PilotOnboardingFlow({ network, gatewayBaseUrl }: { network: NetworkStatus | null; gatewayBaseUrl: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [capsule, setCapsule] = useState<RecoveryCapsuleFile | null>(null);
  const [commitment, setCommitment] = useState<string | null>(null);
  const [step, setStep] = useState<'capsule' | 'backup' | 'fund' | 'active'>('capsule');
  const [activation, setActivation] = useState<Activation | null>(null);
  const [selectedBundle, setBundle] = useState<Bundle | null>(null);
  const bundle = snapshot?.bundles.find(b => b.commitment === commitment) ?? selectedBundle;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const downloaded = useRef<string | null>(null);
  const checkoutReturn = useRef<string | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    const next = await jsonRequest<Snapshot>('/api/sandbox');
    setSnapshot(next);
    return next;
  }, []);
  useEffect(() => {
    let mounted = true;
    checkoutReturn.current ??= new URLSearchParams(window.location.search).get('checkout');
    const checkout = checkoutReturn.current;
    if (checkout) {
      sessionStorage.removeItem('zk-credits:checkout-request');
      window.history.replaceState(null, '', window.location.pathname);
    }
    void jsonRequest<Snapshot>('/api/sandbox').then(next => {
      if (!mounted) return;
      setSnapshot(next);
      if (checkout) {
        const waiting = checkout === 'success' && next.availableCents <= 0;
        setCheckoutPending(waiting);
        setNotice(checkout === 'success'
          ? waiting ? 'Checkout completed. Waiting for the verified payment to update your balance.' : 'Your simulated balance is ready.'
          : 'Checkout cancelled. Your balance was not changed.');
      }
    }).catch(cause => { if (mounted) setError(message(cause)); });
    return () => { mounted = false; };
  }, [refresh]);
  const pending = snapshot?.bundles.some(b => b.state === 'unknown' || b.state === 'funding') || bundle?.state === 'unknown' || bundle?.state === 'funding';
  useEffect(() => {
    if (!pending && !checkoutPending) return;
    const timer = window.setInterval(() => void refresh().then(next => {
      if (checkoutPending && next.availableCents > 0) {
        setCheckoutPending(false); setNotice('Your simulated balance is ready.');
      }
    }).catch(() => {}), 5000);
    const stop = checkoutPending ? window.setTimeout(() => {
      setCheckoutPending(false); setNotice('If your top-up has not arrived, refresh status in a moment. Payment verification may still be processing.');
    }, 60_000) : undefined;
    return () => { window.clearInterval(timer); if (stop) window.clearTimeout(stop); };
  }, [pending, checkoutPending, refresh]);

  const finish = useCallback(async (file: RecoveryCapsuleFile, metadata: Activation) => {
    if (downloaded.current === metadata.commitment) return;
    const activated = wrapWithActivation(file, metadata);
    await verifyActivatedCredential(activated);
    downloadActivatedCredential(activated);
    downloaded.current = metadata.commitment;
    setActivation(metadata); setStep('active');
    setNotice('Activated credential downloaded and verified locally.');
  }, []);
  useEffect(() => {
    if (!commitment || !snapshot) return;
    const current = snapshot.bundles.find(b => b.commitment === commitment);
    if (!current) return;
    if (current.activation && capsule) void finish(capsule, current.activation).catch(cause => setError(message(cause)));
  }, [commitment, snapshot, capsule, finish]);

  async function topup() {
    setBusy(true); setError(null);
    try {
      let requestId = sessionStorage.getItem('zk-credits:checkout-request');
      if (!requestId) { requestId = crypto.randomUUID(); sessionStorage.setItem('zk-credits:checkout-request', requestId); }
      const result = await jsonRequest<{ url?: string; completed?: boolean }>('/api/sandbox/checkout', { requestId });
      if (result.completed) { sessionStorage.removeItem('zk-credits:checkout-request'); setCheckoutPending(true); setNotice('Checkout completed. Waiting for verified payment.'); await refresh(); }
      else if (result.url) window.location.assign(result.url);
      else throw new Error('checkout_unavailable');
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'checkout_expired') sessionStorage.removeItem('zk-credits:checkout-request');
      setError(message(cause));
    }
    finally { setBusy(false); }
  }
  async function generate() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const generated = await createRecoveryCapsule();
      downloadRecoveryCapsule(generated.file, generated.commitment);
      setCapsule(generated.file); setCommitment(generated.commitment); setBundle(null); setActivation(null); downloaded.current = null; setStep('backup');
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  async function reimport(file: File | null) {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      if (file.size > 64 * 1024) throw new Error('Choose a recovery file smaller than 64 KB.');
      const imported = JSON.parse(await file.text()) as RecoveryCapsuleFile | ActivatedCredentialFile;
      const verified = imported.kind === 'activated-credential'
        ? await verifyActivatedCredential(imported) : await verifyRecoveryCapsule(imported);
      const parsed: RecoveryCapsuleFile = { ...imported, kind: 'recovery-capsule' };
      if (step === 'backup' && verified.commitment !== commitment) throw new Error('Choose the recovery file you just downloaded.');
      setCapsule(parsed); setCommitment(verified.commitment); downloaded.current = null;
      const next = await refresh();
      const current = next.bundles.find(b => b.commitment === verified.commitment) ?? null;
      setBundle(current); setStep('fund'); setNotice('Backup verified locally.');
      if (current?.activation) await finish(parsed, current.activation);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  async function fund() {
    if (!commitment || !capsule) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const current = await jsonRequest<Bundle>('/api/pilot/funding', { commitment });
      setBundle(current);
      if (current.activation) await finish(capsule, current.activation);
      await refresh();
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  const held = bundle?.state === 'funding' || bundle?.state === 'unknown';

  return <div className="space-y-6">
    <section className={card}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="text-lg font-semibold text-zinc-100">Sandbox balance</h2><p className="mt-1 text-sm text-zinc-400">Stripe test payments add simulated dollars. No real money is charged.</p></div>
        <button type="button" className={button} disabled={busy || !snapshot} onClick={() => void topup()}>Top up $20 in sandbox</button>
      </div>
      <dl className="mt-4 flex flex-wrap gap-8 text-sm"><div><dt className="text-zinc-400">Available</dt><dd className="mt-1 font-mono text-xl text-zinc-100 tabular-nums">{snapshot ? usd(snapshot.availableCents) : 'Loading…'}</dd></div><div><dt className="text-zinc-400">Held for funding</dt><dd className="mt-1 font-mono text-xl text-zinc-100 tabular-nums">{snapshot ? usd(snapshot.reservedCents) : '—'}</dd></div></dl>
      <p className="mt-3 text-xs text-zinc-400">Use test card 4242 4242 4242 4242, a future expiry, and any CVC. Each 250-credit bundle costs $20 simulated dollars, deducted only after Base confirms.</p>
      <button type="button" onClick={() => { setError(null); void refresh().catch(cause => setError(message(cause))); }} className="mt-3 min-h-11 text-sm text-cyan-200 underline underline-offset-4">Refresh status</button>
    </section>

    <section className={card}>
      <h2 className="text-lg font-semibold text-zinc-100">1. Create your local credential</h2>
      <p className="mt-1 text-sm text-zinc-400">Your browser creates the secret. Anyone possessing this recovery file can spend its credits. Keep it private.</p>
      {step === 'capsule' && <button type="button" onClick={() => void generate()} disabled={busy} className={`${button} mt-4`}>Download recovery file</button>}
      {(step === 'capsule' || step === 'backup' || step === 'fund') && <div className="mt-4">
        <label htmlFor="capsule-file" className="block text-sm text-zinc-200">{step === 'backup' ? 'Select the file you downloaded to verify your backup' : 'Resume with your recovery file'}</label>
        <input id="capsule-file" type="file" accept="application/json,.json" disabled={busy} onChange={event => void reimport(event.target.files?.[0] ?? null)} className="mt-2 block min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 file:mr-3 file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" />
        <p className="mt-2 text-xs text-zinc-500">Verification stays in your browser. After a reload, re-import this file to resume the same bundle.</p>
      </div>}
    </section>

    <section className={card}>
      <h2 className="text-lg font-semibold text-zinc-100">2. Activate 250 credits on Base Sepolia</h2>
      <p className="mt-1 text-sm text-zinc-400">Your simulated balance stays available if funding fails before a transaction is sent.</p>
      {step === 'fund' && <>
        <button type="button" onClick={() => void fund()} disabled={busy || held || !snapshot || snapshot.availableCents < 2000} className={`${button} mt-4`}>{busy ? 'Activating…' : held ? 'Waiting for confirmation…' : bundle ? 'Retry activation' : 'Activate my credits'}</button>
        {snapshot && snapshot.availableCents < 2000 && !held && <p className="mt-2 text-sm text-amber-200">Top up $20 in sandbox to activate this bundle.</p>}
      </>}
      {bundle && <div className="mt-4" role="status"><p className="text-sm text-zinc-200">Bundle status: <span className="font-semibold">{statusLabel(bundle.state)}</span></p>{bundle.reason && <p className="mt-2 text-sm text-amber-200">{messages[bundle.reason] ?? 'Funding is unavailable. Refresh status before retrying.'}</p>}{bundle.transactionHash && <a className="mt-2 inline-block break-all font-mono text-xs text-cyan-200 underline" href={explorerTransactionUrl(bundle.transactionHash)} target="_blank" rel="noreferrer">View funding transaction</a>}</div>}
      {activation && <div className="mt-4 text-sm text-emerald-200"><p>Activated credential verified locally · 250 private calls · expires {formatDate(activation.expiry)}</p><button className="mt-3 min-h-11 underline" type="button" onClick={() => { if (capsule) downloadActivatedCredential(wrapWithActivation(capsule, activation)); }}>Download activated credential again</button></div>}
    </section>

    <section className={card}>
      <h2 className="text-lg font-semibold text-zinc-100">Shared Base Sepolia funder</h2>
      {snapshot?.funder ? <>
        <p className="mt-2 text-sm text-zinc-400">{snapshot.funder.ready ? 'Ready to fund a bundle.' : messages[snapshot.funder.reason ?? ''] ?? 'Funding is temporarily unavailable.'}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3"><a href={`${BASE_SEPOLIA_EXPLORER}/address/${snapshot.funder.address}`} className="min-w-0 break-all font-mono text-xs text-cyan-200 underline" target="_blank" rel="noreferrer">{snapshot.funder.address}</a><button type="button" className="min-h-11 text-sm text-cyan-200 underline" onClick={() => void navigator.clipboard.writeText(snapshot.funder!.address).then(() => setNotice('Funder address copied.')).catch(() => setError('Copy the displayed funder address.'))}>Copy funder address</button></div>
        <p className="mt-2 break-all text-xs text-zinc-400">USDC token: {snapshot.funder.tokenAddress}</p>
        <p className="mt-2 font-mono text-sm text-zinc-300 tabular-nums">{usdc(snapshot.funder.usdcBalance)} test USDC available · 20 USDC needed per bundle</p>
        {snapshot.funder.faucetUrl && <a href={snapshot.funder.faucetUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center text-sm text-cyan-200 underline underline-offset-4">Get Base Sepolia USDC from the faucet</a>}
        <p className="mt-2 text-xs text-zinc-400">Send test USDC to this funder wallet, then refresh and retry. Contributions replenish the shared pool; they do not reserve a turn or add Stripe balance.</p>
      </> : <p className="mt-2 text-sm text-zinc-400">Funder status is unavailable. Refresh status to try again.</p>}
    </section>

    {snapshot && snapshot.bundles.length > 0 && <section className={card}><h2 className="text-lg font-semibold text-zinc-100">Your bundles</h2><ul className="mt-3 divide-y divide-zinc-800">{snapshot.bundles.map(item => <li key={item.commitment} className="py-3 text-sm text-zinc-300"><p><span className="font-mono" title={item.commitment}>{item.commitment.slice(0, 12)}…</span> · {statusLabel(item.state)}</p>{item.reason && <p className="mt-1 text-xs text-amber-200">{messages[item.reason] ?? 'Funding is unavailable. Refresh status before retrying.'}</p>}{item.transactionHash && <a href={explorerTransactionUrl(item.transactionHash)} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-11 items-center text-cyan-200 underline">Funding transaction</a>}</li>)}</ul><p className="mt-2 text-xs text-zinc-400">Your account links to this funding history. Secrets stay local; account and Stripe identifiers are excluded from spend proofs.</p></section>}

    <section className={card}>
      <h2 className="text-lg font-semibold text-zinc-100">3. Connect Codex</h2>
      <p className="mt-2 text-sm text-zinc-400">Use the activated credential. The npm package handles proving files, Base RPC, and client configuration.</p>
      <pre className="mt-4 overflow-x-auto rounded-lg bg-zinc-950 p-4 text-xs leading-6 text-zinc-200"><code>{'npm install --global zk-credits\nZK_CREDITS_CREDENTIAL_PATH=/path/to/activated-credential.json zk-credits setup codex\nzk-credits codex'}</code></pre>
      <p className="mt-3 text-sm text-zinc-400">Ask Codex to fix a failing test in your project. It can use several paid model calls while editing and checking the result.</p>
      <a href="https://github.com/mangekyou-labs/haze-api/blob/main/docs/onboarding/base-zk-credits-codex-first-use.md" target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center text-sm text-cyan-200 underline">Open the setup guide</a>
      <p className="mt-2 break-all text-xs text-zinc-500">Gateway: {gatewayBaseUrl}</p>
    </section>
    <p className="text-xs text-zinc-500">{network?.healthy ? 'Contract reachable' : 'Contract status unavailable'} · Base Sepolia testnet</p>
    {notice && <p role="status" className="rounded-xl border border-emerald-300/20 bg-emerald-300/5 p-4 text-sm text-emerald-100">{notice}</p>}
    {error && <p role="alert" className="rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
  </div>;
}
function statusLabel(state: Bundle['state']) {
  return { funding: 'Funding', unknown: 'Confirmation pending', funded: 'Funded', waiting_funds: 'Waiting for test USDC', failed: 'Failed — safe to retry' }[state];
}
