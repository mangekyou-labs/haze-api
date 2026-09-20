/**
 * Control-plane pilot invites.
 *
 * A founder issues a single-use invite bound to one GitHub account. Only the
 * SHA-256 digest of the code is durable, so a database disclosure cannot
 * redeem an invite. Redemption mints a detached funding capability through an
 * issuer that receives no account information; this module never stores a
 * commitment and never imports provisioning-plane code.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';

export const DEFAULT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface PilotInviteRecord {
  inviteId: string;
  codeHash: string;
  githubAccountId: string;
  createdAt: number;
  expiresAt: number;
  redeemedAt: number | null;
  revokedAt: number | null;
}

export type PilotInviteState = 'open' | 'redeemed' | 'revoked' | 'expired';

export interface PilotInviteStatus {
  inviteId: string;
  githubAccountId: string;
  createdAt: number;
  expiresAt: number;
  redeemedAt: number | null;
  revokedAt: number | null;
  state: PilotInviteState;
}

export interface InviteStore {
  insert(record: PilotInviteRecord): Promise<void>;
  get(inviteId: string): Promise<PilotInviteRecord | undefined>;
  getByCodeHash(codeHash: string): Promise<PilotInviteRecord | undefined>;
  /** Atomic single-use claim. Returns false when already redeemed, revoked, or expired. */
  markRedeemed(inviteId: string, at: number): Promise<boolean>;
  revoke(inviteId: string, at: number): Promise<boolean>;
  list(): Promise<PilotInviteRecord[]>;
}

/** Mints a detached funding capability. It deliberately receives no identity. */
export interface FundingCapabilityIssuer {
  issue(): Promise<{ fundingToken: string; expiresAt: number }>;
}

export function hashInviteCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

function isWellFormedCode(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Za-z0-9_-]{16,128}$/u.test(code);
}

/** Deterministic fallback for local development and unit tests. */
export class MemoryInviteStore implements InviteStore {
  private readonly invites = new Map<string, PilotInviteRecord>();

  async insert(record: PilotInviteRecord): Promise<void> {
    this.invites.set(record.inviteId, { ...record });
  }

  async get(inviteId: string): Promise<PilotInviteRecord | undefined> {
    const record = this.invites.get(inviteId);
    return record ? { ...record } : undefined;
  }

  async getByCodeHash(codeHash: string): Promise<PilotInviteRecord | undefined> {
    for (const record of this.invites.values()) {
      if (record.codeHash === codeHash) return { ...record };
    }
    return undefined;
  }

  async markRedeemed(inviteId: string, at: number): Promise<boolean> {
    const record = this.invites.get(inviteId);
    if (!record || record.redeemedAt !== null || record.revokedAt !== null || record.expiresAt <= at) return false;
    this.invites.set(inviteId, { ...record, redeemedAt: at });
    return true;
  }

  async revoke(inviteId: string, at: number): Promise<boolean> {
    const record = this.invites.get(inviteId);
    if (!record || record.redeemedAt !== null || record.revokedAt !== null) return false;
    this.invites.set(inviteId, { ...record, revokedAt: at });
    return true;
  }

  async list(): Promise<PilotInviteRecord[]> {
    return [...this.invites.values()].map((record) => ({ ...record }));
  }
}

const INVITE_COLUMNS = 'invite_id, code_hash, github_account_id, created_at, expires_at, redeemed_at, revoked_at';

function toRecord(row: Record<string, unknown>): PilotInviteRecord {
  return {
    inviteId: String(row.invite_id),
    codeHash: String(row.code_hash),
    githubAccountId: String(row.github_account_id),
    createdAt: new Date(row.created_at as string | Date).getTime(),
    expiresAt: new Date(row.expires_at as string | Date).getTime(),
    redeemedAt: row.redeemed_at ? new Date(row.redeemed_at as string | Date).getTime() : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at as string | Date).getTime() : null,
  };
}

/** Durable control-plane implementation. */
export class PostgresInviteStore implements InviteStore {
  constructor(private readonly pool: Pool) {}

  async insert(record: PilotInviteRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO control_plane.pilot_invites (${INVITE_COLUMNS})
       VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), to_timestamp($5 / 1000.0), NULL, NULL)`,
      [record.inviteId, record.codeHash, record.githubAccountId, record.createdAt, record.expiresAt],
    );
  }

  async get(inviteId: string): Promise<PilotInviteRecord | undefined> {
    const result = await this.pool.query(
      `SELECT ${INVITE_COLUMNS} FROM control_plane.pilot_invites WHERE invite_id = $1`,
      [inviteId],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : undefined;
  }

  async getByCodeHash(codeHash: string): Promise<PilotInviteRecord | undefined> {
    const result = await this.pool.query(
      `SELECT ${INVITE_COLUMNS} FROM control_plane.pilot_invites WHERE code_hash = $1`,
      [codeHash],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : undefined;
  }

  async markRedeemed(inviteId: string, at: number): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE control_plane.pilot_invites
       SET redeemed_at = to_timestamp($2 / 1000.0)
       WHERE invite_id = $1 AND redeemed_at IS NULL AND revoked_at IS NULL
         AND expires_at > to_timestamp($2 / 1000.0)
       RETURNING invite_id`,
      [inviteId, at],
    );
    return result.rowCount === 1;
  }

  async revoke(inviteId: string, at: number): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE control_plane.pilot_invites
       SET revoked_at = to_timestamp($2 / 1000.0)
       WHERE invite_id = $1 AND redeemed_at IS NULL AND revoked_at IS NULL
       RETURNING invite_id`,
      [inviteId, at],
    );
    return result.rowCount === 1;
  }

  async list(): Promise<PilotInviteRecord[]> {
    const result = await this.pool.query(`SELECT ${INVITE_COLUMNS} FROM control_plane.pilot_invites ORDER BY created_at`);
    return result.rows.map(toRecord);
  }
}

export interface PilotInviteServiceOptions {
  store: InviteStore;
  capabilities: FundingCapabilityIssuer;
  now?: () => number;
  inviteTtlMs?: number;
}

/** Founder-facing invite lifecycle plus the single-use redemption gate. */
export class PilotInviteService {
  private readonly store: InviteStore;
  private readonly capabilities: FundingCapabilityIssuer;
  private readonly now: () => number;
  private readonly inviteTtlMs: number;

  constructor(options: PilotInviteServiceOptions) {
    this.store = options.store;
    this.capabilities = options.capabilities;
    this.now = options.now ?? Date.now;
    this.inviteTtlMs = options.inviteTtlMs ?? DEFAULT_INVITE_TTL_MS;
  }

  async issue(input: { githubAccountId: string; ttlMs?: number }): Promise<{ inviteId: string; code: string; expiresAt: number }> {
    const githubAccountId = (input.githubAccountId ?? '').trim();
    if (!githubAccountId || githubAccountId.length > 255) throw new Error('invalid_github_account');
    const ttlMs = input.ttlMs ?? this.inviteTtlMs;
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error('invalid_invite_ttl');
    const now = this.now();
    const code = randomBytes(32).toString('base64url');
    const inviteId = `inv_${randomBytes(16).toString('base64url')}`;
    const expiresAt = now + ttlMs;
    await this.store.insert({
      inviteId,
      codeHash: hashInviteCode(code),
      githubAccountId,
      createdAt: now,
      expiresAt,
      redeemedAt: null,
      revokedAt: null,
    });
    return { inviteId, code, expiresAt };
  }

  async inspect(inviteId: string): Promise<PilotInviteStatus | undefined> {
    const record = await this.store.get(inviteId);
    if (!record) return undefined;
    return { ...this.statusOf(record) };
  }

  async revoke(inviteId: string): Promise<boolean> {
    return this.store.revoke(inviteId, this.now());
  }

  /** Redeems a code exactly once for the GitHub account it was issued to. */
  async redeem(input: { code: string; githubAccountId: string }): Promise<{ fundingToken: string; expiresAt: number }> {
    if (!isWellFormedCode(input.code)) throw new Error('invalid_invite_code');
    const githubAccountId = (input.githubAccountId ?? '').trim();
    if (!githubAccountId) throw new Error('invalid_github_account');

    const record = await this.store.getByCodeHash(hashInviteCode(input.code));
    if (!record) throw new Error('invalid_invite_code');
    if (record.revokedAt !== null) throw new Error('invite_revoked');
    const now = this.now();
    if (record.expiresAt <= now) throw new Error('invite_expired');
    if (record.githubAccountId !== githubAccountId) throw new Error('invite_account_mismatch');
    if (record.redeemedAt !== null) throw new Error('invite_already_redeemed');

    if (!await this.store.markRedeemed(record.inviteId, now)) throw new Error('invite_already_redeemed');
    return this.capabilities.issue();
  }

  private statusOf(record: PilotInviteRecord): PilotInviteStatus {
    const now = this.now();
    const state: PilotInviteState = record.revokedAt !== null
      ? 'revoked'
      : record.redeemedAt !== null
        ? 'redeemed'
        : record.expiresAt <= now
          ? 'expired'
          : 'open';
    return {
      inviteId: record.inviteId,
      githubAccountId: record.githubAccountId,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      redeemedAt: record.redeemedAt,
      revokedAt: record.revokedAt,
      state,
    };
  }
}
