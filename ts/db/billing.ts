// Billing webhook idempotency store (M2.3).
//
// Stripe may redeliver a webhook (same event id) after a timeout or 4xx, and
// its "checkout.session.completed" delivery must be processed exactly once —
// otherwise a retry would double-submit an on-chain deposit. Both
// implementations expose the same contract; tests exercise the memory store
// offline and the Postgres store against a real instance (RUN_DB_TESTS=1).

export interface StripeEvent {
  eventId: string;
  eventType: string;
  payloadHash: string;
  receivedAt: Date;
  processed: boolean;
  processedAt: Date | null;
}

export interface BillingStore {
  /**
   * Idempotent insert. Returns `true` when this event id was NOT yet recorded
   * (first delivery — the caller should process it), `false` on duplicates
   * (retry — the caller must not process again).
   */
  recordStripeEventOnce(
    eventId: string,
    eventType: string,
    payloadHash: string,
  ): Promise<{ inserted: boolean; event: StripeEvent }>;
  markStripeEventProcessed(eventId: string): Promise<void>;
  getStripeEvent(eventId: string): Promise<StripeEvent | null>;
  listStripeEvents(): Promise<StripeEvent[]>;
}

// ─── In-memory implementation (offline tests / dev) ─────────────

export class MemoryBillingStore implements BillingStore {
  private events = new Map<string, StripeEvent>();

  async recordStripeEventOnce(
    eventId: string,
    eventType: string,
    payloadHash: string,
  ): Promise<{ inserted: boolean; event: StripeEvent }> {
    const existing = this.events.get(eventId);
    if (existing) return { inserted: false, event: existing };
    const event: StripeEvent = {
      eventId,
      eventType,
      payloadHash,
      receivedAt: new Date(),
      processed: false,
      processedAt: null,
    };
    this.events.set(eventId, event);
    return { inserted: true, event };
  }

  async markStripeEventProcessed(eventId: string): Promise<void> {
    const existing = this.events.get(eventId);
    if (!existing) return;
    existing.processed = true;
    existing.processedAt = new Date();
  }

  async getStripeEvent(eventId: string): Promise<StripeEvent | null> {
    return this.events.get(eventId) ?? null;
  }

  async listStripeEvents(): Promise<StripeEvent[]> {
    return [...this.events.values()];
  }

  /** Test/dev helper. */
  reset(): void {
    this.events.clear();
  }
}

// ─── PostgreSQL implementation ────────────────────────────────────

import type { Pool } from 'pg';

function rowToStripeEvent(r: Record<string, unknown>): StripeEvent {
  return {
    eventId: r.event_id as string,
    eventType: r.event_type as string,
    payloadHash: r.payload_hash as string,
    receivedAt: r.received_at as Date,
    processed: r.processed as boolean,
    processedAt: (r.processed_at as Date) ?? null,
  };
}

export class PostgresBillingStore implements BillingStore {
  constructor(private readonly pool: Pool) {}

  async recordStripeEventOnce(
    eventId: string,
    eventType: string,
    payloadHash: string,
  ): Promise<{ inserted: boolean; event: StripeEvent }> {
    let insert: { rows: Array<Record<string, unknown>> };
    try {
      insert = await this.pool.query(
        `INSERT INTO billing.stripe_events (event_id, event_type, payload_hash)
         VALUES ($1, $2, $3)
         RETURNING event_id, event_type, payload_hash, received_at, processed, processed_at`,
        [eventId, eventType, payloadHash],
      );
    } catch (err: unknown) {
      // Unique violation (SQLSTATE 23505) → the event id was already recorded
      // (Stripe redelivery). The code lives in err.code, not the message.
      const code = (err as { code?: string }).code;
      if (code === '23505') {
        const existing = await this.getStripeEvent(eventId);
        if (!existing) throw err;
        return { inserted: false, event: existing };
      }
      throw err;
    }
    const event = rowToStripeEvent(insert.rows[0]);
    return { inserted: true, event };
  }

  async markStripeEventProcessed(eventId: string): Promise<void> {
    await this.pool.query(
      `UPDATE billing.stripe_events SET processed = true, processed_at = now()
       WHERE event_id = $1`,
      [eventId],
    );
  }

  async getStripeEvent(eventId: string): Promise<StripeEvent | null> {
    const res = await this.pool.query(
      `SELECT event_id, event_type, payload_hash, received_at, processed, processed_at
       FROM billing.stripe_events WHERE event_id = $1`,
      [eventId],
    );
    if (res.rows.length === 0) return null;
    return rowToStripeEvent(res.rows[0] as Record<string, unknown>);
  }

  async listStripeEvents(): Promise<StripeEvent[]> {
    const res = await this.pool.query(
      `SELECT event_id, event_type, payload_hash, received_at, processed, processed_at
       FROM billing.stripe_events ORDER BY received_at ASC`,
    );
    return res.rows.map((r) => rowToStripeEvent(r as Record<string, unknown>));
  }
}
