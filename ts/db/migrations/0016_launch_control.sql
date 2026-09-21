-- Durable launch controls for the invite-only unpaid pilot: a single manual
-- kill switch and unlinked integer-micro-USD provider-spend accounting.
--
-- Neither table stores a credential, nullifier, request signal, provider
-- generation id, or participant identity, so a control or monitoring read can
-- never be joined back to a spend-plane claim. The debit ledger is keyed by its
-- own sequence only; `spend_plane.claims` remains the only place a nullifier or
-- request-signal digest may appear.

-- One row, always id 1. `enabled` is the pilot default; `paused` blocks invite
-- funding and new inference while health, aggregate status, and the
-- authenticated recovery controls stay reachable.
CREATE TABLE IF NOT EXISTS control_plane.launch_control (
  control_id  SMALLINT PRIMARY KEY CHECK (control_id = 1),
  state       TEXT NOT NULL CHECK (state IN ('enabled', 'paused')),
  reason      TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 200),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (state = 'enabled' OR reason IS NOT NULL)
);

INSERT INTO control_plane.launch_control (control_id, state, reason, updated_at)
VALUES (1, 'enabled', NULL, now())
ON CONFLICT (control_id) DO NOTHING;

-- Conservative provider-spend debits. A row is created before each network
-- dispatch, moves to `retained` once the request has left the process
-- (including provider errors and timeouts), and to `released` only when the
-- failure happened before dispatch. Only rows that still count against the
-- caps are indexed, so the window sums stay cheap.
CREATE TABLE IF NOT EXISTS spend_plane.dispatch_debits (
  debit_id         BIGSERIAL PRIMARY KEY,
  amount_micro_usd BIGINT NOT NULL CHECK (amount_micro_usd > 0),
  state            TEXT NOT NULL DEFAULT 'held' CHECK (state IN ('held', 'retained', 'released')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at       TIMESTAMPTZ,
  CHECK (state = 'held' OR settled_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS dispatch_debits_open_window_idx
  ON spend_plane.dispatch_debits (created_at)
  WHERE state <> 'released';
