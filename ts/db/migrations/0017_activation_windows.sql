-- Founder activation windows for the invite-only unpaid pilot.
--
-- One row per operator slot. The row holds a slot, an invite handle, the fixed
-- slot assignment, a baseline aggregate committed-claim count, an assistance
-- count, the validated (already redacted) evidence bundle, and the aggregate
-- committed-claim count observed after activation.
--
-- It deliberately holds no operator identity, no invite or funding code, no
-- credential, no nullifier, no request signal, and no funding token. The
-- committed-claim comparison is between two global integers, so no read of
-- this table can be joined to a spend-plane claim.
--
-- `slot` is the primary key: a slot is assigned once and cannot be silently
-- replaced by a second activation.

CREATE TABLE IF NOT EXISTS control_plane.activation_windows (
  slot                      TEXT PRIMARY KEY CHECK (slot IN ('A', 'B', 'C')),
  invite_id                 TEXT NOT NULL,
  participant_type          TEXT NOT NULL CHECK (participant_type IN ('coding_agent', 'x402_native_agent')),
  integration_mode          TEXT NOT NULL CHECK (integration_mode IN ('openai_compatible_sidecar', 'x402_zk_prepaid_adapter')),
  started_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  baseline_committed_claims BIGINT NOT NULL CHECK (baseline_committed_claims >= 0),
  assistance_count          INTEGER NOT NULL DEFAULT 0 CHECK (assistance_count >= 0),
  evidence                  JSONB,
  evidence_digest           TEXT CHECK (evidence_digest IS NULL OR evidence_digest ~ '^[0-9a-f]{64}$'),
  committed_claims_after    BIGINT CHECK (committed_claims_after IS NULL OR committed_claims_after >= 0),
  CHECK ((evidence IS NULL) = (evidence_digest IS NULL))
);

-- The deterministic slot assignment, enforced so a row cannot disagree with
-- the published cohort: A and C are OpenAI-compatible sidecar daily drivers,
-- B is an existing x402-native agent that registers the project adapter.
ALTER TABLE control_plane.activation_windows
  DROP CONSTRAINT IF EXISTS activation_windows_slot_assignment_check;

ALTER TABLE control_plane.activation_windows
  ADD CONSTRAINT activation_windows_slot_assignment_check CHECK (
    (slot IN ('A', 'C') AND participant_type = 'coding_agent' AND integration_mode = 'openai_compatible_sidecar')
    OR (slot = 'B' AND participant_type = 'x402_native_agent' AND integration_mode = 'x402_zk_prepaid_adapter')
  );
