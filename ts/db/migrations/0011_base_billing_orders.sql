-- Base / Stripe control-plane orders.
-- These rows intentionally live in billing, never in spend_plane. The
-- commitment is needed to sponsor/release the immutable bond, while account
-- ownership is used only to authorize the purchase/status control plane.
CREATE TABLE IF NOT EXISTS billing.private_credit_orders (
  order_id                  TEXT PRIMARY KEY,
  tier_id                   SMALLINT NOT NULL CHECK (tier_id IN (0, 1, 2)),
  account_id                TEXT NOT NULL CHECK (length(account_id) BETWEEN 1 AND 255),
  commitment                TEXT NOT NULL,
  status                    TEXT NOT NULL CHECK (status IN (
    'pending', 'paid_pending_sponsorship', 'sponsoring', 'funded',
    'release_pending', 'refund_pending', 'refunded', 'slashed', 'chargeback'
  )),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at                   TIMESTAMPTZ,
  funded_at                 TIMESTAMPTZ,
  expiry_at                 TIMESTAMPTZ,
  challenge_ends_at         TIMESTAMPTZ,
  sponsorship_started_at    TIMESTAMPTZ,
  stripe_session_id         TEXT UNIQUE,
  funding_transaction       TEXT,
  bond_release_transaction  TEXT,
  refund_transaction        TEXT,
  refund_attempts           INTEGER NOT NULL DEFAULT 0 CHECK (refund_attempts >= 0),
  last_error                TEXT
);

CREATE INDEX IF NOT EXISTS private_credit_orders_account_status_idx
  ON billing.private_credit_orders (account_id, status);
CREATE INDEX IF NOT EXISTS private_credit_orders_maturity_idx
  ON billing.private_credit_orders (status, challenge_ends_at);

