import type { Pool } from 'pg';
import type { SandboxAccount, SandboxStore } from './sandbox-billing.js';

/** All balance and bundle transitions for one account share a database row lock.
 * Globally unique commitment/session keys also prevent cross-account reuse. */
export class PostgresSandboxStore implements SandboxStore {
  constructor(private readonly pool: Pool) {}

  async transaction<T>(accountId: string, change: (account: SandboxAccount) => T): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO sandbox_billing.accounts(account_id) VALUES ($1) ON CONFLICT DO NOTHING', [accountId]);
      const row = (await client.query('SELECT balance_cents, reserved_cents FROM sandbox_billing.accounts WHERE account_id=$1 FOR UPDATE', [accountId])).rows[0];
      const topups = await client.query('SELECT record FROM sandbox_billing.topups WHERE account_id=$1', [accountId]);
      const bundles = await client.query('SELECT record FROM sandbox_billing.bundles WHERE account_id=$1', [accountId]);
      const account: SandboxAccount = {
        balanceCents: row.balance_cents, reservedCents: row.reserved_cents,
        topups: topups.rows.map(r => r.record), bundles: bundles.rows.map(r => r.record),
      };
      const before = structuredClone(account);
      const result = change(account);
      await client.query('UPDATE sandbox_billing.accounts SET balance_cents=$2, reserved_cents=$3 WHERE account_id=$1', [accountId, account.balanceCents, account.reservedCents]);
      for (const topup of account.topups) {
        if (JSON.stringify(before.topups.find(t => t.id === topup.id)) === JSON.stringify(topup)) continue;
        await client.query(`INSERT INTO sandbox_billing.topups(topup_id,account_id,request_id,session_id,record) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT(topup_id) DO UPDATE SET session_id=EXCLUDED.session_id,record=EXCLUDED.record WHERE sandbox_billing.topups.account_id=EXCLUDED.account_id`,
        [topup.id, accountId, topup.requestId, topup.sessionId, topup]);
      }
      for (const bundle of account.bundles) {
        if (JSON.stringify(before.bundles.find(b => b.commitment === bundle.commitment)) === JSON.stringify(bundle)) continue;
        const saved = await client.query(`INSERT INTO sandbox_billing.bundles(commitment,account_id,record) VALUES ($1,$2,$3)
          ON CONFLICT(commitment) DO UPDATE SET record=EXCLUDED.record WHERE sandbox_billing.bundles.account_id=EXCLUDED.account_id RETURNING commitment`,
        [bundle.commitment, accountId, bundle]);
        if (!saved.rowCount) throw new Error('commitment_already_owned');
      }
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async topupOwner(id: string): Promise<string | undefined> {
    return (await this.pool.query('SELECT account_id FROM sandbox_billing.topups WHERE topup_id=$1', [id])).rows[0]?.account_id;
  }

  async bundleOwner(commitment: string): Promise<string | undefined> {
    return (await this.pool.query('SELECT account_id FROM sandbox_billing.bundles WHERE commitment=$1', [commitment])).rows[0]?.account_id;
  }
}
