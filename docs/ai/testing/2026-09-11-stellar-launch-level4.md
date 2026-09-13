---
phase: testing
title: Stellar Launch — Level 4 verification record
description: Fresh verification evidence for the additive evaluation milestone
---

# Stellar Launch — Level 4 verification record

Date: 2026-09-13
Feature slug: `stellar-launch`  
Status: wallet-optional scope approved; follow-up verification pending; hosted restore and synthetic verification complete; release evidence pending

Only commands run in the clean Level 4 worktree may be recorded here. Donor
claims, development screenshots, and stale lockfile results are excluded.

## Scope-change follow-up

The historical rows below include the original Freighter-gated implementation.
The approved wallet-optional design now requires fresh tests for a participant
with no `window.freighterApi`: browser-held identity, exact consent, `$1`
checkout, gateway-funded confirmed deposit, feedback, completion, evidence
eligibility, and logout analytics reset. Optional wallet challenge/proof and
purge invariants remain regression coverage but are not primary-flow gates.
The new follow-up results will be appended after each T8.G–T8.I task; no
hosted checkout, telemetry, screenshot, demo, or cohort evidence is inferred
from the historical mocked E2E.

## Local command matrix

This-session matrix (2026-09-12) after Phase 7 remediations. Logs:
`/tmp/stellar-l4-matrix/`. Do not reuse the earlier T8 196/60/5 counts.

| Area | Command | Result |
|---|---|---|
| AI DevKit lint | `npx ai-devkit@latest lint --feature stellar-launch` | EXIT 0. Validates 2026-08-04 `feature-stellar-launch` docs and `.worktrees/feature-stellar-launch`; does not lint 2026-09-11-stellar-launch-level4 filenames |
| Gateway typecheck/tests | `cd ts && npm run typecheck && npm test` | pass (typecheck EXIT 0; 22 files passed, 4 skipped; 198 passed, 19 skipped) |
| Disposable Postgres | `RUN_DB_TESTS=1 TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres npm test -- --run evaluation-postgres.integration.test.ts` | pass (8 tests; migration twice, persistence, concurrent ownership, claim/reclaim, monotonic confirmed, post-purge ownership, concurrent challenge limit) |
| Web tests | `cd web && npm test` | pass (20 files; 62 tests) |
| Web typecheck/lint/build | `cd web && npm run typecheck && npm run lint && npm run build` | typecheck initially `TS2554` on 405 POSTs; after `POST(_req: NextRequest)`, typecheck EXIT 0; lint 0 errors and 6 existing warnings; build EXIT 0 (Next.js lockfile-root warning) |
| Web E2E | `E2E_PORT=3210 npm run test:e2e` | pass (17 tests, including mocked `e2e/level4.spec.ts`) |
| Shared package | `cd packages/zk-credits-shared && npm ci && npm run build && npm test` | pass (build; 23 tests) |
| Sidecar package | `cd packages/zk-credits-sidecar && npm ci && npm run build && npm test && npm pack --dry-run` | pass (build; 64 tests; pack dry-run) |
| Fee sponsor | `cd services/fee-sponsor && npm run typecheck && npm test` | pass (typecheck; 1 test) |
| Circuits | `cd circuits && npm ci && node scripts/test.js` | pass (circuit, RLN, withdrawal, and slash suites) |
| Soroban contract | `cd zk-credits-contract && cargo +1.94 test` | pass (24 tests; 6 existing `unused_mut` warnings) |
| Synthetic monitor | `node --test scripts/level4-synthetic.test.mjs`; `node --check scripts/level4-synthetic.mjs` | pass (3 tests) |
| Whitespace | `git diff --check` | pass (EXIT 0 after Phase 7 docs and remediations) |

## T1 narrow evidence

| Behavior | Command | Result |
|---|---|---|
| Identity, consent, SEP-53, expiry/replay, rate limits, ownership, feedback, retention, checkout, redacted evidence, post-purge ownership | `cd ts && npm test -- --run evaluation.test.ts` | pass (14 tests) |
| Migration ordering/isolation and schema registry | `cd ts && npm test -- --run db/migrate.test.ts db/config.test.ts` | pass (14 tests; 1 opt-in database test skipped) |

The failing-first evidence for T1 is recorded in the implementation document;
the initial run failed to resolve `./evaluation.js` before the adapter was
implemented. No external deployment or cohort evidence is claimed.

## T2 narrow evidence

| Behavior | Command | Result |
|---|---|---|
| Postgres migration twice, restart durability, concurrent ownership, monotonic confirmed, post-purge fingerprint, concurrent challenge limit | `RUN_DB_TESTS=1 TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres npm test -- --run evaluation-postgres.integration.test.ts` | pass (8 tests, disposable local cluster) |
| Gateway lifecycle injection and evaluation adapter compile | `npm run typecheck` | pass |

## T3 narrow evidence

| Authenticated route boundary, consent/status redaction, proof replay, validation, feedback ordering, deposit linking, checkout ownership | `cd ts && npm test -- --run evaluation-routes.test.ts server.test.ts` | pass (57 tests) |
| Gateway route type safety | `cd ts && npm run typecheck` | pass |

## T4 narrow evidence

| Behavior | Command | Result |
|---|---|---|
| Atomic memory checkout claims, failed-claim recovery, duplicate acknowledgement, retryable webhook failure, and concurrent evaluation webhook handling | `cd ts && npm test -- --run evaluation.test.ts server.test.ts` | pass (67 tests) |
| Postgres migration twice, restart durability, ownership-safe insertion, and concurrent claim/reclaim | `RUN_DB_TESTS=1 TEST_DATABASE_URL=postgres://localhost:55432/postgres npm test -- --run evaluation-postgres.integration.test.ts` | pass (4 tests, disposable local cluster) |
| Gateway adapter and billing integration type safety | `cd ts && npm run typecheck` | pass |

## T5 narrow evidence

| Web participant identity, consent version, and commitment validation | `cd web && npm test -- --run src/lib/evaluation-identity.test.ts src/lib/evaluation-checkout.test.ts` | pass (4 tests) |
| Authenticated proxy field allowlists, 405 browser mutations, and gateway transport headers | `cd web && npm test -- --run src/lib/evaluation-transport.test.ts src/app/api/evaluation/routes.test.ts` | pass (7 tests) |
| Consent-gated evaluation checkout, launch starter regression, and no leaked Stripe exception text | `cd web && npm test -- --run src/app/api/checkout/route.test.ts` | pass (4 tests) |
| Filtered Stripe relay payloads and receipt ownership | `cd web && npm test -- --run src/lib/stripe-relay.test.ts src/lib/evaluation-receipt.test.ts src/app/api/checkout/receipt/route.test.ts` | pass (6 tests) |
| Web route type safety | `cd web && npm run typecheck` | pass |

## T6 narrow evidence

| Behavior | Command | Result |
|---|---|---|
| Opt-in-only PostHog initialization, event/property allowlist, duration clamping, and logout reset | `cd web && npm test -- --run src/lib/analytics.test.ts src/components/analytics-session-reset.test.ts` | pass (5 tests; the standalone analytics regression below adds 6 current assertions) |
| Recursive browser Sentry scrub, including nested arrays and bounded depth | `cd web && npm test -- --run src/lib/sentry-scrub.test.ts` | pass (2 tests) |
| Explicit analytics opt-in route and evaluation route regression | `cd web && npm test -- --run src/app/api/evaluation/analytics/route.test.ts src/app/api/evaluation/routes.test.ts` | pass (6 tests) |
| Historical dashboard evaluation consent, wallet, checkout, and receipt UI | `cd web && npm run test:e2e -- e2e/level4.spec.ts` | pass (1 test; mocked gateway/Stripe/Freighter; superseded as primary-flow evidence by the walletless follow-up) |
| Web type safety, lint, and production instrumentation build | `cd web && npm run typecheck`; `cd web && npm run lint`; `cd web && npm run build` | pass; lint has 0 errors and 6 pre-existing warnings |

## T7 narrow evidence

| Behavior | Command | Result |
|---|---|---|
| Gateway Sentry initialization and recursive scrub | `cd ts && npm test -- --run telemetry/sentry.test.ts telemetry/sentry-scrub.test.ts` | pass (4 tests) |
| Dedicated retention purge authorization and bounded scheduler | `cd ts && npm test -- --run evaluation-routes.test.ts` | pass (7 tests) |
| Fee-sponsor scrubber and Sentry service boundary | `cd services/fee-sponsor && npm test`; `cd services/fee-sponsor && npm run typecheck` | pass (1 test); pass |
| Synthetic URL validation, bounded retry, three cold/warm labels, and redacted output | `node --test scripts/level4-synthetic.test.mjs`; `node --check scripts/level4-synthetic.mjs` | pass (3 tests) |
| Browser analytics regression after privacy fixes | `cd web && npm test -- --run src/lib/analytics.test.ts` | pass (6 tests) |
| CI wiring | `.github/workflows/ci.yml`, `.github/workflows/deploy-smoke.yml` inspected; exact variables and branch trigger present | pass (static review); hosted variables not available locally |
| CI `npm ci` lockfiles | GitHub Actions CI on `de394b3` after regenerating `ts/` and `web/` lockfiles with npm 11.19.0 and pinning `ci.yml` to Node 24.20.0 | Hosted pass. PR run [34691343208](https://github.com/mangekyou-labs/haze-api/actions/runs/34691343208) and push run [34691342078](https://github.com/mangekyou-labs/haze-api/actions/runs/34691342078) both `success`. All seven jobs succeeded: Gateway, Web, Fee-sponsor, Shared, Sidecar, Circuits, Soroban. Earlier `fb60e83` Install failures (`Missing: @emnapi/runtime@1.11.3`, Web also `@emnapi/core@1.11.3`) are closed. |

## Phase 7 remediation evidence

| Behavior | Command | Result |
|---|---|---|
| Fingerprint ownership, post-purge idempotent re-verify, status keyed on `wallet_verified_at` | `cd ts && npm test -- --run evaluation.test.ts` | pass (14 tests, including post-purge ownership) |
| Postgres monotonic confirmed, post-purge fingerprint, concurrent challenge `FOR UPDATE` | disposable cluster, 8 integration tests above | pass |
| 405 browser mutations (`Allow: GET` on checkout POST) | `cd web && npm test -- --run src/app/api/evaluation/routes.test.ts src/app/api/checkout/route.test.ts` | pass (9 tests) |
| App Router `POST(_req: NextRequest)` typecheck | `cd web && npm run typecheck` | pass after the handler signature fix |

## T8 final reconciliation

The package-wide rows above were run from the Level 4 worktree after Phase 7
remediations. The requirement audit confirms the exact consent version and
participant ID shape, isolated migration `0009`, optional
`wallet_fingerprint` after purge, testnet-only SEP-53 proof rules, 90-day
purge, unique deposit/session ownership, monotonic checkout claims, 405
browser mutations, transactional challenge limits, filtered Stripe relay
metadata, opt-in telemetry, recursive scrubbing, and preservation of the
launch-era deposit and ticket-allocation path. The walletless
completion/evidence predicates are a follow-up behavior change and remain
unverified until T8.G tests pass.

The crash window after chain accept and before receipt-hash persistence is
documented; it is not claimed as resume-without-resubmit.

Hosted GitHub Actions CI for SHA `de394b3` is green (PR run 34691343208,
push run 34691342078; all seven jobs success). That is package CI, not a
hosted evaluation gate.

External release artifacts remain pending until hosted Stripe checkout and
explorer evidence, telemetry access, fresh screenshots/video, and ten
distinct consenting participants are available.

Fresh hosted restore facts from 2026-09-13:

- Web: <https://feature-zk-api-credits.vercel.app>, Vercel production
  deployment `dpl_BQLepbjZd7Nt1aJioeuqXoVKepgc` Ready from
  `3c81f9907d60f455a10e5564a72f8570cf262c29`.
- Gateway: <https://zk-credits-gateway.onrender.com>; `/health` and
  `/v1/contract-status` returned 200.
- Fee sponsor: <https://zk-credits-fee-sponsor.onrender.com>; `/health`
  returned 200.
- New restricted database: `zk-credits-db-level4-20260913`; gateway logs
  recorded durable PostgreSQL initialization twice at 02:15:02Z and 02:18:29Z.
- Vercel production and the Level 4 preview target contain the required web
  evaluation/Stripe/gateway configuration. The gateway does not contain the
  web-only `EVALUATION_HMAC_SECRET`.

The fresh `node scripts/level4-synthetic.mjs` command passed all three labels
(`cold`, `warm`, `warm`); every frontend, gateway health, gateway contract
status, and fee-sponsor health check returned 200. It printed only service
labels, statuses, durations, and retry counts. The three GitHub `LEVEL4_*`
variables are configured, and Deploy Smoke run
[34736294570](https://github.com/mangekyou-labs/haze-api/actions/runs/34736294570)
on the Level 4 SHA passed its `level4-synthetic` job at 2026-09-13T03:46:11Z.
The workflow’s separate legacy hosted-smoke job failed on its old unconfigured
secret/template and dependency-install step; it is not the Level 4 synthetic
gate. Cohort remains 0 / 10.

## Required behavior evidence

Add focused results for identity, exact consent, browser-held commitment,
walletless deposit linking, feedback and completion, optional SEP-53
expiry/replay/rate limits, unique deposit/session ownership,
receipt/concurrent webhook behavior, retention, walletless evidence redaction,
analytics allowlisting/reset, recursive scrubbing, and migration-twice/
real-Postgres cases. Mark unavailable external checks as pending or blocked
with the exact reason; never convert them into local passes.

## Walletless follow-up evidence

| Task | Behavior | Result |
|---|---|---|
| T8.G | Walletless gateway deposit, feedback, completion, and evidence | pending failing-first tests and implementation |
| T8.H | Dashboard path without Freighter, receipt/explorer state, and logout reset | pending failing-first web/E2E tests and implementation |
| T8.I | Full local matrix and hosted acceptance reconciliation | pending fresh verification after T8.G/T8.H |
