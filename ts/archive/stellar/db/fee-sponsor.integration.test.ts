import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { PostgresFeeSponsorStore } from './fee-sponsor.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/zk_credits_test';
const dbTestsEnabled = process.env.RUN_DB_TESTS === '1';

describe.skipIf(!dbTestsEnabled)('PostgresFeeSponsorStore (integration, requires Postgres)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await pool.query(`DELETE FROM "fee-sponsor".fee_relay_requests`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('is idempotent on the inner tx hash across store instances (retry no re-sponsor)', async () => {
    const store1 = new PostgresFeeSponsorStore(pool);
    const first = await store1.recordRelayRequestOnce({
      innerTxHash: 'int-fee-1',
      method: 'slash',
      contractId: 'C-int',
      innerTxXdr: 'AAAA...',
    });
    expect(first.inserted).toBe(true);

    // Retry on a fresh instance: duplicate, prior state preserved.
    const store2 = new PostgresFeeSponsorStore(pool);
    const retry = await store2.recordRelayRequestOnce({
      innerTxHash: 'int-fee-1',
      method: 'slash',
      contractId: 'C-int',
      innerTxXdr: 'AAAA...',
    });
    expect(retry.inserted).toBe(false);
    expect(retry.request.status).toBe('received');

    await store2.markSubmitted('int-fee-1', 'fee-bump-int-1');
    expect((await store2.getRequest('int-fee-1'))?.status).toBe('submitted');
  });

  it('records distinct inner tx hashes independently', async () => {
    const store = new PostgresFeeSponsorStore(pool);
    const a = await store.recordRelayRequestOnce({
      innerTxHash: 'int-fee-a',
      method: 'withdraw',
      contractId: 'C-int',
      innerTxXdr: 'AAAA...',
    });
    const b = await store.recordRelayRequestOnce({
      innerTxHash: 'int-fee-b',
      method: 'slash',
      contractId: 'C-int',
      innerTxXdr: 'BBBB...',
    });
    expect(a.inserted && b.inserted).toBe(true);
    const all = await store.listRequests();
    const ids = all.map((r) => r.innerTxHash);
    expect(ids).toContain('int-fee-a');
    expect(ids).toContain('int-fee-b');
    expect(ids.filter((id) => id === 'int-fee-b')).toHaveLength(1);
  });
});
