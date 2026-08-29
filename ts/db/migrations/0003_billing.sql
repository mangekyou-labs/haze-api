-- 0003: Billing webhook idempotency (M2.3).
-- Stripe webhook retries deliver the same event id multiple times; this table
-- makes checkout->webhook->deposit idempotent so a retry never double-submits
-- a deposit. Privacy: stores only webhook send/processing state + event type —
-- no customer PII, no card data, no commitment-to-call linkage.
CREATE TABLE IF NOT EXISTS billing.stripe_events (
    event_id      text PRIMARY KEY,      -- Stripe event id (retry key)
    event_type    text NOT NULL,
    payload_hash  text NOT NULL,         -- sha-256 of the verified raw payload
    received_at   timestamptz NOT NULL DEFAULT now(),
    processed     boolean NOT NULL DEFAULT false,
    processed_at  timestamptz
);