// PostgresGatewayStore integration tests (opt-in: RUN_DB_TESTS=1). Verifies
// the durable restart guarantee with a real PostgreSQL instance: rows written
// by one store instance are visible to a fresh instance (simulated restart).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { PostgresGatewayStore, reconstructGatewayState } from './gateway.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/zk_credits_test';
const dbTestsEnabled = process.env.RUN_DB_TESTS === '1';

describe.skipIf(!dbTestsEnabled)('PostgresGatewayStore (integration, requires Postgres)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await pool.query(`DELETE FROM gateway.accepted_calls`);
    await pool.query(`DELETE FROM gateway.nullifier_records`);
    await pool.query(`DELETE FROM gateway.api_key_records`);
    await pool.query(`DELETE FROM gateway.call_counts`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('persists accepted calls + nullifiers + call counts (restart durability)', async () => {
    const store1 = new PostgresGatewayStore(pool);
    await store1.recordAcceptedCall(
      {
        proofHash: 'int-ph-1',
        nullifier: 'int-n-1',
        epoch: 20260804,
        slot: 0,
        nonceHash: 'int-nh-1',
        acceptedAt: new Date(),
      },
      'int-comm-1',
    );
    await store1.markNullifierSpentOnChain('int-n-2');

    // Restart: a brand-new store instance reads the same durable rows.
    const store2 = new PostgresGatewayStore(pool);
    const calls = await store2.listAcceptedCalls();
    expect(calls.map((c) => c.proofHash)).toContain('int-ph-1');
    // recordAcceptedCall is atomic (accepted call + nullifier + count in one
    // transaction), so the count below comes from the single call record.
    expect(await store2.getCallCount('int-comm-1')).toBe(1);

    const state = await reconstructGatewayState(store2);
    expect(state.nullifiers.has('int-n-1')).toBe(true);
    expect(state.nullifiers.has('int-n-2')).toBe(true);
    expect(state.callCounts.get('int-comm-1')).toBe(1);

    const n2 = await store2.getNullifier('int-n-2');
    expect(n2?.spentOnChain).toBe(true);
  });

  it('rejects duplicate proof hash on insert', async () => {
    const store = new PostgresGatewayStore(pool);
    await expect(
      store.recordAcceptedCall(
        {
          proofHash: 'int-ph-1',
          nullifier: 'int-n-other',
          epoch: 20260804,
          slot: 1,
          nonceHash: 'int-nh-1',
          acceptedAt: new Date(),
        },
        'int-comm-1',
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('round-trips the full proof + pub signals for the spend settlement queue', async () => {
    const store1 = new PostgresGatewayStore(pool);
    await store1.recordAcceptedCall(
      {
        proofHash: 'int-ph-queue',
        nullifier: 'int-n-queue',
        epoch: 20260804,
        slot: 0,
        nonceHash: 'int-nh-queue',
        acceptedAt: new Date(),
        proof: { a: 'A1', b: 'B1', c: 'C1' },
        pubSignals: ['root', 'int-n-queue', 'x', 'y', '20260804'],
      },
      'int-comm-queue',
    );

    // Restart: a fresh store instance resumes the pending queue with the
    // persisted proof intact.
    const store2 = new PostgresGatewayStore(pool);
    const pending = await store2.listAcceptedCalls({ onlyPendingSpend: true });
    const queued = pending.find((c) => c.proofHash === 'int-ph-queue');
    expect(queued).toBeDefined();
    expect(queued?.proof).toEqual({ a: 'A1', b: 'B1', c: 'C1' });
    expect(queued?.pubSignals).toEqual(['root', 'int-n-queue', 'x', 'y', '20260804']);

    // Worker settles: markSpendResult sets the tx hash + spent flag + durable
    // nullifier spent-on-chain record.
    await store2.markSpendResult('int-ph-queue', 'tx-queue-1');
    const settled = await store2.listAcceptedCalls();
    const row = settled.find((c) => c.proofHash === 'int-ph-queue');
    expect(row?.spentOnChain).toBe(true);
    expect(row?.onChainSpendTx).toBe('tx-queue-1');
    expect((await store2.getNullifier('int-n-queue'))?.spentOnChain).toBe(true);
    const after = await store2.listAcceptedCalls({ onlyPendingSpend: true });
    expect(after.find((c) => c.proofHash === 'int-ph-queue')).toBeUndefined();
    expect(after.find((c) => c.proofHash === 'int-ph-1')).toBeDefined(); // prior-test row still pending
  });

  it('stores API-key issuance but never links commitment to calls (privacy)', async () => {
    const store = new PostgresGatewayStore(pool);
    await store.createApiKey('int-keyhash', 'int-comm-1', 'integration');
    const rec = await store.getApiKey('int-keyhash');
    expect(rec?.commitment).toBe('int-comm-1');

    // accepted_calls rows carry only nullifiers — no commitment column.
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'gateway' AND table_name = 'accepted_calls'`,
    );
    expect(cols.rows.map((r) => r.column_name)).not.toContain('commitment');
  });
});
