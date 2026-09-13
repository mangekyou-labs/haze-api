---
phase: implementation
title: Stellar Launch — Level 4 implementation record
description: Reconciled implementation notes for the evaluation milestone
---

# Stellar Launch — Level 4 implementation record

Date: 2026-09-13
Feature slug: `stellar-launch`  
Status: wallet-optional scope approved; local behavior update in progress; hosted restore and synthetic verification complete; hosted product/evidence gates pending

This document is updated after each planned task. It records target-branch
facts only; donor-worktree claims and stale screenshots are not evidence.

## Integration rules

- Preserve `ts/server.ts` launch routes and the existing gateway store.
- Preserve `submitDeposit` staged reservation/contract/activation and indexed
  ticket allocation.
- Reuse the initialized gateway Pool for evaluation Postgres state.
- Keep `EVALUATION_HMAC_SECRET` server-side in web only.
- Keep `EVALUATION_PURGE_SECRET` on the gateway only; never reuse `GATEWAY_SECRET`.
- Never export or send raw wallet/signature/subject/request material.
- Wallet proof is optional compatibility behavior. It must not gate the primary
  checkout, gateway-funded deposit, feedback, completion, or evidence path.
- Do not claim crash-after-accept as resume-without-resubmit. Tree
  reconstruction blocks a second leaf; receipt hash needs a reconciler that
  this milestone does not include.

## Scope-change follow-up

On 2026-09-13 the Level 4 audience was narrowed to normal Web2 and agentic
coding users. The approved design is recorded in
[`docs/superpowers/specs/2026-09-13-stellar-launch-web2-evaluation-design.md`](../../superpowers/specs/2026-09-13-stellar-launch-web2-evaluation-design.md).

The original implementation and evidence below document the wallet-gated
behavior that shipped before this decision. Follow-up tasks T8.G–T8.I replace
the primary journey and its completion/evidence predicates with the approved
wallet-optional contract. The gateway-funded staged Stellar testnet deposit,
Stripe retry behavior, browser-held commitment, privacy boundaries, and
optional wallet API invariants remain in scope.

## Task record

### T1 — domain invariants, memory store, and migration contract (complete)

Added `ts/evaluation.ts` as an isolated domain adapter and
`ts/db/migrations/0009_evaluation.sql` as the ninth migration. The adapter
derives opaque HMAC identities, enforces the exact consent version
`level4-2026-09-11`, verifies canonical SEP-53 Testnet proofs, enforces
challenge expiry/rate limits and unique wallet/deposit ownership, validates
feedback, tracks checkout receipts, purges raw proof material after 90 days,
and exports only redacted evidence after ten unique completed records.

The migration creates the isolated `evaluation` schema and participant,
challenge, and checkout tables with retention, ownership, status, and feedback
constraints. `SCHEMAS` now includes `evaluation`; the original launch schemas
remain unchanged.

Fresh narrow evidence from the target worktree:

- Red: `npm test -- --run evaluation.test.ts` failed because the implementation
  did not exist.
- Green: `npm test -- --run evaluation.test.ts db/migrate.test.ts db/config.test.ts`
  passed (26 tests, 1 opt-in database test skipped).
- `npm run typecheck` passed after building the existing shared package.

The next lifecycle step after T1 was the Postgres adapter using the gateway's
injected pool and migration lifecycle; that task is recorded below.

### T2 — Postgres adapter and gateway lifecycle injection (complete)

Added `PostgresEvaluationStore` with the same contract as the memory adapter,
using a narrow injected `SqlPool`. It maps restricted rows to redacted status,
uses unique database ownership constraints for wallets/deposits/checkouts,
guards one-time challenges with a conditional update, and purges raw proof
columns in place. The target gateway now creates this adapter from the same
Pool used by `PostgresGatewayStore` and `PostgresBillingStore` immediately
after the existing migration runner; test reset restores an injected memory
adapter. No separate evaluation pool or migration lifecycle was introduced.

Fresh evidence:

- `cd ts && npm run typecheck` passed.
- `cd ts && npm test -- --run server.test.ts evaluation-postgres.integration.test.ts evaluation.test.ts db/migrate.test.ts`
  passed (73 tests, 4 opt-in tests skipped without a database).
- With a disposable local Postgres cluster and `RUN_DB_TESTS=1`,
  `npm test -- --run evaluation-postgres.integration.test.ts` passed (3 tests),
  including migration idempotence, cross-instance status durability, proof
  persistence, and concurrent same-session checkout ownership.

### T3 — authenticated gateway evaluation router (complete)

Mounted the evaluation endpoints alongside the existing launch routes in
`ts/server.ts`. Every evaluation request now requires the gateway bearer
secret and an opaque 64-hex participant identifier. Enrollment enforces the
exact consent version; status responses remain pseudonymous; challenge,
canonical SEP-53 proof, feedback, deposit-link, and checkout receipt handlers
delegate to the injected evaluation store. Validation and domain errors are
returned as stable public error codes without raw signatures, messages,
wallet addresses, subjects, or other proof material. The existing
`/v1/deposits` handler and staged `submitDeposit` path were not changed.

Fresh evidence:

- Red: `cd ts && npm test -- --run evaluation-routes.test.ts` initially
  failed because all evaluation routes were absent (404).
- Green: `cd ts && npm test -- --run evaluation-routes.test.ts server.test.ts`
  passed (57 tests).
- `cd ts && npm run typecheck` passed.

### T4 — checkout claims and retryable billing integration (complete)

Extended the evaluation receipt contract with an atomic processing claim and a
five-minute recovery lease. Memory and Postgres stores now allow only one
worker to submit a checkout at a time, record attempt state, and reclaim a
failed or expired processing receipt. The Postgres adapter uses a conditional
`UPDATE` so concurrent workers cannot both claim the same session.

The billing webhook now distinguishes payload conflicts from processed
duplicates, resumes failed/unprocessed events, and routes evaluation deposits
through the existing `submitDeposit` staged reservation, indexed-ticket, and
activation path. A confirmed receipt is the durable chain-result anchor, so a
retry can repair participant linkage without submitting a second deposit.
Launch-era `/v1/deposits` and checkout behavior remains intact.

Fresh evidence:

- `cd ts && npm test -- --run evaluation.test.ts server.test.ts` passed (67
  tests), covering atomic memory claims, failed retry, duplicate
  acknowledgement, retryable webhook failure, and concurrent evaluation
  webhook handling.
- `RUN_DB_TESTS=1 TEST_DATABASE_URL=postgres://localhost:55432/postgres npm test -- --run evaluation-postgres.integration.test.ts`
  passed (4 tests) against a disposable local Postgres cluster, including
  migration idempotence, cross-instance durability, ownership-safe insertion,
  and one-claim/reclaim behavior. The run caught and fixed an explicit
  PostgreSQL `timestamptz` cast issue in the retry update.
- `cd ts && npm run typecheck` passed.

The next task adds the web relay and consent-gated evaluation checkout/status
experience while preserving launch onboarding and checkout.

### T5 — web proxies, checkout, and receipt ownership (complete)

Added server-only web evaluation transport and identity helpers. The proxy
derives the HMAC participant ID from the authenticated session, sends it only
as `x-evaluation-participant-id` with `GATEWAY_SECRET`, uses bounded upstream
timeouts, and exposes allowlisted routes for enrollment, status, challenge,
wallet proof, feedback, deposits, checkout, and checkout status. The receipt
route verifies the Stripe session's evaluation participant metadata before
reading the participant-scoped gateway receipt.

Extended the existing checkout API with a separate consent/enrollment-gated
evaluation tier. It creates an exact 100-cent Stripe test-mode session with
opaque participant metadata and the browser-held decimal commitment; the
launch starter path keeps its existing one-dollar metadata and deposit amount.
The Stripe webhook now uses a filtered relay builder: evaluation events carry
session ownership and amount cents to the gateway's durable claim path, while
legacy events retain the launch billing payload and no evaluation header.

Fresh evidence from the target worktree:

- Red: new web identity, transport, relay, checkout, receipt, and route tests
  initially failed to resolve their not-yet-created production modules.
- Green: focused web proxy/checkout/receipt/relay/identity tests passed (19
  tests).
- `cd web && npm run typecheck` passed after regenerating the target web
  install from its own manifest and lockfile.

T6 is now active: add the dashboard evaluation flow, consented analytics, and
recursive Sentry scrubbing without moving evaluation secrets into browser
code.

### T6 — dashboard evaluation flow and privacy telemetry (complete)

Historical T6 implementation: added an additive client-only evaluation card to
the existing dashboard. It kept launch onboarding, browser-held identity
generation, indexed ticket status, agent configuration, playground, and
Starter checkout in place while adding a four-stage progress view for consent,
wallet proof, payment, and feedback. Enrollment was gated by the exact consent
version and explicitly described restricted 90-day retention. Freighter proof
requests required the Testnet network, displayed only a redacted wallet, and
never rendered a signature or raw transaction hash. The `$1` evaluation
checkout was disabled until enrollment, wallet verification, and a
browser-held commitment were all present; receipt reconciliation used bounded
polling and exposed only status plus a safe explorer link.

The wallet-gated dashboard behavior is superseded by the approved follow-up:
the primary card will omit Freighter and will enable checkout from enrollment
plus a browser-held commitment. Confirmed gateway-funded deposit, then
feedback, will determine completion.

Added opt-in-only PostHog tracking with an explicit event/property allowlist,
memory persistence, no autocapture/pageviews/session recording, public-code
identification, logout reset, and recursive sensitive-field filtering. Added
browser Sentry instrumentation for client, server, and edge runtimes with
`sendDefaultPii: false`, no traces/breadcrumbs, and the same recursive scrubber.
The target web manifest and lockfile were regenerated with `posthog-js` and
`@sentry/nextjs`; no donor lockfile was copied.

Fresh evidence:

- Red: focused analytics and scrub tests initially failed to resolve their
  not-yet-created production modules.
- Green: `cd web && npm test -- --run src/lib/analytics.test.ts src/lib/sentry-scrub.test.ts src/components/analytics-session-reset.test.ts src/app/api/evaluation/analytics/route.test.ts src/app/api/evaluation/routes.test.ts`
  passed (5 files, 13 tests).
- `cd web && npm run typecheck` passed.
- `cd web && npm run lint` passed with zero errors; six pre-existing warnings
  remain outside this task's new code.
- `cd web && npm run build` passed with the target Sentry instrumentation.
- `cd web && npm run test:e2e -- e2e/level4.spec.ts` passed (1 test), covering
  consent gating, mocked Freighter Testnet proof, commitment gating, `$1`
  checkout, and receipt confirmation.

### T7 — service telemetry, retention operations, and synthetic monitoring (complete)

Added the same recursive, depth-bounded Sentry scrubber and PII-disabled
initialization to the gateway and fee-sponsor service. Both services accept
only their own `SENTRY_DSN` configuration; the gateway still receives no
`EVALUATION_HMAC_SECRET`. Added a dedicated-secret
`POST /v1/internal/evaluation/purge` endpoint plus a non-overlapping daily
Postgres-backed scheduler. The route returns only an anonymized count and
logs only a count or safe error class.

Added `scripts/level4-synthetic.mjs` and focused Node tests. It requires the
exact `LEVEL4_FRONTEND_URL`, `LEVEL4_GATEWAY_URL`, and
`LEVEL4_FEE_SPONSOR_URL` variables, probes four health/readiness paths,
retries transient failures within bounded limits, labels three sequential
passes `cold`, `warm`, `warm`, and never prints URLs or response bodies. The
scheduled/manual `.github/workflows/deploy-smoke.yml` job now runs this
monitor, and the Level 4 branch is included in the normal CI push trigger.
Target service manifests and lockfiles were regenerated independently.

Fresh evidence:

- `cd ts && npm test -- --run telemetry/sentry.test.ts telemetry/sentry-scrub.test.ts`
  passed (4 tests).
- `cd ts && npm test -- --run evaluation-routes.test.ts` passed (7 tests),
  including the dedicated purge route and bounded non-overlapping scheduler.
- `cd services/fee-sponsor && npm test` passed (1 test) and
  `npm run typecheck` passed.
- `node --test scripts/level4-synthetic.test.mjs && node --check scripts/level4-synthetic.mjs`
  passed (3 tests).
- Web analytics regression tests passed after ensuring stale opt-in state
  cannot capture before initialization and a submitted survey emits once.

### T8 — final verification and lifecycle reconciliation (complete locally)

T8 originally recorded a clean-tree matrix of 196 gateway tests / 60 web tests
/ 5 Postgres cases. Phase 7 remediations below supersede those counts. Hosted
restore and synthetic verification are now recorded below; cohort, fresh
screenshots/video, telemetry exports, hosted checkout, and GitHub publication
remain external acceptance gates until direct evidence exists.

### Phase 7 remediations (complete locally)

Check Implementation found local design gaps after T8. The target worktree
now includes:

- `wallet_fingerprint` (SHA-256, unique 64-hex) retained after 90-day raw
  proof purge; same-wallet re-verify is idempotent and does not restore
  address/signature; a different wallet still fails `wallet_already_used`.
- Public status keys `wallet.verified` and `complete` currently key on
  `wallet_verified_at`; evidence `isComplete` currently requires a raw wallet
  address. These are known wallet-gated predicates to be replaced by T8.G;
  the approved target is deposit-plus-feedback completion and walletless
  evidence eligibility.
- Monotonic `markCheckout` / `claimCheckout`: `confirmed` cannot be
  downgraded (`processing_status <> 'confirmed'`).
- Transactional challenge rate-limit: `connect` / `BEGIN` /
  `SELECT … FOR UPDATE` then count the last 15 minutes.
- Checkout amount is exactly 100 cents (`amount_cents = 100`,
  `EVALUATION_CHECKOUT_AMOUNT_CENTS`) and evaluation Stripe requires
  `sk_test_`.
- Browser POSTs on `/api/evaluation/checkout`, `/checkout/status`, and
  `/deposit` return 405 via `evaluationMethodNotAllowed` (`Allow: GET` on
  checkout; `Allow: OPTIONS` on the mutation-only POSTs). App Router
  handlers take `NextRequest` so `tsc` accepts the tests.
- Stripe/billing errors return a stable public code only (`stripe_error`,
  `billing_event_failed`); exception text is not leaked.
- `.env.example`, `web/.env.example`, and `render.yaml` document
  `EVALUATION_HMAC_SECRET` (web only) and `EVALUATION_PURGE_SECRET`
  (gateway only).
- Crash-window honesty: if Stellar accepts the deposit and the process dies
  before the receipt stores the hash, tree reconstruction prevents a second
  leaf, but the hash cannot be rebuilt without a chain reconciler. No
  reconciler was added.

This-session local matrix (2026-09-12, logs in `/tmp/stellar-l4-matrix/`):

- `npx ai-devkit@latest lint --feature stellar-launch`: EXIT 0. This
  validates the 2026-08-04 `feature-stellar-launch` document set and that
  `.worktrees/feature-stellar-launch` exists; it does not lint the
  2026-09-11-stellar-launch-level4 filenames.
- Gateway typecheck EXIT 0; `cd ts && npm test`: 22 files passed | 4
  skipped (26); 198 passed | 19 skipped (217).
- Disposable Postgres
  `RUN_DB_TESTS=1 TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres npm test -- --run evaluation-postgres.integration.test.ts`:
  8 passed (migration twice, persistence, concurrent ownership, claim/reclaim,
  monotonic confirmed, post-purge ownership, concurrent challenge limit).
- Web tests: 20 files, 62 passed. Web typecheck initially failed
  `TS2554` on 405 POSTs with no request argument; handlers now take
  `POST(_req: NextRequest)` and typecheck EXIT 0. Lint: 0 errors, 6 existing
  warnings. Build EXIT 0 (Next.js lockfile-root warning only). E2E
  `E2E_PORT=3210 npm run test:e2e`: 17 passed, including mocked
  `e2e/level4.spec.ts`.
- Shared package 23 tests; sidecar 64 tests plus pack dry-run; fee sponsor
  typecheck and 1 test; circuits all passed; synthetic monitor 3 tests;
  `cargo +1.94 test` 24 passed (6 existing `unused_mut` warnings).

The hosted Level 4 deploy and three-pass synthetic monitor are now live:

- Web: <https://feature-zk-api-credits.vercel.app> (Vercel production
  deployment `dpl_BQLepbjZd7Nt1aJioeuqXoVKepgc`, Ready).
- Gateway: <https://zk-credits-gateway.onrender.com> (`/health` and
  `/v1/contract-status` returned 200).
- Fee sponsor: <https://zk-credits-fee-sponsor.onrender.com> (`/health`
  returned 200).
- Render services run Level 4 commit
  `3c81f9907d60f455a10e5564a72f8570cf262c29` against the new restricted store
  `zk-credits-db-level4-20260913`; gateway durable PostgreSQL initialization
  was logged twice at 02:15:02Z and 02:18:29Z.
- Web-only evaluation/Stripe/gateway configuration is present in Vercel
  production and the Level 4 preview target. The gateway does not receive
  `EVALUATION_HMAC_SECRET`.

The three GitHub `LEVEL4_*` repository variables are configured. Deploy Smoke
run [34736294570](https://github.com/mangekyou-labs/haze-api/actions/runs/34736294570)
passed its `level4-synthetic` job on the Level 4 SHA; its separate legacy
hosted-smoke job remains failed on old unconfigured secrets/template and
dependency-install behavior. Cohort remains 0 / 10. Hosted Stripe
checkout/explorer evidence, telemetry, exporter, hosted screenshots, and
demonstration remain unset. The donor
`feature-zk-api-credits` tree is not the submit candidate.

CI on GitHub Actions Node 24.20.0 / npm 11.19.0 first failed `npm ci` for Web,
Gateway, and Fee-sponsor (Fee-sponsor failed at the nested `ts/` install)
with `Missing: @emnapi/runtime@1.11.3 from lock file` (Web also
`@emnapi/core@1.11.3`). Local Node 24.10.0 / npm 11.6.1 did not require those
optional peer entries. `ts/package-lock.json` and `web/package-lock.json`
were regenerated with npm 11.19.0; `ci.yml` Node installs are pinned to
24.20.0. After push of `de394b3`, hosted CI succeeded: PR
[34691343208](https://github.com/mangekyou-labs/haze-api/actions/runs/34691343208)
and push
[34691342078](https://github.com/mangekyou-labs/haze-api/actions/runs/34691342078),
all seven jobs success (Gateway, Web, Fee-sponsor, Shared, Sidecar, Circuits,
Soroban). Package CI is not hosted synthetic, Stripe, Sentry, PostHog, or
cohort evidence. The fresh `node scripts/level4-synthetic.mjs` run from the
Level 4 worktree passed `cold`, `warm`, `warm`; all four checks returned 200.

### T8.F — wallet-optional documentation reconciliation (in progress)

The approved wallet-optional design, requirements, planning, implementation,
testing, deployment, monitoring, and evidence records are being reconciled in
the target worktree. Hosted restore and synthetic facts remain complete; the
walletless product path is not yet deployed or externally accepted.

### T8.G — walletless gateway behavior (todo)

Add failing memory, Postgres, and route tests for deposit linking, feedback,
completion, and ten-record evidence without wallet proof. Then remove wallet
checks from those gates while preserving optional wallet challenge/proof
validation, ownership, purge, checkout claims, and the existing gateway-funded
staged deposit path.

### T8.H — walletless dashboard path (todo)

Add failing web/E2E coverage with no Freighter provider, remove the required
wallet step and wallet-gated checkout/feedback conditions, and preserve
browser-held commitment checkout, receipt polling, explorer-safe status,
feedback validation, and logout analytics reset.

### T8.I — follow-up verification and acceptance reconciliation (todo)

Run the affected and full local verification matrix, update the evidence index
with fresh results, and record hosted T8.B–E as pending until direct Stripe,
explorer, telemetry, cohort, screenshot, demo, and final-review evidence
exists.
