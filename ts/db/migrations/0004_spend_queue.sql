-- 0004: Durable spend settlement-queue payload (M2.6).
-- The per-call async on-chain spend() worker needs the full RLN proof +
-- public signals after a restart to resume the queue idempotently. These are
-- public inputs only (no secret_k, no commitment-to-call linkage).
ALTER TABLE gateway.accepted_calls
    ADD COLUMN IF NOT EXISTS proof_json    text,
    ADD COLUMN IF NOT EXISTS pub_signals   jsonb;