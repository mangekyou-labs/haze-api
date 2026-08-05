-- 0005: Fee-relay request idempotency (M2.4).
-- Stores each fee-bumped inner transaction hash so retries never double-
-- sponsor (a given slash/withdraw inner tx is sponsored exactly once).
CREATE TABLE IF NOT EXISTS "fee-sponsor".fee_relay_requests (
    inner_tx_hash   text PRIMARY KEY,        -- sha-256 of the inner tx XDR (idempotency key)
    method          text NOT NULL,           -- 'slash' | 'withdraw' (validated)
    contract_id     text NOT NULL,           -- the validated target contract
    inner_tx_xdr    text NOT NULL,
    status          text NOT NULL DEFAULT 'received',  -- received | submitted | failed
    fee_bump_hash   text,
    submitted_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fee_relay_status
    ON "fee-sponsor".fee_relay_requests (status);