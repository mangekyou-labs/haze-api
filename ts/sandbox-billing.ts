import { randomUUID } from 'node:crypto';
import { FundingPreBroadcastError, normalizeCommitment } from './pilot-funding.js';

export const SANDBOX_BUNDLE_PRICE_CENTS = 2000;
export const SANDBOX_TOPUP_AMOUNTS_CENTS = [500, 2000, 10000] as const;
const LEASE_MS = 120_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const HASH = /^0x[0-9a-f]{64}$/iu;

export class SandboxError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}
export class FundingRevertedError extends Error {}

export interface SandboxTopup {
  id: string; requestId: string; amountCents: number; sessionId: string | null; paid: boolean;
}
export interface SandboxBundle {
  commitment: string;
  state: 'funding' | 'unknown' | 'funded' | 'waiting_funds' | 'failed';
  attemptId: string; startedAt: number; reserved: boolean;
  transactionHash: string | null; expiry: number | null; fundedAt: number | null; reason: string | null;
}
export interface SandboxAccount {
  balanceCents: number; reservedCents: number; topups: SandboxTopup[]; bundles: SandboxBundle[];
}
export interface SandboxStore {
  transaction<T>(accountId: string, change: (account: SandboxAccount) => T): Promise<T>;
  topupOwner(id: string): Promise<string | undefined>;
  bundleOwner(commitment: string): Promise<string | undefined>;
}
export interface SandboxFunderStatus {
  address: string; tokenAddress: string; usdcBalance: string; gasBalanceWei: string;
  allowance: string; ready: boolean; reason: string | null; faucetUrl: string;
}
export interface SandboxSponsor {
  status(): Promise<SandboxFunderStatus>;
  fund(commitment: string, onBroadcast: (hash: string) => Promise<void>): Promise<{ transactionHash: string; expiry: number }>;
  reconcile(commitment: string, hash: string | null): Promise<
    { state: 'funded'; transactionHash: string; expiry: number } | { state: 'reverted' } | undefined>;
}

export class SandboxBillingService {
  constructor(private readonly options: { store: SandboxStore; sponsor: SandboxSponsor; contractAddress: string; now?: () => number }) {}
  private now() { return this.options.now?.() ?? Date.now(); }

  async createTopup(accountId: string, requestId: string, amountCents: number = SANDBOX_BUNDLE_PRICE_CENTS) {
    if (!(SANDBOX_TOPUP_AMOUNTS_CENTS as readonly number[]).includes(amountCents)) throw new SandboxError('invalid_topup_amount');
    if (!UUID.test(requestId)) throw new SandboxError('invalid_request_id');
    return this.options.store.transaction(accountId, account => {
      let topup = account.topups.find(t => t.requestId === requestId);
      if (topup && topup.amountCents !== amountCents) throw new SandboxError('topup_amount_conflict', 409);
      if (!topup) {
        topup = { id: randomUUID(), requestId, amountCents, sessionId: null, paid: false };
        account.topups.push(topup);
      }
      return { ...topup };
    });
  }

  async bindSession(accountId: string, topupId: string, sessionId: string) {
    if (!/^cs_test_[A-Za-z0-9]+$/u.test(sessionId)) throw new SandboxError('invalid_test_session');
    await this.options.store.transaction(accountId, account => {
      const topup = account.topups.find(t => t.id === topupId);
      if (!topup) throw new SandboxError('topup_not_found', 404);
      if (topup.sessionId && topup.sessionId !== sessionId) throw new SandboxError('topup_session_conflict', 409);
      topup.sessionId = sessionId;
    });
  }

  /** Called only after the web server verifies the raw Stripe webhook signature.
   * Session binding, not event ID, is the credit-once key. */
  async creditTopup(event: { topupId: string; sessionId: string; livemode: boolean; mode: string; paymentStatus: string; currency: string; amountTotal: number }) {
    if (!UUID.test(event.topupId) || event.livemode !== false || event.mode !== 'payment' || event.paymentStatus !== 'paid'
      || event.currency !== 'usd' || !(SANDBOX_TOPUP_AMOUNTS_CENTS as readonly number[]).includes(event.amountTotal)) throw new SandboxError('invalid_sandbox_payment');
    const owner = await this.options.store.topupOwner(event.topupId);
    if (!owner) throw new SandboxError('topup_not_found', 404);
    await this.options.store.transaction(owner, account => {
      const topup = account.topups.find(t => t.id === event.topupId)!;
      if (event.amountTotal !== topup.amountCents) throw new SandboxError('invalid_sandbox_payment');
      if (!topup.sessionId) throw new SandboxError('topup_session_not_bound', 409); // webhook retries after Checkout binding
      if (topup.sessionId !== event.sessionId) throw new SandboxError('topup_session_conflict', 409);
      if (!topup.paid) { account.balanceCents += topup.amountCents; topup.paid = true; }
    });
  }

  private async changeBundle(accountId: string, commitment: string, attemptId: string, change: (bundle: SandboxBundle, account: SandboxAccount) => void) {
    return this.options.store.transaction(accountId, account => {
      const bundle = account.bundles.find(b => b.commitment === commitment);
      if (!bundle) throw new SandboxError('bundle_not_found', 404);
      if (bundle.attemptId === attemptId && bundle.state !== 'funded') change(bundle, account);
      return { ...bundle };
    });
  }

  private async confirm(accountId: string, bundle: SandboxBundle, result: { transactionHash: string; expiry: number }) {
    if (!HASH.test(result.transactionHash) || !Number.isSafeInteger(result.expiry) || result.expiry <= 0) throw new Error('invalid_funding_result');
    return this.changeBundle(accountId, bundle.commitment, bundle.attemptId, (current, account) => {
      if (!current.reserved) throw new Error('funding_reservation_missing');
      account.balanceCents -= SANDBOX_BUNDLE_PRICE_CENTS;
      account.reservedCents -= SANDBOX_BUNDLE_PRICE_CENTS;
      Object.assign(current, result, { state: 'funded', reserved: false, fundedAt: this.now(), reason: null });
    });
  }

  private async fail(accountId: string, bundle: SandboxBundle, reason: string, waiting = false) {
    return this.changeBundle(accountId, bundle.commitment, bundle.attemptId, (current, account) => {
      if (current.reserved) account.reservedCents -= SANDBOX_BUNDLE_PRICE_CENTS;
      current.reserved = false; current.state = waiting ? 'waiting_funds' : 'failed'; current.reason = reason;
    });
  }

  async fund(accountId: string, rawCommitment: string) {
    let commitment: string;
    try { commitment = normalizeCommitment(rawCommitment); } catch { throw new SandboxError('invalid_commitment'); }
    const owner = await this.options.store.bundleOwner(commitment);
    if (owner && owner !== accountId) throw new SandboxError('commitment_already_owned', 409);
    const claim = await this.options.store.transaction(accountId, account => {
      let bundle = account.bundles.find(b => b.commitment === commitment);
      if (bundle && ['funding', 'unknown', 'funded'].includes(bundle.state)) return { claimed: false, bundle: { ...bundle } };
      if (account.balanceCents - account.reservedCents < SANDBOX_BUNDLE_PRICE_CENTS) throw new SandboxError('insufficient_sandbox_balance', 409);
      account.reservedCents += SANDBOX_BUNDLE_PRICE_CENTS;
      const attempt: SandboxBundle = { commitment, state: 'funding', attemptId: randomUUID(), startedAt: this.now(), reserved: true, transactionHash: null, expiry: null, fundedAt: null, reason: null };
      if (bundle) Object.assign(bundle, attempt);
      else { bundle = attempt; account.bundles.push(bundle); }
      return { claimed: true, bundle: { ...bundle } };
    });
    if (!claim.claimed) return this.view(claim.bundle);
    let broadcast = false;
    try {
      const status = await this.options.sponsor.status().catch(error => {
        if (error instanceof FundingPreBroadcastError) throw error;
        throw new FundingPreBroadcastError('funder_unavailable');
      });
      if (!status.ready) throw new FundingPreBroadcastError(status.reason ?? 'funder_unavailable');
      const result = await this.options.sponsor.fund(commitment, async hash => {
        broadcast = true; // even a failed database write must never release a possibly broadcast attempt
        if (!HASH.test(hash)) throw new Error('invalid_transaction_hash');
        await this.changeBundle(accountId, commitment, claim.bundle.attemptId, bundle => { bundle.transactionHash = hash; });
      });
      return this.view(await this.confirm(accountId, claim.bundle, result));
    } catch (error) {
      if (error instanceof FundingRevertedError) return this.view(await this.fail(accountId, claim.bundle, 'transaction_reverted'));
      if (error instanceof FundingPreBroadcastError && !broadcast) {
        const reason = ['insufficient_usdc', 'insufficient_gas', 'insufficient_allowance', 'sponsor_not_configured', 'sponsor_mismatch', 'wrong_chain', 'preflight_failed', 'sponsor_pending', 'unsupported_tier', 'unsupported_token', 'approval_pending', 'approval_failed'].includes(error.message) ? error.message : 'funder_unavailable';
        return this.view(await this.fail(accountId, claim.bundle, reason, reason === 'insufficient_usdc'));
      }
      // RPC/receipt/database failures can leave a mined transaction. Hold funds.
      return this.view(await this.changeBundle(accountId, commitment, claim.bundle.attemptId, bundle => {
        bundle.state = 'unknown'; bundle.reason = 'confirmation_pending';
      }));
    }
  }

  private async reconcile(accountId: string, bundle: SandboxBundle) {
    if (bundle.state !== 'unknown' && !(bundle.state === 'funding' && bundle.startedAt + LEASE_MS <= this.now())) return;
    const result = await this.options.sponsor.reconcile(bundle.commitment, bundle.transactionHash);
    if (result?.state === 'funded') await this.confirm(accountId, bundle, result);
    else if (result?.state === 'reverted') await this.fail(accountId, bundle, 'transaction_reverted');
    else await this.changeBundle(accountId, bundle.commitment, bundle.attemptId, current => { current.state = 'unknown'; current.reason = 'confirmation_pending'; });
  }

  private view(bundle: SandboxBundle) {
    const { attemptId: _attempt, reserved: _reserved, ...publicBundle } = bundle;
    return { ...publicBundle, priceCents: SANDBOX_BUNDLE_PRICE_CENTS, allowance: 250,
      activation: bundle.state === 'funded' ? { commitment: bundle.commitment, network: 'eip155:84532', chainId: 84532,
        contractAddress: this.options.contractAddress, deploymentDomain: '84532', tierId: 0, expiry: bundle.expiry!, transactionHash: bundle.transactionHash!, fundedAt: bundle.fundedAt! } : null };
  }

  async snapshot(accountId: string) {
    const pending = await this.options.store.transaction(accountId, account => account.bundles.map(b => ({ ...b })));
    // Receipt/RPC failures leave pending state intact and must not hide the account balance.
    for (const bundle of pending) { try { await this.reconcile(accountId, bundle); } catch { /* next status request retries reconciliation */ } }
    const account = await this.options.store.transaction(accountId, current => structuredClone(current));
    let funder: SandboxFunderStatus | null = null;
    try { funder = await this.options.sponsor.status(); } catch { /* readiness unavailable */ }
    return { balanceCents: account.balanceCents, reservedCents: account.reservedCents, availableCents: account.balanceCents - account.reservedCents,
      bundlePriceCents: SANDBOX_BUNDLE_PRICE_CENTS, topups: account.topups.map(({ requestId, amountCents, paid }) => ({ requestId, amountCents, paid })), bundles: account.bundles.map(b => this.view(b)).sort((a, b) => b.startedAt - a.startedAt), funder };
  }

  async publicBundle(rawCommitment: string) {
    const commitment = normalizeCommitment(rawCommitment);
    const owner = await this.options.store.bundleOwner(commitment);
    if (!owner) return undefined;
    return this.options.store.transaction(owner, account => {
      const bundle = account.bundles.find(b => b.commitment === commitment);
      return bundle?.state === 'funded' ? this.view(bundle).activation! : undefined;
    });
  }
}
