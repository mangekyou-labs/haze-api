import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { resolve } from 'node:path';
import { withSandboxSponsorLock } from './sandbox-sponsor-lock.js';
import { FundingPreBroadcastError } from './pilot-funding.js';
import { PostgresSandboxStore } from './sandbox-store.js';
import { runMigrations } from './db/migrate.js';
import { billingContract } from './sandbox-billing-contract.js';
import { createBundleFundingSponsor } from './bundle-funding-sponsor.js';
import { HASH, ready } from './sandbox-test-support.js';

const enabled = process.env.RUN_DB_TESTS === '1';
describe.skipIf(!enabled)('sandbox real Postgres transactions', () => {
  let pool: Pool;
  const accounts = new Set<string>();
  let lock: PoolClient;
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    lock = await pool.connect();
    await lock.query('SELECT pg_advisory_lock($1)', [8_402_062_006]);
    await runMigrations(pool, resolve(import.meta.dirname, 'db/migrations'));
  });
  afterAll(async () => {
    if (pool && accounts.size) {
      for (const table of ['bundles', 'topups', 'accounts']) await pool.query(`DELETE FROM sandbox_billing.${table} WHERE account_id = ANY($1::text[])`, [[...accounts]]);
    }
    if (lock) { await lock.query('SELECT pg_advisory_unlock($1)', [8_402_062_006]); lock.release(); }
    await pool?.end();
  });
  billingContract(() => {
    const store = new PostgresSandboxStore(pool);
    return { transaction: <T>(id: string, change: Parameters<typeof store.transaction<T>>[1]) => { accounts.add(id); return store.transaction(id, change); },
      topupOwner: (id: string) => store.topupOwner(id), bundleOwner: (id: string) => store.bundleOwner(id) };
  });
  it('fences concurrent sponsor writes without monopolizing pool connections', async () => {
    // Previous contract cases deliberately leave ambiguous records; only the
    // records belonging to this suite are removed for this independent case.
    await pool.query('DELETE FROM sandbox_billing.bundles WHERE account_id = ANY($1::text[])', [[...accounts]]);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const active = withSandboxSponsorLock(pool, '1', async () => { entered(); await hold; return 'confirmed'; });
    await started;
    try {
      const refused = await Promise.allSettled(Array.from({ length: 20 }, () => withSandboxSponsorLock(pool, '2', async () => 'must not write')));
      expect(refused.every(result => result.status === 'rejected' && result.reason instanceof FundingPreBroadcastError)).toBe(true);
      expect((await pool.query('SELECT 1 AS available')).rows[0].available).toBe(1);
    } finally { release(); }
    await expect(active).resolves.toBe('confirmed');
    await expect(withSandboxSponsorLock(pool, '3', async () => 'next')).resolves.toBe('next');
    await pool.query("INSERT INTO sandbox_billing.bundles(commitment, account_id, record) VALUES ('4', $1, '{\"state\":\"unknown\"}'::jsonb)", [[...accounts][0]]);
    await expect(withSandboxSponsorLock(pool, '5', async () => 'must not write')).rejects.toThrow('sponsor_pending');
  });
  it('coordinates the assembled sponsor with durable pending state and releases locks after callback failure', async () => {
    await pool.query('DELETE FROM sandbox_billing.bundles WHERE account_id = ANY($1::text[])', [[...accounts]]);
    const accountId = randomUUID();
    accounts.add(accountId);
    const store = new PostgresSandboxStore(pool);
    await store.transaction(accountId, () => {});
    let enter!: () => void;
    let finish!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const held = new Promise<void>(resolve => { finish = resolve; });
    const chain = {
      fundingStatus: async () => ready,
      fundBundle: vi.fn(async (_commitment: string, tier: number, onBroadcast?: (hash: string) => Promise<void>) => {
        expect(tier).toBe(0);
        enter(); await held;
        await onBroadcast?.(HASH);
        return { transaction: HASH, expiryAt: 1_900_000_000_999 };
      }),
      reconcileBundle: async () => undefined,
      isConfirmedRevert: async () => false,
      releaseBond: async () => ({ transaction: HASH }),
    };
    // Separate module instances represent independent gateway processes.
    const createSponsor = () => createBundleFundingSponsor({ pool, createChainSponsor: () => chain });
    const active = createSponsor().fund('10', async () => {});
    await entered;
    try {
      const attempts = await Promise.allSettled(Array.from({ length: 20 }, () => createSponsor().fund('11', async () => {})));
      expect(attempts.every(result => result.status === 'rejected' && result.reason instanceof FundingPreBroadcastError)).toBe(true);
      expect(chain.fundBundle).toHaveBeenCalledTimes(1);
      expect((await pool.query('SELECT 1 AS available')).rows[0].available).toBe(1);
    } finally { finish(); }
    expect(await active).toEqual({ transactionHash: HASH, expiry: 1_900_000_000 });
    const persistenceError = new Error('broadcast persistence failed');
    await expect(createSponsor().fund('10', async () => { throw persistenceError; })).rejects.toBe(persistenceError);
    expect(await createSponsor().fund('10', async () => {})).toMatchObject({ transactionHash: HASH });

    await pool.query(`INSERT INTO sandbox_billing.bundles(commitment,account_id,record)
      VALUES ('10',$1,'{"state":"unknown"}'::jsonb)`, [accountId]);
    const writes = chain.fundBundle.mock.calls.length;
    await expect(createSponsor().fund('11', async () => {})).rejects.toThrow('sponsor_pending');
    expect(chain.fundBundle).toHaveBeenCalledTimes(writes);
    // Reconciliation reads still work while another attempt is unresolved.
    expect(await createSponsor().reconcile('10', HASH)).toBeUndefined();
  });
  it('skips previously applied files on an existing deployment', async () => {
    const result = await runMigrations(pool, resolve(import.meta.dirname, 'db/migrations'));
    expect(result.applied).toEqual([]);
    expect(result.skipped).toContain('0020_sandbox_billing.sql');
  });
});
