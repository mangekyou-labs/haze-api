/**
 * Optional GitHub-account to Base-wallet links.
 *
 * Wallet links belong to the account control plane. They are deliberately not
 * copied into the x402 spend plane, billing orders, commitments, or replay
 * claims.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Pool } from 'pg';

export interface WalletLinkStore {
  link(accountId: string, address: string, linkedAt?: number): Promise<void>;
  get(accountId: string): Promise<string | undefined>;
}

function validate(accountId: string, address: string): { accountId: string; address: string } {
  const normalizedAccount = accountId.trim();
  if (!normalizedAccount || normalizedAccount.length > 255) throw new Error('invalid_account_id');
  if (!/^0x[0-9a-fA-F]{40}$/u.test(address)) throw new Error('invalid_wallet_address');
  return { accountId: normalizedAccount, address: address.toLowerCase() };
}

/** Deterministic fallback for local development and unit tests. */
export class MemoryWalletLinkStore implements WalletLinkStore {
  private readonly byAccount = new Map<string, string>();
  private readonly byAddress = new Map<string, string>();

  async link(accountId: string, address: string): Promise<void> {
    const value = validate(accountId, address);
    const existingAccount = this.byAddress.get(value.address);
    if (existingAccount && existingAccount !== value.accountId) throw new Error('wallet_already_linked');
    const existingAddress = this.byAccount.get(value.accountId);
    if (existingAddress && existingAddress !== value.address) this.byAddress.delete(existingAddress);
    this.byAccount.set(value.accountId, value.address);
    this.byAddress.set(value.address, value.accountId);
  }

  async get(accountId: string): Promise<string | undefined> {
    return this.byAccount.get(accountId.trim());
  }
}

/** Durable account-control-plane implementation. */
export class PostgresWalletLinkStore implements WalletLinkStore {
  constructor(private readonly pool: Pool) {}

  async link(accountId: string, address: string, linkedAt = Date.now()): Promise<void> {
    const value = validate(accountId, address);
    try {
      await this.pool.query(
        `INSERT INTO billing.account_wallet_links (account_id, wallet_address, linked_at)
         VALUES ($1, $2, to_timestamp($3 / 1000.0))
         ON CONFLICT (account_id) DO UPDATE SET
           wallet_address = EXCLUDED.wallet_address,
           linked_at = EXCLUDED.linked_at`,
        [value.accountId, value.address, linkedAt],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new Error('wallet_already_linked');
      throw error;
    }
  }

  async get(accountId: string): Promise<string | undefined> {
    const result = await this.pool.query(
      `SELECT wallet_address FROM billing.account_wallet_links WHERE account_id = $1`,
      [accountId.trim()],
    );
    return result.rows[0]?.wallet_address ? String(result.rows[0].wallet_address) : undefined;
  }
}

