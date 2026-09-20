/**
 * Provisioning-plane funding capabilities.
 *
 * A capability is a detached, single-use bearer token minted after invite
 * redemption. It knows nothing about the GitHub account, the invite, or the
 * session that produced it: the only durable identifiers are the token digest
 * and, once attempted, the commitment it is bound to.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { BN254_FIELD_ORDER, FUNDED_SLOT_ALLOWANCE, FUNDED_TIER_ID } from '@zk-credits/shared';

export const DEFAULT_CAPABILITY_TTL_MS = 30 * 60 * 1000;
export const DEFAULT_BUNDLE_DURATION_SECONDS = 30 * 24 * 60 * 60;
export const DEFAULT_BASE_SEPOLIA_NETWORK = 'eip155:84532';
const FUNDING_ATTEMPT_LEASE_MS = 2 * 60 * 1000;

export type FundingCapabilityState = 'issued' | 'funding' | 'funded' | 'failed';

export interface FundingCapabilityRecord {
  capabilityId: string;
  tokenHash: string;
  state: FundingCapabilityState;
  commitment: string | null;
  createdAt: number;
  expiresAt: number;
  attemptStartedAt: number | null;
  boundAt: number | null;
  fundedAt: number | null;
  bundleExpiry: number | null;
  transactionHash: string | null;
  failureReason: string | null;
}

export interface FundingClaim {
  claimed: boolean;
  record: FundingCapabilityRecord | undefined;
}

export interface FundingCapabilityStore {
  insert(record: FundingCapabilityRecord): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<FundingCapabilityRecord | undefined>;
  findByCommitment(commitment: string): Promise<FundingCapabilityRecord | undefined>;
  /** Atomically binds the first commitment and leases the attempt to one caller. */
  claim(input: { tokenHash: string; commitment: string; at: number; leaseMs: number }): Promise<FundingClaim>;
  complete(input: { capabilityId: string; commitment: string; transactionHash: string; bundleExpiry: number; at: number }): Promise<FundingCapabilityRecord>;
  fail(input: { capabilityId: string; commitment: string; reason: string }): Promise<FundingCapabilityRecord>;
}

export interface PilotFundingSponsor {
  fundCommitment(commitment: string): Promise<{ transactionHash: string; expiryAt?: number }>;
}

export interface PilotFundingResult {
  network: string;
  chainId: number;
  contractAddress: string;
  deploymentDomain: string;
  tierId: typeof FUNDED_TIER_ID;
  expiry: number;
  transactionHash: string;
}

export interface PilotBundle extends PilotFundingResult {
  commitment: string;
  fundedAt: number;
}

export function hashFundingToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function isWellFormedToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{16,128}$/u.test(token);
}

/** Accepts decimal or 0x-hex and rejects zero, negatives, and out-of-field values. */
export function normalizeCommitment(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:\d+|0x[0-9a-fA-F]{1,64})$/u.test(value)) throw new Error('invalid_commitment');
  let commitment: bigint;
  try {
    commitment = BigInt(value);
  } catch {
    throw new Error('invalid_commitment');
  }
  if (commitment <= 0n || commitment >= BN254_FIELD_ORDER) throw new Error('invalid_commitment');
  return commitment.toString();
}

function chainIdOf(network: string): number {
  const match = /^eip155:(\d+)$/u.exec(network);
  if (!match) throw new Error('invalid_pilot_network');
  return Number(match[1]);
}

function requireContractAddress(value: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(value)) throw new Error('invalid_pilot_contract_address');
  return value;
}

/** Deterministic fallback for local development and unit tests. */
export class MemoryFundingCapabilityStore implements FundingCapabilityStore {
  private readonly capabilities = new Map<string, FundingCapabilityRecord>();

  async insert(record: FundingCapabilityRecord): Promise<void> {
    this.capabilities.set(record.capabilityId, { ...record });
  }

  async findByTokenHash(tokenHash: string): Promise<FundingCapabilityRecord | undefined> {
    for (const record of this.capabilities.values()) {
      if (record.tokenHash === tokenHash) return { ...record };
    }
    return undefined;
  }

  async findByCommitment(commitment: string): Promise<FundingCapabilityRecord | undefined> {
    for (const record of this.capabilities.values()) {
      if (record.commitment === commitment) return { ...record };
    }
    return undefined;
  }

  async claim(input: { tokenHash: string; commitment: string; at: number; leaseMs: number }): Promise<FundingClaim> {
    const record = await this.findByTokenHash(input.tokenHash);
    if (!record) return { claimed: false, record: undefined };
    if (record.expiresAt <= input.at) return { claimed: false, record };
    if (record.state === 'funded') return { claimed: false, record };
    if (record.commitment !== null && record.commitment !== input.commitment) return { claimed: false, record };
    if (record.state === 'funding' && record.attemptStartedAt !== null && record.attemptStartedAt + input.leaseMs > input.at) {
      return { claimed: false, record };
    }
    const next: FundingCapabilityRecord = {
      ...record,
      state: 'funding',
      commitment: input.commitment,
      attemptStartedAt: input.at,
      boundAt: record.boundAt ?? input.at,
      failureReason: null,
    };
    this.capabilities.set(next.capabilityId, next);
    return { claimed: true, record: { ...next } };
  }

  async complete(input: { capabilityId: string; commitment: string; transactionHash: string; bundleExpiry: number; at: number }): Promise<FundingCapabilityRecord> {
    const record = this.capabilities.get(input.capabilityId);
    if (!record) throw new Error('capability_not_found');
    const next: FundingCapabilityRecord = {
      ...record,
      state: 'funded',
      commitment: input.commitment,
      transactionHash: input.transactionHash,
      bundleExpiry: input.bundleExpiry,
      fundedAt: input.at,
      failureReason: null,
    };
    this.capabilities.set(input.capabilityId, next);
    return { ...next };
  }

  async fail(input: { capabilityId: string; commitment: string; reason: string }): Promise<FundingCapabilityRecord> {
    const record = this.capabilities.get(input.capabilityId);
    if (!record) throw new Error('capability_not_found');
    const next: FundingCapabilityRecord = {
      ...record,
      state: 'failed',
      commitment: input.commitment,
      failureReason: input.reason,
    };
    this.capabilities.set(input.capabilityId, next);
    return { ...next };
  }
}

const CAPABILITY_COLUMNS = 'capability_id, token_hash, state, commitment, created_at, expires_at, attempt_started_at, bound_at, funded_at, bundle_expiry, transaction_hash, failure_reason';

function toMillis(value: unknown): number | null {
  return value ? new Date(value as string | Date).getTime() : null;
}

function toRecord(row: Record<string, unknown>): FundingCapabilityRecord {
  return {
    capabilityId: String(row.capability_id),
    tokenHash: String(row.token_hash),
    state: String(row.state) as FundingCapabilityState,
    commitment: row.commitment === null || row.commitment === undefined ? null : String(row.commitment),
    createdAt: new Date(row.created_at as string | Date).getTime(),
    expiresAt: new Date(row.expires_at as string | Date).getTime(),
    attemptStartedAt: toMillis(row.attempt_started_at),
    boundAt: toMillis(row.bound_at),
    fundedAt: toMillis(row.funded_at),
    bundleExpiry: toMillis(row.bundle_expiry),
    transactionHash: row.transaction_hash === null || row.transaction_hash === undefined ? null : String(row.transaction_hash),
    failureReason: row.failure_reason === null || row.failure_reason === undefined ? null : String(row.failure_reason),
  };
}

/** Durable provisioning-plane implementation with no cross-plane identifiers. */
export class PostgresFundingCapabilityStore implements FundingCapabilityStore {
  constructor(private readonly pool: Pool) {}

  async insert(record: FundingCapabilityRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO pilot_provisioning.funding_capabilities
         (capability_id, token_hash, state, commitment, created_at, expires_at)
       VALUES ($1, $2, 'issued', NULL, to_timestamp($3 / 1000.0), to_timestamp($4 / 1000.0))`,
      [record.capabilityId, record.tokenHash, record.createdAt, record.expiresAt],
    );
  }

  async findByTokenHash(tokenHash: string): Promise<FundingCapabilityRecord | undefined> {
    const result = await this.pool.query(
      `SELECT ${CAPABILITY_COLUMNS} FROM pilot_provisioning.funding_capabilities WHERE token_hash = $1`,
      [tokenHash],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : undefined;
  }

  async findByCommitment(commitment: string): Promise<FundingCapabilityRecord | undefined> {
    const result = await this.pool.query(
      `SELECT ${CAPABILITY_COLUMNS} FROM pilot_provisioning.funding_capabilities WHERE commitment = $1`,
      [commitment],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : undefined;
  }

  async claim(input: { tokenHash: string; commitment: string; at: number; leaseMs: number }): Promise<FundingClaim> {
    const result = await this.pool.query(
      `UPDATE pilot_provisioning.funding_capabilities
       SET state = 'funding',
           commitment = $2,
           attempt_started_at = to_timestamp($3 / 1000.0),
           bound_at = COALESCE(bound_at, to_timestamp($3 / 1000.0)),
           failure_reason = NULL
       WHERE token_hash = $1
         AND expires_at > to_timestamp($3 / 1000.0)
         AND state <> 'funded'
         AND (commitment IS NULL OR commitment = $2)
         AND (state <> 'funding' OR attempt_started_at IS NULL
              OR attempt_started_at <= to_timestamp(($3 - $4) / 1000.0))
       RETURNING ${CAPABILITY_COLUMNS}`,
      [input.tokenHash, input.commitment, input.at, input.leaseMs],
    );
    if (result.rows[0]) return { claimed: true, record: toRecord(result.rows[0]) };
    const record = await this.findByTokenHash(input.tokenHash);
    return { claimed: false, record };
  }

  async complete(input: { capabilityId: string; commitment: string; transactionHash: string; bundleExpiry: number; at: number }): Promise<FundingCapabilityRecord> {
    const result = await this.pool.query(
      `UPDATE pilot_provisioning.funding_capabilities
       SET state = 'funded',
           commitment = $2,
           transaction_hash = $3,
           bundle_expiry = to_timestamp($4 / 1000.0),
           funded_at = to_timestamp($5 / 1000.0),
           failure_reason = NULL
       WHERE capability_id = $1
       RETURNING ${CAPABILITY_COLUMNS}`,
      [input.capabilityId, input.commitment, input.transactionHash, input.bundleExpiry, input.at],
    );
    if (!result.rows[0]) throw new Error('capability_not_found');
    return toRecord(result.rows[0]);
  }

  async fail(input: { capabilityId: string; commitment: string; reason: string }): Promise<FundingCapabilityRecord> {
    const result = await this.pool.query(
      `UPDATE pilot_provisioning.funding_capabilities
       SET state = 'failed', commitment = $2, failure_reason = $3
       WHERE capability_id = $1
       RETURNING ${CAPABILITY_COLUMNS}`,
      [input.capabilityId, input.commitment, input.reason],
    );
    if (!result.rows[0]) throw new Error('capability_not_found');
    return toRecord(result.rows[0]);
  }
}

export interface PilotFundingServiceOptions {
  store: FundingCapabilityStore;
  sponsor: PilotFundingSponsor;
  contractAddress: string;
  now?: () => number;
  network?: string;
  /** Deployment-wide authorization domain; defaults to the chain id. */
  deploymentDomain?: string;
  capabilityTtlMs?: number;
  bundleDurationSeconds?: number;
}

/**
 * Detached funding: one capability, one commitment, one authoritative result.
 */
export class PilotFundingService {
  private readonly store: FundingCapabilityStore;
  private readonly sponsor: PilotFundingSponsor;
  private readonly now: () => number;
  private readonly network: string;
  private readonly chainId: number;
  private readonly contractAddress: string;
  private readonly deploymentDomain: string;
  private readonly capabilityTtlMs: number;
  private readonly bundleDurationSeconds: number;
  private readonly attempts = new Map<string, Promise<PilotFundingResult>>();

  constructor(options: PilotFundingServiceOptions) {
    this.store = options.store;
    this.sponsor = options.sponsor;
    this.now = options.now ?? Date.now;
    this.network = options.network ?? DEFAULT_BASE_SEPOLIA_NETWORK;
    this.chainId = chainIdOf(this.network);
    this.contractAddress = requireContractAddress(options.contractAddress);
    this.deploymentDomain = String(options.deploymentDomain ?? this.chainId);
    this.capabilityTtlMs = options.capabilityTtlMs ?? DEFAULT_CAPABILITY_TTL_MS;
    this.bundleDurationSeconds = options.bundleDurationSeconds ?? DEFAULT_BUNDLE_DURATION_SECONDS;
  }

  /** Mints a detached capability. It is called with no identity and stores none. */
  async issueCapability(): Promise<{ fundingToken: string; expiresAt: number }> {
    const now = this.now();
    const fundingToken = randomBytes(32).toString('base64url');
    const expiresAt = now + this.capabilityTtlMs;
    await this.store.insert({
      capabilityId: `cap_${randomBytes(16).toString('base64url')}`,
      tokenHash: hashFundingToken(fundingToken),
      state: 'issued',
      commitment: null,
      createdAt: now,
      expiresAt,
      attemptStartedAt: null,
      boundAt: null,
      fundedAt: null,
      bundleExpiry: null,
      transactionHash: null,
      failureReason: null,
    });
    return { fundingToken, expiresAt };
  }

  async fund(input: { fundingToken: string; commitment: string }): Promise<PilotFundingResult> {
    if (!isWellFormedToken(input.fundingToken)) throw new Error('invalid_funding_token');
    const commitment = normalizeCommitment(input.commitment);
    const tokenHash = hashFundingToken(input.fundingToken);

    const key = `${tokenHash}:${commitment}`;
    const inFlight = this.attempts.get(key);
    if (inFlight) return inFlight;
    const attempt = this.runAttempt(tokenHash, commitment).finally(() => {
      if (this.attempts.get(key) === attempt) this.attempts.delete(key);
    });
    this.attempts.set(key, attempt);
    return attempt;
  }

  async lookupByCommitment(commitment: string): Promise<PilotBundle | undefined> {
    const record = await this.store.findByCommitment(normalizeCommitment(commitment));
    if (!record || record.state !== 'funded' || record.bundleExpiry === null || !record.transactionHash) return undefined;
    return {
      commitment: record.commitment!,
      ...this.resultOf(record),
      fundedAt: record.fundedAt ?? record.createdAt,
    };
  }

  private async runAttempt(tokenHash: string, commitment: string): Promise<PilotFundingResult> {
    const now = this.now();
    const claim = await this.store.claim({ tokenHash, commitment, at: now, leaseMs: FUNDING_ATTEMPT_LEASE_MS });
    const record = claim.record;
    if (!record) throw new Error('invalid_funding_token');
    if (record.commitment !== null && record.commitment !== commitment) throw new Error('funding_commitment_conflict');
    if (record.expiresAt <= now) throw new Error('funding_capability_expired');
    if (record.state === 'funded') return this.resultOf(record);
    if (!claim.claimed) throw new Error('funding_in_progress');

    try {
      const sponsored = await this.sponsor.fundCommitment(commitment);
      const bundleExpiry = sponsored.expiryAt ?? (Math.floor(now / 1000) + this.bundleDurationSeconds) * 1000;
      const funded = await this.store.complete({
        capabilityId: record.capabilityId,
        commitment,
        transactionHash: sponsored.transactionHash,
        bundleExpiry,
        at: this.now(),
      });
      return this.resultOf(funded);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'funding_sponsor_failed';
      await this.store.fail({ capabilityId: record.capabilityId, commitment, reason });
      throw new Error('funding_unavailable');
    }
  }

  private resultOf(record: FundingCapabilityRecord): PilotFundingResult {
    if (record.state !== 'funded' || record.bundleExpiry === null || !record.transactionHash) {
      throw new Error('funding_result_unavailable');
    }
    return {
      network: this.network,
      chainId: this.chainId,
      contractAddress: this.contractAddress,
      deploymentDomain: this.deploymentDomain,
      tierId: FUNDED_TIER_ID,
      expiry: Math.floor(record.bundleExpiry / 1000),
      transactionHash: record.transactionHash,
    };
  }
}

export const PILOT_TIER_ALLOWANCE = FUNDED_SLOT_ALLOWANCE;
