-- Keep every slot activation attempt so a failed onboarding can be safely
-- reconciled and retried without deleting its invite handle or evidence.
-- The existing one-row-per-slot table is renamed in place so its contents,
-- including a running activation, survive the migration.

ALTER TABLE control_plane.activation_windows RENAME TO activation_attempts;

ALTER TABLE control_plane.activation_attempts
  DROP CONSTRAINT activation_windows_pkey;

ALTER TABLE control_plane.activation_attempts
  ADD COLUMN attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number > 0),
  ADD COLUMN invite_request_id TEXT,
  ADD COLUMN status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('invite_pending', 'open', 'submitted', 'needs_reconciliation', 'aborted', 'rejected', 'qualified')),
  ADD COLUMN funding_outcome TEXT NOT NULL DEFAULT 'unknown'
    CHECK (funding_outcome IN ('unknown', 'not_funded', 'funded')),
  ADD COLUMN qualification_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN closed_at TIMESTAMPTZ;

ALTER TABLE control_plane.activation_attempts
  ALTER COLUMN invite_id DROP NOT NULL;

ALTER TABLE control_plane.activation_attempts
  RENAME CONSTRAINT activation_windows_slot_assignment_check TO activation_attempts_slot_assignment_check;

ALTER TABLE control_plane.activation_attempts
  ADD CONSTRAINT activation_attempts_pkey PRIMARY KEY (slot, attempt_number),
  ADD CONSTRAINT activation_attempts_invite_request_id_check
    CHECK (invite_request_id IS NULL OR invite_request_id ~ '^[A-Za-z0-9_-]{16,128}$');

-- Rows from the old schema remain intact. Evidence submitted before this
-- migration is revalidated by the application before it unlocks the next slot.
UPDATE control_plane.activation_attempts
   SET status = CASE WHEN evidence IS NULL THEN 'open' ELSE 'submitted' END,
       -- Aggregate claims cannot be joined to a particular invite or detached
       -- funding capability. Preserve the submitted evidence for explicit
       -- reconciliation instead of inferring a funding result from the count.
       funding_outcome = 'unknown';

CREATE UNIQUE INDEX activation_attempts_invite_request_id_unique
  ON control_plane.activation_attempts (invite_request_id)
  WHERE invite_request_id IS NOT NULL;

CREATE UNIQUE INDEX activation_attempts_evidence_digest_unique
  ON control_plane.activation_attempts (evidence_digest)
  WHERE evidence_digest IS NOT NULL;

-- A still-open attempt blocks another attempt for the same slot. The command
-- layer also serializes global starts under a transaction advisory lock; this
-- permits pre-migration databases with more than one historical open slot to
-- migrate without discarding or rewriting those records.
CREATE UNIQUE INDEX activation_attempts_one_active_per_slot
  ON control_plane.activation_attempts (slot)
  WHERE status IN ('invite_pending', 'open', 'submitted', 'needs_reconciliation');

-- A generated invite whose insert committed while its response was lost can
-- be found and revoked by its idempotency key before a retry is issued.
ALTER TABLE control_plane.pilot_invites
  ADD COLUMN creation_request_id TEXT;

ALTER TABLE control_plane.pilot_invites
  ADD CONSTRAINT pilot_invites_creation_request_id_check
    CHECK (creation_request_id IS NULL OR creation_request_id ~ '^[A-Za-z0-9_-]{16,128}$');

CREATE UNIQUE INDEX pilot_invites_creation_request_id_unique
  ON control_plane.pilot_invites (creation_request_id)
  WHERE creation_request_id IS NOT NULL;
