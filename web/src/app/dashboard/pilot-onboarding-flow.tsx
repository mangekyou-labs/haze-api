'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BASE_SEPOLIA_EXPLORER, createRecoveryCapsule, downloadRecoveryCapsule, downloadActivatedCredential, wrapWithActivation, explorerTransactionUrl, formatDate } from '@/lib/credits';
import { verifyActivatedCredential, verifyRecoveryCapsule, type ActivatedCredentialFile, type RecoveryCapsuleFile } from '@zk-credits/shared/base';

import { saveCheckoutResume, takeCheckoutResume, clearCheckoutResume } from '@/lib/checkout-resume';

type Activation = { commitment: string; network: string; chainId: number; contractAddress: string; deploymentDomain: string; tierId: number; expiry: number; transactionHash: string };
type Bundle = { commitment: string; state: 'funding' | 'unknown' | 'funded' | 'waiting_funds' | 'failed'; reason: string | null; transactionHash: string | null; activation: Activation | null };
type Snapshot = {
  balanceCents: number; reservedCents: number; availableCents: number; bundlePriceCents: number; bundles: Bundle[];
  topups: { requestId: string; amountCents: number; paid: boolean }[];
  funder: { address: string; tokenAddress: string; usdcBalance: string; gasBalanceWei?: string; allowance?: string; ready: boolean; reason: string | null; faucetUrl: string } | null;
};
interface NetworkStatus { network: string; chainId: number; contractAddress: string | null; healthy: boolean; generatedAt: string; explorer: { address: string } | null }
const button = 'min-h-11 rounded-lg bg-cyan-300 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:cursor-not-allowed disabled:opacity-50';
const card = 'rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6';
const usd = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const usdc = (units: string) => { const value = BigInt(units); return `${value / 1_000_000n}.${(value % 1_000_000n / 10_000n).toString().padStart(2, '0')}`; };
const messages: Record<string, string> = {
  unsupported_token: 'The funding service has an unsupported USDC token. Its operator must correct the Base Sepolia configuration.',
  unsupported_tier: 'The deployed contract does not match the sandbox bundle. Its operator must check the configuration.',
  sponsor_pending: 'Another funding transaction is being checked. Wait a moment, then retry activation.',
  funder_unavailable: 'We could not reach the Base Sepolia funding service. No funding transaction was sent; your test balance is safe. Check again, then retry activation.',
  checkout_expired: 'Checkout expired. Select top up again to open a new session.',
  insufficient_sandbox_balance: 'Top up your simulated balance before activating.',
  insufficient_usdc: 'The shared funder needs 20 test USDC. Use the faucet, send to its address below, then retry.',
  insufficient_gas: 'The funder needs Base Sepolia ETH for gas. Its operator must replenish it before retrying.',
  approval_pending: 'Preparing your credits. Please retry in a moment; your balance is safe.',
  approval_failed: 'We could not prepare activation. Your balance is safe; retry in a moment.',
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
  bundle_not_found: 'This recovery file has not been activated yet. Activate it here to create your credit bundle.',
  rpc_unavailable: 'Base Sepolia could not be reached. Keep your recovery file and retry in a moment.',
  gateway_unavailable: 'The service is unavailable. Use Check again to reconnect without importing your file.',
};
class RequestFailure extends Error {
  constructor(code: string, readonly ambiguous = false) { super(code); }
}
class CredentialFailure extends Error {}
function message(cause: unknown) {
  if (cause instanceof CredentialFailure) return cause.message;
  const code = cause instanceof Error ? cause.message : '';
  return messages[code] ?? 'The service could not complete this request. Your recovery file is safe. Use Check again, then retry activation.';
}
async function jsonRequest<T>(url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...(body === undefined ? { cache: 'no-store' as const } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(25_000) });
  } catch { throw new RequestFailure('gateway_unavailable', true); }
  let data;
  try { data = await response.json(); } catch { throw new RequestFailure('gateway_unavailable', true); }
  if (!data || typeof data !== 'object') throw new RequestFailure('gateway_unavailable', true);
  if (!response.ok) throw new RequestFailure(typeof data.error === 'string' ? data.error : 'gateway_unavailable', response.status >= 500);
  return data as T;
}

export function PilotOnboardingFlow({ gatewayBaseUrl, accountId }: { gatewayBaseUrl: string; accountId: string }) {
  const [network, setNetwork] = useState<NetworkStatus | null>(null);
  const [networkLoading, setNetworkLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [topupAmount, setTopupAmount] = useState<number | null>(null);
  const [selectedAmount, setSelectedAmount] = useState(2000);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [capsule, setCapsule] = useState<RecoveryCapsuleFile | null>(null);
  const [commitment, setCommitment] = useState<string | null>(null);
  const [step, setStep] = useState<'capsule' | 'backup' | 'fund' | 'active'>('capsule');
  const [activationAttempted, setActivationAttempted] = useState(false);
  const [reconcilingActivation, setReconcilingActivation] = useState(false);
  const [activation, setActivation] = useState<Activation | null>(null);
  const [selectedBundle, setBundle] = useState<Bundle | null>(null);
  const bundle = snapshot?.bundles.find(b => b.commitment === commitment) ?? selectedBundle;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const restoredCheckout = useRef(false);
  const downloaded = useRef<string | null>(null);
  const pendingTopup = useRef<{ requestId: string; amountCents: number } | null>(null);
  const checkoutReturn = useRef<string | null | undefined>(undefined);
  const activationReconciliation = useRef<{ startedAt: number; snapshot: Snapshot | null } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/network-status', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]) })
      .then(response => response.json()).then(data => { if (!controller.signal.aborted) setNetwork(data); })
      .catch(() => {}).finally(() => { if (!controller.signal.aborted) setNetworkLoading(false); });
    return () => controller.abort();
  }, []);

  const acceptSnapshot = useCallback((next: Snapshot) => {
    setSnapshot(next);
    const selected = pendingTopup.current;
    if (!selected || !next.topups?.some(t => t.requestId === selected.requestId && t.amountCents === selected.amountCents && t.paid)) return;
    sessionStorage.removeItem(`zk-credits:checkout-request:${selected.amountCents}`);
    sessionStorage.removeItem('zk-credits:checkout-pending');
    pendingTopup.current = null;
    setCheckoutPending(false);
    setNotice('Your simulated balance is ready.');
    setError(null);
  }, []);
  const refresh = useCallback(async () => {
    const next = await jsonRequest<Snapshot>('/api/sandbox');
    acceptSnapshot(next);
    return next;
  }, [acceptSnapshot]);
  useEffect(() => {
    let mounted = true;
    try { pendingTopup.current = JSON.parse(sessionStorage.getItem('zk-credits:checkout-pending') ?? 'null'); } catch { pendingTopup.current = null; }
    checkoutReturn.current ??= new URLSearchParams(window.location.search).get('checkout');
    const checkout = checkoutReturn.current;
    if (checkout) {
      if (checkout === 'cancelled') {
        sessionStorage.removeItem('zk-credits:checkout-pending');
        pendingTopup.current = null;
        setNotice('Checkout cancelled. Your balance was not changed.');
      }
      window.history.replaceState(null, '', window.location.pathname);
    }
    if (checkout === 'success' || pendingTopup.current) {
      setCheckoutPending(true);
      setNotice(checkout === 'success'
        ? 'Checkout completed. Waiting for the verified payment to update your balance.'
        : 'Checking the status of your pending top-up…');
    }
    void jsonRequest<Snapshot>('/api/sandbox').then(next => {
      if (!mounted) return;
      acceptSnapshot(next);
    }).catch(cause => { if (mounted) setError(message(cause)); });
    return () => { mounted = false; };
  }, [acceptSnapshot]);
  useEffect(() => {
    if (restoredCheckout.current) return;
    restoredCheckout.current = true;
    const saved = takeCheckoutResume(accountId);
    if (!saved) return;
    void verifyRecoveryCapsule(saved.capsule).then(verified => {
      setCapsule(saved.capsule); setCommitment(verified.commitment);
      setSelectedAmount(saved.selectedAmount); setActivationAttempted(saved.activationAttempted);
      setStep('fund');
    }).catch(() => setError('Your saved checkout session could not be restored. Import your recovery file to continue.'));
  }, [accountId]);
  const pending = reconcilingActivation || snapshot?.bundles.some(b => b.state === 'unknown' || b.state === 'funding') || bundle?.state === 'unknown' || bundle?.state === 'funding';
  useEffect(() => {
    if (!pending && !checkoutPending) return;
    const timer = window.setInterval(() => void refresh().catch(() => {}), 5000);
    const stop = checkoutPending ? window.setTimeout(() => {
      setCheckoutPending(false); setNotice('If your top-up has not arrived, use Check again in a moment. Payment verification may still be processing.');
    }, 60_000) : undefined;
    return () => { window.clearInterval(timer); if (stop) window.clearTimeout(stop); };
  }, [pending, checkoutPending, refresh]);

  const finish = useCallback(async (file: RecoveryCapsuleFile, metadata: Activation) => {
    if (downloaded.current === metadata.commitment) return;
    const activated = wrapWithActivation(file, metadata);
    try { await verifyActivatedCredential(activated); } catch { throw new CredentialFailure('The activated credential could not be verified locally. Keep your recovery file and check again.'); }
    downloadActivatedCredential(activated);
    downloaded.current = metadata.commitment;
    setActivation(metadata); setStep('active'); setError(null); setReconcilingActivation(false);
    setNotice('Activated credential downloaded and verified locally.');
  }, []);
  useEffect(() => {
    if (!commitment || !snapshot) return;
    const current = snapshot.bundles.find(b => b.commitment === commitment);
    const reconciliation = activationReconciliation.current;
    if (reconcilingActivation && reconciliation && snapshot !== reconciliation.snapshot &&
      (current && current.state !== 'funding' && current.state !== 'unknown' || !current && Date.now() - reconciliation.startedAt >= 15_000)) {
      setReconcilingActivation(false);
      activationReconciliation.current = null;
      setError(null);
      setNotice(current ? null : 'No activation was found. Retry with this recovery file to activate the same bundle.');
    }
    if (!current) return;
    if (current.activation && capsule) void finish(capsule, current.activation).catch(cause => setError(message(cause)));
  }, [commitment, snapshot, capsule, finish, reconcilingActivation]);

  async function topup(amountCents: number) {
    setBusy(true); setTopupAmount(amountCents); setError(null);
    try {
      let requestId = sessionStorage.getItem(`zk-credits:checkout-request:${amountCents}`);
      if (!requestId) { requestId = crypto.randomUUID(); sessionStorage.setItem(`zk-credits:checkout-request:${amountCents}`, requestId); }
      pendingTopup.current = { requestId, amountCents };
      sessionStorage.setItem('zk-credits:checkout-pending', JSON.stringify(pendingTopup.current));
      const result = await jsonRequest<{ url?: string; completed?: boolean }>('/api/sandbox/checkout', { requestId, amountCents });
      if (result.completed) {
        setCheckoutPending(true);
        setNotice('Checkout completed. Waiting for the verified payment to update your balance.');
        await refresh();
      }
      else if (result.url) {
        if (capsule) saveCheckoutResume(accountId, { capsule, selectedAmount, activationAttempted });
        window.location.assign(result.url);
      }
      else throw new Error('checkout_unavailable');
    } catch (cause) {
      clearCheckoutResume();
      if (cause instanceof Error && cause.message === 'checkout_expired') sessionStorage.removeItem(`zk-credits:checkout-request:${amountCents}`);
      setError(message(cause));
    }
    finally { setBusy(false); setTopupAmount(null); }
  }
  async function generate() {
    setBusy(true); setError(null); setNotice(null); setActivationAttempted(false);
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
      if (file.size > 64 * 1024) throw new CredentialFailure('Choose a recovery file smaller than 64 KB.');
      let imported: RecoveryCapsuleFile | ActivatedCredentialFile;
      let verified: { commitment: string };
      try {
        imported = JSON.parse(await file.text()) as RecoveryCapsuleFile | ActivatedCredentialFile;
        verified = imported.kind === 'activated-credential'
          ? await verifyActivatedCredential(imported) : await verifyRecoveryCapsule(imported);
      } catch { throw new CredentialFailure('Choose a valid recovery file. It could not be verified locally.'); }
      const parsed: RecoveryCapsuleFile = { ...imported, kind: 'recovery-capsule' };
      if (step === 'backup' && verified.commitment !== commitment) throw new CredentialFailure('Choose the recovery file you just downloaded.');
      setCapsule(parsed); setCommitment(verified.commitment); downloaded.current = null;
      setBundle(null); setActivation(null); setActivationAttempted(false); setReconcilingActivation(false); setStep('fund'); setNotice('Backup verified locally.');
      const next = await refresh();
      const current = next.bundles.find(b => b.commitment === verified.commitment) ?? null;
      setBundle(current);
      if (current?.activation) await finish(parsed, current.activation);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  async function fund() {
    if (!commitment || !capsule) return;
    setBusy(true); setError(null); setNotice(null); setActivationAttempted(true);
    try {
      const current = await jsonRequest<Bundle>('/api/pilot/funding', { commitment });
      setBundle(current);
      if (current.activation) await finish(capsule, current.activation);
      await refresh().catch(() => {});
    } catch (cause) {
      setError(message(cause));
      if (cause instanceof RequestFailure && cause.ambiguous) {
        activationReconciliation.current = { startedAt: Date.now(), snapshot };
        setReconcilingActivation(true);
        setNotice('Checking your activation. Keep your recovery file; this request will not be sent again while its status is being checked.');
        await refresh().catch(() => {});
      }
    }
    finally { setBusy(false); }
  }
  async function checkAgain() {
    setChecking(true); setError(null);
    try {
      const next = await refresh();
      const response = await jsonRequest<NetworkStatus>('/api/network-status');
      setNetwork(response);
      if (!next.funder) setNotice('The funding service is still unreachable. Your balance and recovery file are safe. Try again shortly or report the issue below.');
    } catch (cause) { setError(message(cause)); }
    finally { setChecking(false); }
  }
  const held = reconcilingActivation || bundle?.state === 'funding' || bundle?.state === 'unknown';

  return <div className="space-y-6">
    <section className={card}>
      <h2 className="text-lg font-semibold text-zinc-100">1. Save your recovery file</h2>
      {(step === 'capsule' || step === 'backup') && <p className="mt-1 text-sm text-zinc-400">Your browser creates the secret. Anyone possessing this recovery file can spend its credits. Keep it private.</p>}
      {step === 'capsule' && <button type="button" onClick={() => void generate()} disabled={busy} className={`${button} mt-4`}>Download recovery file</button>}
      {(step === 'capsule' || step === 'backup') && <div className="mt-4">
        <label htmlFor="capsule-file" className="block text-sm text-zinc-200">{step === 'backup' ? 'Select the file you downloaded to verify your backup' : 'Resume with your recovery file'}</label>
        <input id="capsule-file" type="file" accept="application/json,.json" disabled={busy} onChange={event => void reimport(event.target.files?.[0] ?? null)} className="mt-2 block min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 file:mr-3 file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" />
        <p className="mt-2 text-xs text-zinc-500">Verification stays in your browser. Keep this file for future visits. Your progress is preserved when you return from Stripe.</p>
      </div>}
      {(step === 'fund' || step === 'active') && <p className="mt-2 text-sm text-cyan-200">Recovery file saved and verified.</p>}
      {step === 'capsule' && <a href="/recover" className="mt-3 inline-flex min-h-11 items-center text-sm text-cyan-200 underline focus-visible:ring-2 focus-visible:ring-cyan-200">Restore an existing activated credential</a>}
    </section>

    <section className={card}>
      <h2 className="text-lg font-semibold text-zinc-100">2. Activate 250 credits on Base Sepolia</h2>
      {(step === 'capsule' || step === 'backup') && <p className="mt-2 text-sm text-zinc-400">Save and verify your recovery file to continue.</p>}
      {step === 'fund' && <p className="mt-2 text-sm text-zinc-400">Activation costs $20 in test balance. Your balance is deducted only after Base confirms.</p>}
      {step === 'fund' && <div className="mt-6 border-t border-zinc-800 pt-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h3 className="text-base font-semibold text-zinc-100">Test balance</h3><p className="mt-1 text-sm text-zinc-400">Stripe test payments add simulated dollars. No real money is charged.</p></div>
      </div>
      <fieldset disabled={busy} className="mt-6">
        <legend className="text-sm font-medium text-zinc-300">Choose an amount</legend>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
          {[{ amount: 500, detail: 'Toward a bundle' }, { amount: 2000, detail: '1 bundle' }, { amount: 10000, detail: '5 bundles' }].map(({ amount, detail }) => (
            <label key={amount} className="relative min-w-0 cursor-pointer">
              <input type="radio" name="sandbox-topup-amount" aria-label={`$${amount / 100} sandbox top-up`} checked={selectedAmount === amount} onChange={() => setSelectedAmount(amount)} className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" />
              <span className="flex h-full min-h-32 flex-col sm:min-h-28 rounded-xl border border-zinc-700 bg-zinc-950/40 p-3 transition-colors peer-hover:border-zinc-500 peer-checked:border-cyan-300 peer-checked:bg-cyan-300/10 peer-focus-visible:ring-2 peer-focus-visible:ring-cyan-200 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-zinc-900 peer-disabled:cursor-not-allowed peer-disabled:opacity-50 sm:p-4">
                <span className="flex items-center justify-between gap-1">
                  <span className="font-semibold text-lg text-white tabular-nums sm:text-2xl">${amount / 100}</span>
                  <span aria-hidden="true" className={`absolute bottom-3 right-3 flex h-4 w-4 items-center justify-center rounded-full border sm:bottom-auto sm:right-4 sm:top-5 ${selectedAmount === amount ? 'border-cyan-300 bg-cyan-300 text-zinc-950' : 'border-zinc-600'}`}>
                    {selectedAmount === amount && <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2"><path d="m3 8 3 3 7-7" /></svg>}
                  </span>
                </span>
                <span className="mt-2 text-xs text-zinc-400 sm:text-sm">{detail}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-4 flex justify-center">
        <button type="button" disabled={busy} aria-busy={topupAmount !== null} onClick={() => void topup(selectedAmount)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-zinc-600 bg-zinc-800 px-6 py-3 text-sm font-semibold text-zinc-200 motion-safe:transition-[background-color,color,border-color,box-shadow] hover:border-cyan-300/60 hover:bg-zinc-700 hover:text-cyan-100 hover:shadow-[0_0_20px_var(--color-cyan-300)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-50">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z" /></svg>
          {topupAmount !== null ? 'Opening Stripe test Checkout…' : 'Pay with Stripe'}
        </button>
      </div>
      <dl className="mt-4 flex flex-wrap gap-8 text-sm"><div><dt className="text-zinc-400">Available</dt><dd className="mt-1 font-mono text-xl text-zinc-100 tabular-nums">{snapshot ? usd(snapshot.availableCents) : 'Loading…'}</dd></div><div><dt className="text-zinc-400">Held for funding</dt><dd className="mt-1 font-mono text-xl text-zinc-100 tabular-nums">{snapshot ? usd(snapshot.reservedCents) : '—'}</dd></div></dl>
      <p className="mt-3 text-xs text-zinc-400">$5 adds balance toward a bundle; $20 activates 250 credits; $100 covers five bundles. Use test card 4242 4242 4242 4242, a future expiry, and any CVC.</p>

    </div>}
      {step === 'fund' && <>
        <button type="button" onClick={() => void fund()} disabled={busy || held || !snapshot || snapshot.availableCents < 2000} className={`${button} mt-4`}>{busy ? 'Activating…' : held ? 'Waiting for confirmation…' : activationAttempted && bundle ? 'Retry activation' : 'Activate my credits'}</button>
        {snapshot && snapshot.availableCents < 2000 && !held && <p className="mt-2 text-sm text-amber-200">Top up $20 in sandbox to activate this bundle.</p>}
      </>}
      {(activationAttempted || held) && <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-zinc-700 p-4" role="status">
          <h3 className="text-base font-semibold text-zinc-100">Bundle status</h3>
          <p className="mt-2 text-sm text-zinc-200">Bundle status: <span className="font-semibold">{held ? 'Confirmation pending' : bundle ? statusLabel(bundle.state) : 'No funding transaction found'}</span></p>
          {bundle?.reason && <p className="mt-2 text-sm text-amber-200">{messages[bundle.reason] ?? messages.funder_unavailable}</p>}
          {!bundle && !held && <p className="mt-2 text-sm text-zinc-400">Your recovery file is ready. Check the service connection, then retry activation with this same file.</p>}
          {bundle?.transactionHash && <a className="mt-2 inline-flex min-h-11 items-center break-all text-sm text-cyan-200 underline" href={explorerTransactionUrl(bundle.transactionHash)} target="_blank" rel="noreferrer">View funding transaction</a>}
        </div>
        <div className="rounded-xl border border-zinc-700 p-4">
          <h3 className="text-base font-semibold text-zinc-100">Funding contract status</h3>
          <p className="mt-2 text-sm text-zinc-300">Base Sepolia · {network?.healthy ? 'Contract reachable' : 'Contract connection unavailable'}</p>
          {network?.contractAddress && <a href={`${BASE_SEPOLIA_EXPLORER}/address/${network.contractAddress}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-11 items-center text-sm text-cyan-200 underline">View credit contract</a>}
          {snapshot?.funder ? <>
            <p className="mt-2 text-sm text-zinc-200">Shared funder: {snapshot.funder.ready ? 'Ready' : 'Needs attention'}</p>
            {snapshot.funder.reason && snapshot.funder.reason !== bundle?.reason && <p className="mt-2 text-sm text-amber-200">{messages[snapshot.funder.reason] ?? messages.funder_unavailable}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-3"><a href={`${BASE_SEPOLIA_EXPLORER}/address/${snapshot.funder.address}`} className="min-w-0 break-all font-mono text-xs text-cyan-200 underline" target="_blank" rel="noreferrer">{snapshot.funder.address}</a><button type="button" className="min-h-11 text-sm text-cyan-200 underline focus-visible:ring-2 focus-visible:ring-cyan-200" onClick={() => void navigator.clipboard.writeText(snapshot.funder!.address).then(() => setNotice('Funder address copied.')).catch(() => setError('Copy the displayed funder address.'))}>Copy funder address</button></div>
            <p className="mt-2 font-mono text-sm text-zinc-300 tabular-nums">{usdc(snapshot.funder.usdcBalance)} test USDC available · 20 needed</p>
            {snapshot.funder.allowance !== undefined && <p className="mt-2 text-xs text-zinc-400">USDC allowance: {usdc(snapshot.funder.allowance)} · prepared automatically during activation</p>}
            {snapshot.funder.gasBalanceWei !== undefined && <p className="mt-2 text-xs text-zinc-400">Gas: {BigInt(snapshot.funder.gasBalanceWei) > 0n ? 'ETH available' : 'Needs test ETH'}</p>}
            {(bundle?.reason === 'insufficient_usdc' || snapshot.funder.reason === 'insufficient_usdc') && snapshot.funder.faucetUrl && <><a href={snapshot.funder.faucetUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center text-sm text-cyan-200 underline">Get Base Sepolia USDC from the faucet</a><p className="mt-2 text-xs text-zinc-400">Send test USDC to the funder address above, then check again and retry. This replenishes the shared pool; it does not add Stripe balance.</p></>}
          </> : <p className="mt-2 text-sm text-amber-200">The shared funder could not be checked. Use Check again to reconnect. Adding more Stripe balance will not fix this connection.</p>}
          <div className="mt-3 flex flex-wrap gap-4">
            <button type="button" disabled={checking || busy} aria-busy={checking} onClick={() => void checkAgain()} className="min-h-11 text-sm text-cyan-200 underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:opacity-50">{checking ? 'Checking…' : 'Check again'}</button>
            <a href="https://github.com/mangekyou-labs/haze-api/issues/new?title=Base%20Sepolia%20activation%20unavailable" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm text-zinc-300 underline focus-visible:ring-2 focus-visible:ring-cyan-200">Report activation issue</a>
          </div>
        </div>
      </div>}
      {step === 'fund' && !activationAttempted && !held && (error || !snapshot || checkoutPending || Boolean(pendingTopup.current)) && <button type="button" disabled={checking || busy} onClick={() => void checkAgain()} className="mt-3 block min-h-11 text-sm text-cyan-200 underline focus-visible:ring-2 focus-visible:ring-cyan-200">{checking ? 'Checking…' : 'Check again'}</button>}
      {activation && <div className="mt-4 text-sm text-emerald-200"><p>Activated credential verified locally · 250 private calls · expires {formatDate(activation.expiry)}</p><button className="mt-3 min-h-11 underline" type="button" onClick={() => { if (capsule) downloadActivatedCredential(wrapWithActivation(capsule, activation)); }}>Download activated credential again</button></div>}
    </section>


    <section className={card}>
      <h2 className="text-lg font-semibold text-zinc-100">3. Connect Codex</h2>
      {step !== 'active' && <p className="mt-2 text-sm text-zinc-400">Activate your credits to unlock the setup instructions.</p>}
      {step === 'active' && <>
      <p className="mt-2 text-sm text-zinc-400">Use the activated credential. The npm package handles proving files, Base RPC, and client configuration.</p>
      <pre className="mt-4 overflow-x-auto rounded-lg bg-zinc-950 p-4 text-xs leading-6 text-zinc-200"><code>{'npm install --global zk-credits\nZK_CREDITS_CREDENTIAL_PATH=/path/to/activated-credential.json zk-credits setup codex\nzk-credits codex'}</code></pre>
      <p className="mt-3 text-sm text-zinc-400">Ask Codex to fix a failing test in your project. It can use several paid model calls while editing and checking the result.</p>
      <a href="https://github.com/mangekyou-labs/haze-api/blob/main/docs/onboarding/base-zk-credits-codex-first-use.md" target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center text-sm text-cyan-200 underline">Open the setup guide</a>
      <p className="mt-2 break-all text-xs text-zinc-500">Gateway: {gatewayBaseUrl}</p>
      </>}
    </section>
    <p className="text-xs text-zinc-500">{networkLoading ? 'Checking contract status…' : `${network?.healthy ? 'Contract reachable' : 'Contract status unavailable'} · Base Sepolia testnet`}</p>
    {notice && <p role="status" className="rounded-xl border border-emerald-300/20 bg-emerald-300/5 p-4 text-sm text-emerald-100">{notice}</p>}
    {error && <p role="alert" className="rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
  </div>;
}
function statusLabel(state: Bundle['state']) {
  return { funding: 'Funding', unknown: 'Confirmation pending', funded: 'Funded', waiting_funds: 'Waiting for test USDC', failed: 'Failed — safe to retry' }[state];
}
