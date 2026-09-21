-- Durable public Base event index for contract roots and sponsorship state.
-- This is control-plane chain data, intentionally separate from spend_plane.
CREATE TABLE IF NOT EXISTS billing.base_contract_events (
  event_id         TEXT PRIMARY KEY,
  contract_address TEXT NOT NULL,
  block_number     BIGINT NOT NULL,
  block_hash       TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index        INTEGER NOT NULL,
  event_name       TEXT NOT NULL CHECK (event_name IN ('BundleFunded', 'MerkleRootUpdated', 'BondSlashed', 'BondReleased')),
  args             JSONB NOT NULL,
  observed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_address, transaction_hash, log_index)
);

CREATE INDEX IF NOT EXISTS base_contract_events_scan_idx
  ON billing.base_contract_events (contract_address, block_number, log_index);

CREATE TABLE IF NOT EXISTS billing.base_chain_state (
  contract_address      TEXT PRIMARY KEY,
  last_scanned_block    BIGINT,
  last_scanned_block_hash TEXT,
  current_root          TEXT,
  known_roots           TEXT[] NOT NULL DEFAULT '{}',
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
