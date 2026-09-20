-- Durable fencing and replay lifecycle for the isolated Base spend plane.
-- This migration is additive: the original claims table remains the only
-- place where nullifiers and request-signal digests may be stored.

ALTER TABLE spend_plane.claims
  DROP CONSTRAINT IF EXISTS claims_state_check,
  DROP CONSTRAINT IF EXISTS claims_generation_positive,
  DROP CONSTRAINT IF EXISTS claims_dispatch_count_bounded;

ALTER TABLE spend_plane.claims
  ADD COLUMN IF NOT EXISTS generation BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS fencing_token TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS dispatch_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS replay_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatch_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS commit_idempotency_key TEXT;

UPDATE spend_plane.claims
   SET fencing_token = md5(nullifier || ':' || reservation_id::text)
 WHERE fencing_token = '';

UPDATE spend_plane.claims
   SET lease_expires_at = updated_at + INTERVAL '5 minutes'
 WHERE state = 'reserved';

UPDATE spend_plane.claims
   SET replay_expires_at = updated_at + INTERVAL '24 hours'
 WHERE encrypted_replay IS NOT NULL AND replay_expires_at IS NULL;

ALTER TABLE spend_plane.claims
  ALTER COLUMN fencing_token DROP DEFAULT,
  ADD CONSTRAINT claims_state_check CHECK (state IN ('reserved', 'ready', 'committed', 'cancelled')),
  ADD CONSTRAINT claims_generation_positive CHECK (generation > 0),
  ADD CONSTRAINT claims_dispatch_count_bounded CHECK (dispatch_count BETWEEN 0 AND 2);

CREATE UNIQUE INDEX IF NOT EXISTS claims_nullifier_signal_idx
  ON spend_plane.claims (nullifier, signal_hash);

CREATE INDEX IF NOT EXISTS claims_lease_idx
  ON spend_plane.claims (state, lease_expires_at);

COMMENT ON COLUMN spend_plane.claims.fencing_token IS
  'Opaque spend-plane worker fence; stale generations cannot mutate a claim';
COMMENT ON COLUMN spend_plane.claims.dispatch_count IS
  'Durable upstream dispatch budget, capped at two attempts';
COMMENT ON COLUMN spend_plane.claims.encrypted_replay IS
  'Client-encrypted response only; plaintext is never stored';
