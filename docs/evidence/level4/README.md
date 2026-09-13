# Stellar Launch — Level 4 evidence index

Snapshot: 2026-09-13
Feature slug: `stellar-launch`  
Status: hosted restore and three-pass synthetic verification complete; release evidence pending

This index is intentionally conservative. It will contain only fresh deployed
links, consented cohort records, redacted exports, and current screenshots
after those artifacts are directly verified. No donor-worktree screenshot,
development capture, or unrelated transaction is counted as Level 4 evidence.

## Required submission artifacts

- deployed web, gateway, and fee-sponsor URLs with current health checks;
- three cold/warm synthetic passes;
- scrubbed Sentry test event and consented PostHog event evidence;
- one complete retried $1 Stripe test checkout and gateway-funded,
  explorer-confirmed deposit;
- ten distinct authenticated participants, unique deposits/transaction
  hashes, and consented feedback records; personal wallets are not required;
- generated redacted `evidence.json`/`evidence.md`;
- desktop/mobile/current dashboard screenshots with all secrets and personal
  account data removed;
- 4–6 minute unlisted demonstration;
- final branch/PR and lifecycle review references.

## Hosted deployment

Fresh hosted checks from 2026-09-13 (UTC) use the Level 4 commit
`3c81f9907d60f455a10e5564a72f8570cf262c29`:

| Component | Live URL | Fresh result |
|---|---|---|
| Web evaluation deployment | <https://feature-zk-api-credits.vercel.app> | Vercel production deployment `dpl_BQLepbjZd7Nt1aJioeuqXoVKepgc` Ready; frontend probe 200 |
| Gateway | <https://zk-credits-gateway.onrender.com> | `/health` 200; `/v1/contract-status` 200 |
| Fee sponsor | <https://zk-credits-fee-sponsor.onrender.com> | `/health` 200 |

Render uses the new restricted Postgres instance `zk-credits-db-level4-20260913`
(created 2026-09-13T02:10:10Z). This is a fresh evaluation store after the
previous free database expired; no prior cohort data was recovered. Gateway
startup logs show durable PostgreSQL initialization twice: 2026-09-13T02:15:02Z
and 2026-09-13T02:18:29Z. The gateway has the purge secret only; the web-only
evaluation HMAC secret is configured in Vercel production and the
`feature-stellar-launch-level4` preview target.

The fresh synthetic command completed three passes without printing URLs or
bodies:

```text
pass 1 (cold) ok frontend=ok:200/1003ms/1 attempt(s) gateway-health=ok:200/231ms/1 attempt(s) gateway-contract-status=ok:200/929ms/1 attempt(s) fee-sponsor-health=ok:200/303ms/1 attempt(s)
pass 2 (warm) ok frontend=ok:200/496ms/1 attempt(s) gateway-health=ok:200/76ms/1 attempt(s) gateway-contract-status=ok:200/711ms/1 attempt(s) fee-sponsor-health=ok:200/107ms/1 attempt(s)
pass 3 (warm) ok frontend=ok:200/605ms/1 attempt(s) gateway-health=ok:200/90ms/1 attempt(s) gateway-contract-status=ok:200/781ms/1 attempt(s) fee-sponsor-health=ok:200/108ms/1 attempt(s)
```

The three GitHub `LEVEL4_*` repository variables are now set to the live URLs
above. Deploy Smoke run
[34736294570](https://github.com/mangekyou-labs/haze-api/actions/runs/34736294570)
on `feature-stellar-launch-level4` at 2026-09-13T03:46:11Z passed its
`level4-synthetic` job on the exact Level 4 commit. Its separate legacy hosted
smoke job remains failed because its old `GATEWAY_URL` secret/template is not
configured; that job is not used as the Level 4 synthetic result.

## Cohort table

| Participant | Confirmed testnet transaction | Completed | Feedback |
|---|---|---|---|---|
| 0 / 10 available | — | — | — |

The table must be populated only from the exporter after its ten-record,
unique-participant, unique-transaction gate succeeds. Full wallets, signatures,
subjects, prompts, proofs, commitments, API keys, and authorization headers
must never be committed. Freighter is not a prerequisite for a valid record.

## Local verification

Fresh local command results, including the final package-wide matrix, are recorded in
[`docs/ai/testing/2026-09-11-stellar-launch-level4.md`](../../ai/testing/2026-09-11-stellar-launch-level4.md).
The current local implementation also has fresh T4 evidence for atomic
checkout claims and retryable billing in the testing record; it is not a
deployment or cohort artifact.
The web proxy and consent-gated checkout slice also has fresh focused tests
and a clean typecheck recorded in the T5 testing record; these do not replace
deployed Stripe, explorer, telemetry, screenshot, or cohort evidence.
The dashboard consent/wallet/checkout/feedback slice, opt-in PostHog boundary,
logout reset, browser Sentry scrubber, and target production build have fresh
local evidence in the T6 testing record. The E2E uses mocked provider
boundaries; it is not a hosted checkout, explorer, or telemetry artifact.
T7 adds fresh local gateway/fee-sponsor Sentry tests, dedicated purge-route and
scheduler tests, and synthetic monitor tests; T8 adds the final cross-package
verification and persistence-race checks. Phase 7 remediations add
fingerprint ownership after purge, monotonic checkout, 405 browser mutations,
and transactional challenge limits. Hosted GitHub Actions package CI is green
on `de394b3` (PR run 34691343208, all seven jobs). That is not hosted
synthetic, Stripe, Sentry, PostHog, or cohort evidence. Cohort remains 0 / 10.
Until the external gates above are directly evidenced, this index must not
state that Level 4 is releasable.
