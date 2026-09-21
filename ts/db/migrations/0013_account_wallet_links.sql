-- Optional account-control-plane Base wallet links.
-- This table is intentionally separate from spend_plane and billing orders.
CREATE TABLE IF NOT EXISTS billing.account_wallet_links (
  account_id     TEXT PRIMARY KEY CHECK (length(account_id) BETWEEN 1 AND 255),
  wallet_address TEXT NOT NULL UNIQUE CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  linked_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

