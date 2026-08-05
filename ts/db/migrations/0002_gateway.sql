-- 0002: Gateway durable state tables (M2.2).
-- Replaces the gateway's in-memory Maps (API keys, nullifier cache, call
-- counts) with durable rows. Privacy boundary: accepted_calls/non-nullifier
-- tables carry NO commitment, so a call can never be linked to a deposit in
-- this schema. Call counts are kept in their own table keyed by commitment
-- only for quota/status (never joined to accepted_calls).

-- Accepted calls: the durable record of every call the gateway accepted,
-- written BEFORE the request is forwarded upstream. This is the basis of the
-- restart-durability guarantee (an accepted call is never lost or duplicated).
CREATE TABLE IF NOT EXISTS gateway.accepted_calls (
    proof_hash        text PRIMARY KEY,          -- SHA-256 of proof + public signals (request replay key)
    nullifier         text NOT NULL,             -- RLN nullifier (per secret_k, epoch)
    epoch             bigint NOT NULL,           -- UTC day number
    slot              integer NOT NULL,          -- 0..RLN window-1
    nonce_hash        text NOT NULL,             -- request nonce hash
    accepted_at       timestamptz NOT NULL DEFAULT now(),
    on_chain_spend_tx text,                      -- per-call async on-chain spend tx hash (null until submitted)
    spent_on_chain    boolean NOT NULL DEFAULT false
);

-- Nullifier records: durable fast-path replay cache. A nullifier is inserted
-- when a call is accepted off-chain; spent_on_chain flips to true when an
-- on-chain NullifierSpent event is observed (or the on-chain read returns true).
CREATE TABLE IF NOT EXISTS gateway.nullifier_records (
    nullifier     text PRIMARY KEY,
    epoch         bigint NOT NULL,
    slot          integer NOT NULL,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    spent_on_chain boolean NOT NULL DEFAULT false,
    spent_at      timestamptz
);

-- API key records: durable issuance + lookup. Only the SHA-256 key hash is
-- stored (never the raw sk-zk-... value). commitment is issuance-audit only
-- and is NOT referenced by any accepted_calls row.
CREATE TABLE IF NOT EXISTS gateway.api_key_records (
    key_hash    text PRIMARY KEY,                -- SHA-256 of the sk-zk-... key
    commitment  text NOT NULL,                   -- issuance audit only; not linked to calls
    label       text NOT NULL,
    issued_at   timestamptz NOT NULL DEFAULT now(),
    revoked_at  timestamptz
);

-- Per-commitment epoch call counts for quota + dashboard status. Kept separate
-- from accepted_calls so a commitment is never joined to a proof/call.
CREATE TABLE IF NOT EXISTS gateway.call_counts (
    commitment text NOT NULL,
    epoch      bigint NOT NULL,
    call_count bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (commitment, epoch)
);

CREATE INDEX IF NOT EXISTS idx_accepted_calls_nullifier
    ON gateway.accepted_calls (nullifier);
CREATE INDEX IF NOT EXISTS idx_accepted_calls_epoch
    ON gateway.accepted_calls (epoch);
CREATE INDEX IF NOT EXISTS idx_nullifier_records_spent
    ON gateway.nullifier_records (spent_on_chain);
CREATE INDEX IF NOT EXISTS idx_api_key_records_commitment
    ON gateway.api_key_records (commitment);