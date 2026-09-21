/**
 * Stripe-only purchase control plane. Stripe metadata contains only the
 * opaque order id; the commitment mapping remains in this control-plane
 * store and never enters the x402 spend plane.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createHash, randomBytes } from 'node:crypto';
import { BN254_FIELD_ORDER } from '@zk-credits/shared';
import { MemoryBillingStore, type BillingStore } from './db/billing.js';
import type { Pool } from 'pg';

export type TierId = 0 | 1 | 2;
export type OrderStatus =
  | 'pending'
  | 'paid_pending_sponsorship'
  | 'sponsoring'
  | 'funded'
  | 'release_pending'
  | 'refunded'
  | 'refund_pending'
  | 'slashed'
  | 'chargeback';

export interface BundleTier {
  tierId: TierId;
  allowance: number;
  serviceFeeCents: number;
  bondCents: number;
  totalCents: number;
  durationSeconds: number;
  challengeSeconds: number;
}

export const BUNDLE_TIERS: readonly BundleTier[] = Object.freeze([
  { tierId: 0, allowance: 5_000, serviceFeeCents: 500, bondCents: 500, totalCents: 1_000, durationSeconds: 30 * 24 * 60 * 60, challengeSeconds: 7 * 24 * 60 * 60 },
  { tierId: 1, allowance: 25_000, serviceFeeCents: 2_000, bondCents: 2_000, totalCents: 4_000, durationSeconds: 30 * 24 * 60 * 60, challengeSeconds: 7 * 24 * 60 * 60 },
  { tierId: 2, allowance: 75_000, serviceFeeCents: 5_000, bondCents: 5_000, totalCents: 10_000, durationSeconds: 30 * 24 * 60 * 60, challengeSeconds: 7 * 24 * 60 * 60 },
]);

export interface OrderRecord {
  orderId: string;
  tierId: TierId;
  /** GitHub subject from the control plane; never returned to the browser. */
  accountId: string;
  // This field is control-plane-only and is never returned by public status.
  commitment: string;
  status: OrderStatus;
  createdAt: number;
  paidAt?: number;
  fundedAt?: number;
  expiryAt?: number;
  challengeEndsAt?: number;
  sponsorshipStartedAt?: number;
  stripeSessionId?: string;
  fundingTransaction?: string;
  bondReleaseTransaction?: string;
  refundTransaction?: string;
  refundAttempts: number;
  lastError?: string;
}

export interface PublicOrderStatus {
  orderId: string;
  tierId: TierId;
  allowance: number;
  serviceFeeCents: number;
  bondCents: number;
  status: OrderStatus;
  expiresAt: number | null;
  challengeEndsAt: number | null;
  fundingTransaction: string | null;
  bondReleaseTransaction: string | null;
  refundTransaction: string | null;
}

export interface OrderStore {
  create(order: OrderRecord): Promise<void>;
  get(orderId: string): Promise<OrderRecord | undefined>;
  update(orderId: string, update: Partial<OrderRecord>): Promise<OrderRecord>;
  list(): Promise<OrderRecord[]>;
  /** Atomically claims a checkout for sponsorship, including stale recovery. */
  claimCheckout?(orderId: string, update: Partial<OrderRecord>, now: number): Promise<{ claimed: boolean; order: OrderRecord }>;
  hasChargeback?(accountId: string): Promise<boolean>;
}

export class MemoryOrderStore implements OrderStore {
  private readonly orders = new Map<string, OrderRecord>();
  async create(order: OrderRecord): Promise<void> {
    if (this.orders.has(order.orderId)) throw new Error('order_already_exists');
    this.orders.set(order.orderId, { ...order });
  }
  async get(orderId: string): Promise<OrderRecord | undefined> {
    const order = this.orders.get(orderId);
    return order ? { ...order } : undefined;
  }
  async update(orderId: string, update: Partial<OrderRecord>): Promise<OrderRecord> {
    const current = this.orders.get(orderId);
    if (!current) throw new Error('order_not_found');
    const next = { ...current, ...update };
    this.orders.set(orderId, next);
    return { ...next };
  }
  async list(): Promise<OrderRecord[]> {
    return [...this.orders.values()].map((order) => ({ ...order }));
  }

  async claimCheckout(orderId: string, update: Partial<OrderRecord>, now: number): Promise<{ claimed: boolean; order: OrderRecord }> {
    const current = this.orders.get(orderId);
    if (!current) throw new Error('order_not_found');
    const staleSponsorship = current.status === 'sponsoring'
      && (current.sponsorshipStartedAt === undefined || current.sponsorshipStartedAt + 5 * 60 * 1000 <= now);
    const claimable = current.status === 'pending' || current.status === 'paid_pending_sponsorship' || staleSponsorship;
    if (!claimable) return { claimed: false, order: { ...current } };
    const next: OrderRecord = {
      ...current,
      ...update,
      status: 'sponsoring',
      sponsorshipStartedAt: now,
      paidAt: current.paidAt ?? update.paidAt,
      expiryAt: current.expiryAt ?? update.expiryAt,
      challengeEndsAt: current.challengeEndsAt ?? update.challengeEndsAt,
      stripeSessionId: current.stripeSessionId ?? update.stripeSessionId,
    };
    this.orders.set(orderId, next);
    return { claimed: true, order: { ...next } };
  }

  async hasChargeback(accountId: string): Promise<boolean> {
    return [...this.orders.values()].some((order) => order.accountId === accountId && order.status === 'chargeback');
  }
}

function dateMillis(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const millis = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(millis) ? millis : undefined;
}

function nullableString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function rowToOrder(row: Record<string, unknown>): OrderRecord {
  const order: OrderRecord = {
    orderId: String(row.order_id),
    tierId: Number(row.tier_id) as TierId,
    accountId: String(row.account_id),
    commitment: String(row.commitment),
    status: String(row.status) as OrderStatus,
    createdAt: dateMillis(row.created_at) ?? 0,
    refundAttempts: Number(row.refund_attempts ?? 0),
  };
  const optionalNumbers: Array<[keyof Pick<OrderRecord, 'paidAt' | 'fundedAt' | 'expiryAt' | 'challengeEndsAt' | 'sponsorshipStartedAt'>, string]> = [
    ['paidAt', 'paid_at'],
    ['fundedAt', 'funded_at'],
    ['expiryAt', 'expiry_at'],
    ['challengeEndsAt', 'challenge_ends_at'],
    ['sponsorshipStartedAt', 'sponsorship_started_at'],
  ];
  for (const [property, column] of optionalNumbers) {
    const value = dateMillis(row[column]);
    if (value !== undefined) order[property] = value;
  }
  const optionalStrings: Array<[keyof Pick<OrderRecord, 'stripeSessionId' | 'fundingTransaction' | 'bondReleaseTransaction' | 'refundTransaction' | 'lastError'>, string]> = [
    ['stripeSessionId', 'stripe_session_id'],
    ['fundingTransaction', 'funding_transaction'],
    ['bondReleaseTransaction', 'bond_release_transaction'],
    ['refundTransaction', 'refund_transaction'],
    ['lastError', 'last_error'],
  ];
  for (const [property, column] of optionalStrings) {
    const value = nullableString(row[column]);
    if (value !== undefined) order[property] = value;
  }
  return order;
}

const ORDER_COLUMNS: Record<string, string> = {
  orderId: 'order_id',
  tierId: 'tier_id',
  accountId: 'account_id',
  commitment: 'commitment',
  status: 'status',
  createdAt: 'created_at',
  paidAt: 'paid_at',
  fundedAt: 'funded_at',
  expiryAt: 'expiry_at',
  challengeEndsAt: 'challenge_ends_at',
  sponsorshipStartedAt: 'sponsorship_started_at',
  stripeSessionId: 'stripe_session_id',
  fundingTransaction: 'funding_transaction',
  bondReleaseTransaction: 'bond_release_transaction',
  refundTransaction: 'refund_transaction',
  refundAttempts: 'refund_attempts',
  lastError: 'last_error',
};

function dbValue(property: string, value: unknown): unknown {
  if (value === undefined) return null;
  if (property.endsWith('At')) return new Date(value as number);
  return value;
}

/** Durable control-plane order store. It never shares a table with claims. */
export class PostgresOrderStore implements OrderStore {
  constructor(private readonly pool: Pool) {}

  async create(order: OrderRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO billing.private_credit_orders
       (order_id, tier_id, account_id, commitment, status, created_at, paid_at,
        funded_at, expiry_at, challenge_ends_at, sponsorship_started_at,
        stripe_session_id, funding_transaction, bond_release_transaction,
        refund_transaction, refund_attempts, last_error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [order.orderId, order.tierId, order.accountId, order.commitment, order.status, new Date(order.createdAt),
        order.paidAt === undefined ? null : new Date(order.paidAt), order.fundedAt === undefined ? null : new Date(order.fundedAt),
        order.expiryAt === undefined ? null : new Date(order.expiryAt), order.challengeEndsAt === undefined ? null : new Date(order.challengeEndsAt),
        order.sponsorshipStartedAt === undefined ? null : new Date(order.sponsorshipStartedAt), order.stripeSessionId ?? null,
        order.fundingTransaction ?? null, order.bondReleaseTransaction ?? null, order.refundTransaction ?? null,
        order.refundAttempts, order.lastError ?? null],
    );
  }

  async get(orderId: string): Promise<OrderRecord | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM billing.private_credit_orders WHERE order_id = $1`,
      [orderId],
    );
    return result.rows[0] ? rowToOrder(result.rows[0] as Record<string, unknown>) : undefined;
  }

  async update(orderId: string, update: Partial<OrderRecord>): Promise<OrderRecord> {
    const entries = Object.entries(update).filter(([property]) => property in ORDER_COLUMNS);
    if (entries.length === 0) {
      const existing = await this.get(orderId);
      if (!existing) throw new Error('order_not_found');
      return existing;
    }
    const params: unknown[] = [orderId];
    const assignments = entries.map(([property, value], index) => {
      params.push(dbValue(property, value));
      return `${ORDER_COLUMNS[property]} = $${index + 2}`;
    });
    const result = await this.pool.query(
      `UPDATE billing.private_credit_orders SET ${assignments.join(', ')} WHERE order_id = $1 RETURNING *`,
      params,
    );
    if (!result.rows[0]) throw new Error('order_not_found');
    return rowToOrder(result.rows[0] as Record<string, unknown>);
  }

  async list(): Promise<OrderRecord[]> {
    const result = await this.pool.query(`SELECT * FROM billing.private_credit_orders ORDER BY created_at ASC`);
    return result.rows.map((row) => rowToOrder(row as Record<string, unknown>));
  }

  async claimCheckout(orderId: string, update: Partial<OrderRecord>, now: number): Promise<{ claimed: boolean; order: OrderRecord }> {
    const paidAt = update.paidAt ?? now;
    const expiryAt = update.expiryAt ?? now;
    const challengeEndsAt = update.challengeEndsAt ?? expiryAt;
    const sessionId = update.stripeSessionId ?? null;
    const result = await this.pool.query(
      `UPDATE billing.private_credit_orders
          SET status = 'sponsoring',
              paid_at = COALESCE(paid_at, to_timestamp($2 / 1000.0)),
              expiry_at = COALESCE(expiry_at, to_timestamp($3 / 1000.0)),
              challenge_ends_at = COALESCE(challenge_ends_at, to_timestamp($4 / 1000.0)),
              stripe_session_id = COALESCE(stripe_session_id, $5),
              sponsorship_started_at = to_timestamp($6 / 1000.0),
              last_error = NULL
        WHERE order_id = $1
          AND (status IN ('pending', 'paid_pending_sponsorship')
               OR (status = 'sponsoring' AND (sponsorship_started_at IS NULL OR sponsorship_started_at <= to_timestamp(($6 - 300000) / 1000.0))))
        RETURNING *`,
      [orderId, paidAt, expiryAt, challengeEndsAt, sessionId, now],
    );
    if (result.rows[0]) return { claimed: true, order: rowToOrder(result.rows[0] as Record<string, unknown>) };
    const existing = await this.get(orderId);
    if (!existing) throw new Error('order_not_found');
    return { claimed: false, order: existing };
  }

  async hasChargeback(accountId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT EXISTS (SELECT 1 FROM billing.private_credit_orders WHERE account_id = $1 AND status = 'chargeback') AS blocked`,
      [accountId],
    );
    return Boolean(result.rows[0]?.blocked);
  }
}

export interface BaseBondSponsor {
  /** expiryAt is the exact on-chain BundleFunded expiry in Unix milliseconds. */
  fundBundle(commitment: string, tierId: TierId): Promise<{ transaction: string; expiryAt?: number }>;
  releaseBond(commitment: string): Promise<{ transaction: string }>;
}

export interface StripeRefundService {
  refundBond(sessionId: string, amountCents: number, idempotencyKey: string): Promise<{ refundId: string }>;
}

export interface StripeWebhookInput {
  eventId: string;
  eventType: string;
  orderId?: string;
  sessionId?: string;
  amountTotalCents?: number;
  currency?: string;
}

/** Public chain events used to repair control-plane state after a crash. */
export interface BaseBondChainEvent {
  eventName: string;
  args: Record<string, string>;
  transactionHash: string;
  blockNumber?: bigint;
  logIndex?: number;
}

function tierFor(tierId: TierId): BundleTier {
  const tier = BUNDLE_TIERS.find((candidate) => candidate.tierId === tierId);
  if (!tier) throw new Error('invalid_tier');
  return tier;
}

function assertCommitment(commitment: string): string {
  if (!/^\d+$/u.test(commitment)) throw new Error('invalid_commitment');
  const value = BigInt(commitment);
  if (value < 0n || value >= BN254_FIELD_ORDER) throw new Error('invalid_commitment');
  return value.toString();
}

function commitmentFromChain(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const commitment = BigInt(value);
    if (commitment < 0n || commitment >= BN254_FIELD_ORDER) return undefined;
    return commitment.toString();
  } catch {
    return undefined;
  }
}

function expiryMillisFromChain(value: string | undefined): number | undefined {
  if (!value) return undefined;
  try {
    const seconds = BigInt(value);
    const millis = seconds * 1000n;
    const number = Number(millis);
    return Number.isSafeInteger(number) && number > 0 ? number : undefined;
  } catch {
    return undefined;
  }
}

function opaqueOrderId(): string {
  return `ord_${randomBytes(18).toString('base64url')}`;
}

function safeStatus(order: OrderRecord): PublicOrderStatus {
  const tier = tierFor(order.tierId);
  return {
    orderId: order.orderId,
    tierId: order.tierId,
    allowance: tier.allowance,
    serviceFeeCents: tier.serviceFeeCents,
    bondCents: tier.bondCents,
    status: order.status,
    expiresAt: order.expiryAt ?? null,
    challengeEndsAt: order.challengeEndsAt ?? null,
    fundingTransaction: order.fundingTransaction ?? null,
    bondReleaseTransaction: order.bondReleaseTransaction ?? null,
    refundTransaction: order.refundTransaction ?? null,
  };
}

export interface StripeBillingOptions {
  orderStore?: OrderStore;
  billingStore?: BillingStore;
  sponsor?: BaseBondSponsor;
  refunds?: StripeRefundService;
  now?: () => number;
}

export class StripeBillingService {
  readonly orders: OrderStore;
  readonly billing: BillingStore;
  private readonly sponsor?: BaseBondSponsor;
  private readonly refunds?: StripeRefundService;
  private readonly now: () => number;

  constructor(options: StripeBillingOptions = {}) {
    this.orders = options.orderStore ?? new MemoryOrderStore();
    this.billing = options.billingStore ?? new MemoryBillingStore();
    this.sponsor = options.sponsor;
    this.refunds = options.refunds;
    this.now = options.now ?? Date.now;
  }

  async createOrder(input: { tierId: TierId; commitment: string; accountId?: string; orderId?: string }): Promise<PublicOrderStatus> {
    const tier = tierFor(input.tierId);
    const accountId = input.accountId?.trim() || 'unbound';
    const blocked = this.orders.hasChargeback
      ? await this.orders.hasChargeback(accountId)
      : (await this.orders.list()).some((existing) => existing.accountId === accountId && existing.status === 'chargeback');
    if (blocked) throw new Error('account_purchase_blocked');
    const order: OrderRecord = {
      orderId: input.orderId ?? opaqueOrderId(),
      tierId: input.tierId,
      accountId,
      commitment: assertCommitment(input.commitment),
      status: 'pending',
      createdAt: this.now(),
      refundAttempts: 0,
    };
    await this.orders.create(order);
    void tier;
    return safeStatus(order);
  }

  async getPublicStatus(orderId: string, accountId?: string): Promise<PublicOrderStatus | undefined> {
    const order = await this.orders.get(orderId);
    if (order && accountId && order.accountId !== accountId) return undefined;
    return order ? safeStatus(order) : undefined;
  }

  async handleWebhook(input: StripeWebhookInput): Promise<{ duplicate: boolean; status: PublicOrderStatus | null }> {
    if (!input.eventId || input.eventId.length > 255) throw new Error('invalid_event_id');
    const payloadHash = createHash('sha256').update(JSON.stringify({ ...input, orderId: input.orderId })).digest('hex');
    const recorded = await this.billing.recordStripeEventOnce(input.eventId, input.eventType, payloadHash);
    if (!recorded.inserted && recorded.event.payloadHash !== payloadHash) throw new Error('stripe_event_payload_mismatch');
    if (!recorded.inserted && recorded.event.processed) {
      const existing = input.orderId ? await this.getPublicStatus(input.orderId) : undefined;
      return { duplicate: true, status: existing ?? null };
    }

    if (input.eventType === 'chargeback.created' || input.eventType === 'charge.dispute.created') {
      if (input.orderId) await this.orders.update(input.orderId, { status: 'chargeback', lastError: undefined });
      await this.billing.markStripeEventProcessed(input.eventId);
      return { duplicate: false, status: input.orderId ? await this.getPublicStatus(input.orderId) ?? null : null };
    }

    if (input.eventType !== 'checkout.session.completed') {
      await this.billing.markStripeEventProcessed(input.eventId);
      return { duplicate: false, status: null };
    }
    if (!input.orderId || !input.sessionId || input.amountTotalCents === undefined) throw new Error('checkout_event_missing_order');
    const order = await this.orders.get(input.orderId);
    if (!order) throw new Error('order_not_found');
    const tier = tierFor(order.tierId);
    if (input.amountTotalCents !== tier.totalCents || (input.currency && input.currency !== 'usd')) throw new Error('checkout_amount_mismatch');
    const paidAt = this.now();
    const expiryAt = paidAt + tier.durationSeconds * 1000;
    const challengeEndsAt = expiryAt + tier.challengeSeconds * 1000;
    const claimed = this.orders.claimCheckout
      ? await this.orders.claimCheckout(input.orderId, { paidAt, expiryAt, challengeEndsAt, stripeSessionId: input.sessionId }, paidAt)
      : await this.claimCheckoutFallback(input.orderId, { paidAt, expiryAt, challengeEndsAt, stripeSessionId: input.sessionId }, paidAt);
    if (!claimed.claimed) {
      if (claimed.order.status === 'funded' || claimed.order.status === 'refunded' || claimed.order.status === 'slashed' || claimed.order.status === 'chargeback') {
        await this.billing.markStripeEventProcessed(input.eventId);
        return { duplicate: false, status: safeStatus(claimed.order) };
      }
      throw new Error('sponsorship_in_progress');
    }
    if (!this.sponsor) {
      await this.orders.update(input.orderId, { status: 'paid_pending_sponsorship', sponsorshipStartedAt: undefined, lastError: 'sponsor_not_configured' });
      throw new Error('sponsor_not_configured');
    }
    try {
      const funded = await this.sponsor.fundBundle(claimed.order.commitment, claimed.order.tierId);
      const exactExpiryAt = funded.expiryAt ?? claimed.order.expiryAt;
      const exactChallengeEndsAt = exactExpiryAt === undefined
        ? claimed.order.challengeEndsAt
        : exactExpiryAt + tier.challengeSeconds * 1000;
      await this.orders.update(input.orderId, {
        status: 'funded',
        fundedAt: this.now(),
        expiryAt: exactExpiryAt,
        challengeEndsAt: exactChallengeEndsAt,
        fundingTransaction: funded.transaction,
        lastError: undefined,
      });
      await this.billing.markStripeEventProcessed(input.eventId);
    } catch (error) {
      await this.orders.update(input.orderId, { status: 'paid_pending_sponsorship', sponsorshipStartedAt: undefined, lastError: error instanceof Error ? error.message : 'sponsorship_failed' });
      throw error;
    }
    return { duplicate: false, status: await this.getPublicStatus(input.orderId) ?? null };
  }

  async markSlashed(orderId: string): Promise<PublicOrderStatus> {
    const order = await this.orders.update(orderId, { status: 'slashed' });
    return safeStatus(order);
  }

  /**
   * Reconciles finalized contract events into the Stripe control plane.
   *
   * This is intentionally separate from the x402 claim store: the event
   * indexer only supplies public chain facts, while this method joins them to
   * the order/commitment mapping that is already private to billing. Replaying
   * the same event list is safe and repairs crashes between an on-chain
   * transaction and the corresponding database update.
   */
  async reconcileBaseEvents(events: readonly BaseBondChainEvent[]): Promise<{
    funded: number;
    released: number;
    slashed: number;
  }> {
    const ordersByCommitment = new Map<string, OrderRecord>();
    for (const order of await this.orders.list()) ordersByCommitment.set(order.commitment, order);
    let funded = 0;
    let released = 0;
    let slashed = 0;

    const orderedEvents = [...events].sort((left, right) => {
      if (left.blockNumber !== undefined && right.blockNumber !== undefined && left.blockNumber !== right.blockNumber) {
        return left.blockNumber < right.blockNumber ? -1 : 1;
      }
      return (left.logIndex ?? 0) - (right.logIndex ?? 0);
    });

    for (const event of orderedEvents) {
      const commitment = commitmentFromChain(event.args.commitment);
      if (!commitment) continue;
      const order = ordersByCommitment.get(commitment);
      if (!order) continue;

      if (event.eventName === 'BundleFunded') {
        if (['refunded', 'slashed', 'chargeback'].includes(order.status)) continue;
        const eventTier = event.args.tierId === undefined ? undefined : Number(event.args.tierId);
        if (eventTier !== undefined && eventTier !== order.tierId) continue;
        const expiryAt = expiryMillisFromChain(event.args.expiry) ?? order.expiryAt;
        const next = await this.orders.update(order.orderId, {
          status: 'funded',
          fundedAt: order.fundedAt ?? this.now(),
          expiryAt,
          challengeEndsAt: expiryAt === undefined
            ? order.challengeEndsAt
            : expiryAt + tierFor(order.tierId).challengeSeconds * 1000,
          fundingTransaction: order.fundingTransaction ?? event.transactionHash,
          lastError: undefined,
        });
        ordersByCommitment.set(commitment, next);
        if (order.status !== 'funded') funded += 1;
        continue;
      }

      if (event.eventName === 'BondReleased') {
        if (['refunded', 'slashed', 'chargeback'].includes(order.status)) continue;
        const next = await this.orders.update(order.orderId, {
          status: 'refund_pending',
          bondReleaseTransaction: order.bondReleaseTransaction ?? event.transactionHash,
          lastError: undefined,
        });
        ordersByCommitment.set(commitment, next);
        if (order.status !== 'refund_pending') released += 1;
        continue;
      }

      if (event.eventName === 'BondSlashed') {
        if (['refunded', 'chargeback', 'slashed'].includes(order.status)) continue;
        const next = await this.orders.update(order.orderId, { status: 'slashed', lastError: undefined });
        ordersByCommitment.set(commitment, next);
        slashed += 1;
      }
    }
    return { funded, released, slashed };
  }

  async runMaturityJob(): Promise<{ released: number; refunded: number; retryable: number }> {
    const now = this.now();
    let released = 0;
    let refunded = 0;
    let retryable = 0;
    for (const order of await this.orders.list()) {
      if (!['funded', 'release_pending', 'refund_pending'].includes(order.status) || !order.challengeEndsAt || order.challengeEndsAt > now) continue;
      let current = order;
      try {
        if (!current.bondReleaseTransaction) {
          if (!this.sponsor) throw new Error('sponsor_not_configured');
          const releasedTx = await this.sponsor.releaseBond(current.commitment);
          current = await this.orders.update(current.orderId, {
            status: 'refund_pending',
            bondReleaseTransaction: releasedTx.transaction,
            refundAttempts: current.refundAttempts + 1,
            lastError: undefined,
          });
          released += 1;
        }
        if (!this.refunds || !current.stripeSessionId) throw new Error('refund_dependencies_not_configured');
        const refund = await this.refunds.refundBond(current.stripeSessionId, tierFor(current.tierId).bondCents, `bond-refund:${current.orderId}`);
        await this.orders.update(current.orderId, { status: 'refunded', refundTransaction: refund.refundId, refundAttempts: current.refundAttempts + 1, lastError: undefined });
        refunded += 1;
      } catch (error) {
        await this.orders.update(current.orderId, {
          status: current.bondReleaseTransaction ? 'refund_pending' : 'release_pending',
          refundAttempts: current.refundAttempts + 1,
          lastError: error instanceof Error ? error.message : 'maturity_failed',
        });
        retryable += 1;
      }
    }
    return { released, refunded, retryable };
  }

  private async claimCheckoutFallback(orderId: string, update: Partial<OrderRecord>, now: number): Promise<{ claimed: boolean; order: OrderRecord }> {
    const current = await this.orders.get(orderId);
    if (!current) throw new Error('order_not_found');
    const stale = current.status === 'sponsoring'
      && (current.sponsorshipStartedAt === undefined || current.sponsorshipStartedAt + 5 * 60 * 1000 <= now);
    if (current.status !== 'pending' && current.status !== 'paid_pending_sponsorship' && !stale) return { claimed: false, order: current };
    const next = await this.orders.update(orderId, {
      ...update,
      status: 'sponsoring',
      sponsorshipStartedAt: now,
      paidAt: current.paidAt ?? update.paidAt,
      expiryAt: current.expiryAt ?? update.expiryAt,
      challengeEndsAt: current.challengeEndsAt ?? update.challengeEndsAt,
      stripeSessionId: current.stripeSessionId ?? update.stripeSessionId,
    });
    return { claimed: true, order: next };
  }
}
