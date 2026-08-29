// Billing webhook idempotency store tests (M2.3). Memory store is fully
// exercised offline; the Postgres store runs against real Postgres when
// RUN_DB_TESTS=1.

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryBillingStore } from './billing.js';

describe('MemoryBillingStore (billing webhook contract)', () => {
  let store: MemoryBillingStore;

  beforeEach(() => {
    store = new MemoryBillingStore();
  });

  it('records a first delivery as inserted', async () => {
    const { inserted } = await store.recordStripeEventOnce(
      'evt_checkout_1',
      'checkout.session.completed',
      'hash-1',
    );
    expect(inserted).toBe(true);
  });

  it('treats a redelivered event id as a duplicate (idempotent)', async () => {
    await store.recordStripeEventOnce('evt_dup', 'checkout.session.completed', 'hash-1');
    const retry = await store.recordStripeEventOnce('evt_dup', 'checkout.session.completed', 'hash-1');
    expect(retry.inserted).toBe(false);
    expect(retry.event.eventId).toBe('evt_dup');
  });

  it('marks processed after the deposit is submitted', async () => {
    await store.recordStripeEventOnce('evt_ok', 'checkout.session.completed', 'hash-1');
    await store.markStripeEventProcessed('evt_ok');
    const event = await store.getStripeEvent('evt_ok');
    expect(event?.processed).toBe(true);
    expect(event?.processedAt).toBeTruthy();
  });

  it('lists events in insertion order', async () => {
    await store.recordStripeEventOnce('evt_a', 'checkout.session.completed', 'h1');
    await store.recordStripeEventOnce('evt_b', 'charge.succeeded', 'h2');
    const events = await store.listStripeEvents();
    expect(events.map((e) => e.eventId)).toEqual(['evt_a', 'evt_b']);
  });
});
