-- 0007: Quarantine malformed and pre-indexed settlement rows (M4.0).
-- Rows predating the indexed-ticket payload must not remain in the retry queue
-- forever. Preserve them for audit while making their terminal state explicit.
ALTER TABLE gateway.accepted_calls
    ADD COLUMN IF NOT EXISTS settlement_status text NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS settlement_error text,
    ADD COLUMN IF NOT EXISTS quarantined_at timestamptz;

ALTER TABLE gateway.accepted_calls
    DROP CONSTRAINT IF EXISTS accepted_calls_settlement_status_check;

ALTER TABLE gateway.accepted_calls
    ADD CONSTRAINT accepted_calls_settlement_status_check
    CHECK (settlement_status IN ('pending', 'settled', 'quarantined'));

UPDATE gateway.accepted_calls
SET settlement_status = 'quarantined',
    settlement_error = CASE
      WHEN proof_json IS NULL OR pub_signals IS NULL
        THEN 'legacy settlement row is missing proof or public signals'
      ELSE 'legacy settlement row has non-indexed public signals'
    END,
    quarantined_at = now()
WHERE settlement_status = 'pending'
  AND (
    proof_json IS NULL
    OR pub_signals IS NULL
    OR jsonb_typeof(pub_signals) <> 'array'
    OR (jsonb_typeof(pub_signals) = 'array' AND jsonb_array_length(pub_signals) <> 4)
  );

CREATE INDEX IF NOT EXISTS idx_accepted_calls_settlement_status
    ON gateway.accepted_calls (settlement_status);
