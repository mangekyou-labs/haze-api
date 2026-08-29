-- Paper-aligned indexed-ticket records.
-- The anonymous relay stores public ticket points and request digests only;
-- no commitment or checkout identity is added to accepted_calls.

ALTER TABLE gateway.accepted_calls
    ADD COLUMN IF NOT EXISTS signal_x text,
    ADD COLUMN IF NOT EXISTS signal_y text,
    ADD COLUMN IF NOT EXISTS request_digest text,
    ADD COLUMN IF NOT EXISTS response_status integer,
    ADD COLUMN IF NOT EXISTS response_json text,
    ADD COLUMN IF NOT EXISTS provider_generation_id text;

ALTER TABLE gateway.nullifier_records
    ADD COLUMN IF NOT EXISTS signal_x text,
    ADD COLUMN IF NOT EXISTS signal_y text,
    ADD COLUMN IF NOT EXISTS request_digest text,
    ADD COLUMN IF NOT EXISTS first_proof_hash text;

CREATE INDEX IF NOT EXISTS idx_accepted_calls_ticket_tuple
    ON gateway.accepted_calls (nullifier, signal_x, signal_y, request_digest);
