-- Invite-only unpaid pilot: control-plane invites and provisioning-plane funding
-- capabilities.
--
-- control_plane owns GitHub-facing invite state. pilot_provisioning owns
-- detached funding capabilities. The two schemas are deliberately separate:
-- there is no foreign key, no shared identifier, and no durable join between
-- them, so the provisioning plane never learns which GitHub account a funding
-- capability came from and the control plane never learns which commitment a
-- capability funded.

CREATE SCHEMA IF NOT EXISTS control_plane;
CREATE SCHEMA IF NOT EXISTS pilot_provisioning;

-- Single-use founder-issued invites. Only the SHA-256 digest of the code is
-- durable; the plaintext code exists solely in the founder's terminal and the
-- holder's browser. There is no commitment column: the control plane never
-- receives spend-plane data.
CREATE TABLE IF NOT EXISTS control_plane.pilot_invites (
  invite_id         TEXT PRIMARY KEY CHECK (invite_id ~ '^inv_[A-Za-z0-9_-]{16,64}$'),
  code_hash         TEXT NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  github_account_id TEXT NOT NULL CHECK (length(github_account_id) BETWEEN 1 AND 255),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,
  redeemed_at       TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  CONSTRAINT pilot_invite_expiry CHECK (expires_at > created_at),
  CHECK (redeemed_at IS NULL OR revoked_at IS NULL)
);

-- Detached funding capabilities. Only the SHA-256 digest of the token is
-- durable. There is no invite id, account id, or other cross-plane identifier
-- column: a commitment may not be joined back to a GitHub account.
CREATE TABLE IF NOT EXISTS pilot_provisioning.funding_capabilities (
  capability_id      TEXT PRIMARY KEY CHECK (capability_id ~ '^cap_[A-Za-z0-9_-]{16,64}$'),
  token_hash         TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  state              TEXT NOT NULL DEFAULT 'issued' CHECK (state IN ('issued', 'funding', 'funded', 'failed')),
  commitment         TEXT UNIQUE CHECK (commitment IS NULL OR commitment ~ '^[0-9]+$'),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL,
  attempt_started_at TIMESTAMPTZ,
  bound_at           TIMESTAMPTZ,
  funded_at          TIMESTAMPTZ,
  bundle_expiry      TIMESTAMPTZ,
  transaction_hash   TEXT,
  failure_reason     TEXT,
  CHECK (created_at < expires_at),
  CHECK (state <> 'funded' OR (commitment IS NOT NULL AND bundle_expiry IS NOT NULL AND transaction_hash IS NOT NULL AND funded_at IS NOT NULL))
);
