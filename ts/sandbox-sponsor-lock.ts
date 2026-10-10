import type { Pool, PoolClient } from 'pg';
import { FundingPreBroadcastError } from './pilot-funding.js';

/** Gate the shared sponsor across processes without exhausting the pool while
 * one receipt is pending. All sponsor writers must use the same database. */
export async function withSandboxSponsorLock<T>(pool: Pool, commitment: string, write: () => Promise<T>): Promise<T> {
  let connection: PoolClient | undefined;
  let acquired = false;
  let writeStarted = false;
  try {
    connection = await pool.connect();
    const lock = await connection.query('SELECT pg_try_advisory_lock($1) AS acquired', [845320020]);
    acquired = lock.rows[0].acquired;
    if (!acquired) throw new FundingPreBroadcastError('sponsor_pending');
    const pending = await connection.query(`SELECT 1 FROM sandbox_billing.bundles
      WHERE commitment <> $1 AND record->>'state' IN ('funding', 'unknown') LIMIT 1`, [commitment]);
    if (pending.rowCount) throw new FundingPreBroadcastError('sponsor_pending');
    writeStarted = true;
    return await write();
  } catch (error) {
    if (!writeStarted && !(error instanceof FundingPreBroadcastError)) throw new FundingPreBroadcastError('funder_unavailable');
    throw error;
  } finally {
    if (connection) {
      try { if (acquired) await connection.query('SELECT pg_advisory_unlock($1)', [845320020]); }
      finally { connection.release(); }
    }
  }
}
