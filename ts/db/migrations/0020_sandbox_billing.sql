-- Public sandbox billing is deliberately account-linked. Spend claims stay separate.
CREATE SCHEMA IF NOT EXISTS sandbox_billing;
CREATE TABLE sandbox_billing.accounts (
  account_id text PRIMARY KEY,
  balance_cents integer NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  reserved_cents integer NOT NULL DEFAULT 0 CHECK (reserved_cents >= 0 AND reserved_cents <= balance_cents)
);
CREATE TABLE sandbox_billing.topups (
  topup_id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES sandbox_billing.accounts(account_id),
  request_id uuid NOT NULL,
  session_id text UNIQUE,
  record jsonb NOT NULL,
  UNIQUE (account_id, request_id)
);
CREATE INDEX sandbox_topups_account ON sandbox_billing.topups(account_id);
CREATE TABLE sandbox_billing.bundles (
  commitment text PRIMARY KEY,
  account_id text NOT NULL REFERENCES sandbox_billing.accounts(account_id),
  record jsonb NOT NULL
);
CREATE INDEX sandbox_bundles_account ON sandbox_billing.bundles(account_id);
