-- Base / x402 zk-prepaid spend plane.
-- This schema is intentionally unrelated to accounts, wallets, purchases, and
-- credential commitments. Only replay authorization metadata is retained.
CREATE SCHEMA IF NOT EXISTS spend_plane;

CREATE TABLE IF NOT EXISTS spend_plane.claims (
  nullifier TEXT PRIMARY KEY,
  signal_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'committed', 'cancelled')),
  reservation_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  encrypted_replay TEXT
);

CREATE INDEX IF NOT EXISTS claims_reservation_state_idx
  ON spend_plane.claims (state, updated_at);

COMMENT ON TABLE spend_plane.claims IS
  'x402 zk-prepaid replay state; never join to accounts, purchases, wallets, prompts, or commitments';
