# Grant demo local validation — 2026-10-07

The approved public sandbox is implemented locally. No deployment, package
publication, recording, grant submission, or live payment is claimed.

Verified:

- Backend: 413 tests passed; 42 environment-gated tests skipped in the default
  run. Backend TypeScript check passed.
- Disposable Postgres: 13 sandbox checks passed, including duplicate payments,
  concurrent reservations, cross-account ownership, restart reconciliation,
  confirmed reverts, unknown outcomes, sponsor fencing across connections, and
  rerunning migrations on the same database.
- Web: 53 unit tests passed, including Stripe SDK signature verification,
  session-derived identity, same-origin protection, and Checkout session reuse,
  completion, expiration, and failed binding. TypeScript and production build
  passed.
- Browser: all 13 Chromium flows passed. Onboarding tests mock the billing/Base
  responses while using real local authentication and credential crypto. They
  verify activation gating, download/re-import, unknown outcomes across reload,
  insufficient-USDC retry, and absence of credential secrets in browser storage.
- Sidecar: 117 tests and build passed. The local `--task-evidence` candidate uses
  a dedicated sidecar, private environment token, fixed provider, and aggregate
  counters. A successful exit with settled responses reports `exchange_verified`;
  it does not prove that the coding change is correct.
- Indexer sample: two expected failures and two passes. A manually written
  reference fix passed all four tests in a disposable copy. The repository
  sample remains deliberately broken for the recorded coding task.

External verification remains:

1. Stripe TEST Checkout and actual webhook delivery. The inspected local launch
   configurations have no Stripe test key or webhook secret.
2. Confirmed Base Sepolia funding with the configured sponsor, contract, gas,
   allowance, and deployed tier. No chain write was made during these checks.
3. A paid Codex indexer run using an activated credential, with the actual diff,
   passing tests, and that run's dedicated payment summary.
4. Package publication/deployment and the reviewed video, separately authorized.

All gateway processes sharing the sponsor must use the same billing database
and sponsor gate. Separate operator tools or deployments using another database
must not write concurrently from that wallet. A hashless ambiguous broadcast or
successful replacement without a matching funding event remains reserved and
fences new funding; it needs chain reconciliation or operator investigation,
never an automatic rebroadcast or speculative refund.

See [the recording guide](base-zk-credits-grant-video.md),
[the sample](../../examples/base-usdc-indexer/README.md), and
[the billing decision](../wayfinder/base-zk-credits-pilot/decisions/004-account-linked-sandbox-billing.md).

After explicit owner approval, the [local validation update](https://github.com/mangekyou-labs/haze-api/issues/35#issuecomment-6033269099)
was posted to issue 35. Both disposable databases were removed after the checks;
existing databases were left untouched.
