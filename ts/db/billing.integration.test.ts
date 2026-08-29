import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { PostgresBillingStore } from './billing.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/zk_credits_test';
const dbTestsEnabled = process.env.RUN_DB_TESTS === '1';

describe.skipIf(!dbTestsEnabled)('PostgresBillingStore (integration, requires Postgres)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await pool.query(`DELETE FROM billing.stripe_events`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('is idempotent across redeliveries and a fresh store instance (webhook retry)', async () => {
    const store1 = new PostgresBillingStore(pool);
    const first = await store1.recordStripeEventOnce('evt_int_1', 'checkout.session.completed', 'h1');
    expect(first.inserted).toBe(true);

    // Stripe retry: same event id, possibly on a different process — the
    // durable row must make the second delivery a no-op.
    const store2 = new PostgresBillingStore(pool);
    const retry = await store2.recordStripeEventOnce('evt_int_1', 'checkout.session.completed', 'h1');
    expect(retry.inserted).toBe(false);
    expect(retry.event.processed).toBe(false);

    await store2.markStripeEventProcessed('evt_int_1');
    expect((await store2.getStripeEvent('evt_int_1'))?.processed).toBe(true);
  });

  it('records distinct event ids independently', async () => {
    const store = new PostgresBillingStore(pool);
    await store.recordStripeEventOnce('evt_int_a', 'checkout.session.completed', 'h1');
    const b = await store.recordStripeEventOnce('evt_int_b', 'payment_intent.succeeded', 'h2');
    expect(b.inserted).toBe(true);
    // The two ids recorded by this test are both present and independent.
    const all = await store.listStripeEvents();
    const ids = all.map((e) => e.eventId);
    expect(ids).toContain('evt_int_a');
    expect(ids).toContain('evt_int_b');
    expect(ids.filter((id) => id === 'evt_int_b')).toHaveLength(1);
  });
});
