---
phase: testing
feature: stellar-launch
title: "stellar-launch: Testing Strategy"
description: Verification plan for the public testnet launch - hosted deployment, fee sponsorship, durable storage, PRXVT guardrails, and the six v1 open-question resolutions.
---

# Testing Strategy

## Indexed-ticket verification in progress (2026-08-11)

The revised launch gate is being exercised against the paper-aligned fixed-cost
statement:

- Shared crypto TDD covers canonical request hashing, distinct ticket slopes
  and nullifiers, same-index fork behavior, and the `0..99` bound.
- Gateway tests cover strict four-signal parsing, shared-bearer authorization,
  request-body binding, durable exact-retry idempotency, distinct ticket
  acceptance, and `fork_detected` slash evidence.
- The circuit suite passes a valid four-signal proof, rejection of index 100,
  and two root-removal statements: nine-signal ticket-fork slash and
  three-signal browser-secret withdrawal. Fresh RLN/slash/membership zkeys,
  browser artifacts, Soroban VKs, and self-verified proof fixtures are all
  generated from the current source; legacy zkeys are not launch artifacts.
- The contract test gate uses Rust 1.92+ locally (the system Rust 1.79 cannot
  parse the cached `edition2024` dependency) and passes `24/24`: strict
  four-signal spend, fresh nine-signal slash/root removal, three-signal
  withdrawal/root removal, tampered proofs, wrong VKs, and immutable statement
  key installation.
- Manual Playwright validation will use the actual `feature-stellar-launch/web`
  app: sign in, generate the browser identity/key, reserve a ticket, observe
  local proof generation and the OpenRouter response, then verify usage changes
  and the provider generation metadata in the UI.

## Browser/build reliability evidence (2026-08-11)

- [x] Offline-safe production typography: the focused Vercel-build regression
  was red while `layout.tsx` imported `next/font/google`, then passed after
  switching to local system font stacks; the full web unit suite is **16/16**.
- [x] Production Playwright gate: `CI=1 E2E_PORT=3214 npm run test:e2e` ran the
  built app with the dev-only test login and passed **13/13**. It covers the
  landing shell, auth guards, styled UI, onboarding/recovery, dashboard
  sections, and disabled integration states.
- [x] Contract artifact gate: current source compiles and `24/24` tests pass
  against the fresh RLN, slash, and membership-removal fixtures. The deprecated
  SDK event API warnings are non-failing and remain a separate follow-up.
- [x] Vercel isolated-build gate: the first preview failed on missing
  `circomlibjs`; the new direct web dependency and regression test fixed it.
  A second preview reached **Ready**, and its local-equivalent production build
  plus Playwright suite passed (`16/16` web unit tests, `13/13` browser tests).

## Settlement queue quarantine evidence (2026-08-11)

- [x] M4.0 legacy-row quarantine: TDD coverage proves missing proof payloads
  and legacy five-signal rows are marked `quarantined` with an audit reason,
  excluded from future pending-spend drains, and never submitted to Soroban.
  Migration `0007_settlement_quarantine.sql` adds the durable status/error/
  timestamp columns and backfills malformed pre-indexed rows during upgrade.
  The fresh TypeScript suite passes **140/151** with **11** opt-in skips; the
  local PostgreSQL store integration passes **5/5**, including restart-visible
  quarantine persistence.

## Current hosted operational evidence (2026-08-11)

- [x] Fee-sponsor health is currently reachable: Render returned HTTP 200.
- [ ] Gateway health is currently unavailable: three bounded probes received no
  headers before timing out. The hosted two-ticket, exact-retry, fee-bump,
  withdrawal, restart, Stripe, OAuth, and OpenRouter checks remain blocked
  pending Render gateway recovery and fresh indexed proving artifacts.

## Completed Evidence

- [x] M1.1 Type-safety gate: `ts/` and `web/` compile under strict TypeScript (`npm run typecheck` exit 0 in both); no `@ts-nocheck`/`any`/`@ts-ignore`/`@ts-expect-error` in shipped non-test code (grep count 0).
- [x] M1.1 behavior preservation: `ts/` unit suite at the pre-existing baseline (58 passed / 3 pre-existing circuit-artifact failures / 1 skipped); `server.test.ts` + `merkle.test.ts` green after the `contract.ts`/`server.ts`/`merkle.ts` type fixes.
- [x] M1.2 shared package build + unit tests: `packages/zk-credits-shared` builds (tsc → `dist/`, ESM) and `npm test` passes 7/10 (pure crypto: `generateSecretK`, `deriveMnemonic`, `recoverSecretK`, `skToField`; 3 proof tests `it.runIf`-gated on the M1.0 zkey build).
- [x] M1.2 wiring gates: `ts/` typecheck exit 0 + suite at baseline (58/3/1, behavior preserved after refactor); `web/` typecheck exit 0; shared package smoke-verified via `import()` and `require(esm)` on Node 24 (24-word mnemonic round-trip, `skToField` fr-reduction spot-check); escape-scan still 0; no `require('snarkjs')`/`createRequire`/`@scure/bip39` left in shipped `ts/`/`web/` code.
- [x] M1.3 nullifier-index bugfix regression: `ts/server.test.ts` now 24/24 (added `extractNullifier` tests proving the RLN nullifier is `pubSignals[1]`, not `pubSignals[2]` = `share_x`).
- [x] M1.3 client-path wiring: `scripts/e2e-test.js` resolves `@zk-credits/shared` from the repo root (`require(esm)` on Node 24) and `node --check` passes; deposit + RLN proof both use `skToField`-reduced `secret_k`.
- [x] M1.0 circuit artifacts (verified-consistent v1 set): `ts` suite **63/64** (1 pre-existing skip; all 3 `crypto.test.ts` deposit proof-gen tests now pass), shared package **12/12** (all proof + self-verify tests run against the artifacts), `node scripts/test.js` **all circuits pass** (deposit, rln, slash — incl. slash `secret_k` extraction match). zkey↔VK consistency confirmed via `snarkjs zkey export verificationkey` diff (deposit/rln/slash all MATCH committed `verification_key_*.json`).
- [x] M1.3 self-verify gated tests now pass: valid RLN proof self-verifies + returns (`nullifier` = `publicSignals[1]`); wrong-VK (deposit VK) rejected → `ProofSelfVerificationError` (snarkjs `TypeError` also converted to the error).
- [x] M2.1 durable-storage layer setup: `ts/db` config tests (fails closed on missing/`DATABASE_URL`/PG* config and bad `PGPORT`; parses both config forms) + migration tests pass offline (7/8, integration skipped) and integration (`RUN_DB_TESTS=1`, local Postgres 16): migrations idempotent and the three schemas `billing`/`fee-sponsor`/`gateway` created. `ts` suite now **70/72** (2 skipped: pre-existing + opt-in DB integration without `RUN_DB_TESTS`), typecheck OK.
- [x] M2.2 gateway durable store: `memory` store tests (6) cover the full `GatewayStore` contract (durable accept + duplicate-proofHash rejection, nullifier seen/spent transitions, key create/lookup/list, per-epoch → lifetime call counts, restart reconstruction returns nullifier set + call counts, pending-spend listing) and Postgres integration tests (3, `RUN_DB_TESTS=1`) prove restart durability across store instances + the privacy boundary (no commitment column on accepted_calls). Migration `0002_gateway.sql` verified offline (provisions all four tables; no commitment on accepted_calls) and against local Postgres 16.
- [x] M2.2 server wiring: `server.test.ts` now 28/28 — new cases prove a valid proof is durably accepted (accepted-call persisted **before** upstream forward), replay of the same nullifier is rejected (403), a miss leaves the call to the on-chain `is_nullifier_spent` fallback (403 + durable spent-on-chain record), and the durable quota counter rejects the 101st call. Adapter + shared-verify are mocked (no real network). `ts` suite now **81/86** (5 skipped including opt-in DB integration), typecheck OK, escape-scan 0.
- [x] M2.3 billing webhook idempotency: `MemoryBillingStore` tests (4) cover the idempotency contract (first delivery inserted, redelivery = duplicate, processed transition, ordering); Postgres integration tests (2, `RUN_DB_TESTS=1`) prove redelivery is a no-op across store instances + distinct event ids are independent. Gateway `/v1/billing/stripe-event` tests (6, in `server.test.ts`) cover: first delivery submits the deposit (txHash returned), redelivery is an idempotent duplicate (no txHash), missing commitment skips but records, non-checkout events record without deposit, auth + fails-closed. Migration `0003_billing.sql` verified offline + against local Postgres 16. `ts` suite now **92/99**, DB integration **25/25** (serial), web typecheck OK.
- [x] M2.6 spend worker settlement queue: `db/spend-queue.test.ts` (2) proves the store round-trips the full proof + pub signals and pending-spend excludes spent rows; `spend-worker.test.ts` proves drain submits indexed calls + records the tx hash, treats `NullifierAlreadySpent` as settled (no infinite retry), leaves calls pending on transient failure, never re-submits spent calls, and quarantines pre-M2.6/malformed rows without a proof or four-signal payload. Migrations `0004_spend_queue.sql` and `0007_settlement_quarantine.sql` are verified offline; Postgres integration remains opt-in.
- [x] M2.4 fee-sponsor + public fee-relay: `MemoryFeeSponsorStore` tests (4) cover relay idempotency (first wins, retry returns prior state, submit/fail transitions, ordering); Postgres integration (2, `RUN_DB_TESTS=1`) proves cross-instance idempotency on the inner tx hash. `fee-relay.test.ts` (9) builds real SDK txs to prove the method-validation gate: slash+withdraw accepted, payment (non-contract) → 403, `deposit` → 403 (not sponsored), malformed XDR → 400; `relayOne` fee-bumps + submits exactly once, is idempotent on retry, and marks `failed` + 503 on submission failure; `buildFeeBumpEnvelope` wraps the inner tx. `fee-sponsor-app.test.ts` (5, supertest) covers `/health`, accept withdraw, idempotent retry, missing inner tx (400), payment rejection (403). Migration `0005_fee_sponsor.sql` offline + Postgres-16 verified. Service boots via tsx and fails closed on missing env/DB. `ts` suite now **120/130**, DB integration **36/36** (serial), services typecheck OK.
- [x] M2.5 gateway `/v1/withdraw` co-signer: `withdraw.test.ts` (5) proves the orchestrator builds the depositor envelope, relays it to the fee sponsor once (relay-reported duplicate is a no-op), rejects missing fields (400), and surfaces 502/503 on build/relay failure. `server.test.ts` (now 38) adds `/v1/withdraw` endpoint tests: co-signed withdraw relayed with fee-bump hash returned, missing auth → 401, missing fields → 400, fee-relay rejection → 502 (contract `buildWithdrawEnvelope` and global `fetch` both mocked). `ts` suite now **129/139**, DB integration **36/36** (serial), typecheck OK.
- [x] M3.5 CI pipeline + web test baseline: `web` gained a vitest unit suite (`web/src/lib/crypto.test.ts`, 4 tests — 32-byte secret gen, 24-word BIP-39 derive→recover round-trip, `secretKToField` fr-reduction + determinism, alias stability; **the 12-word assertion was a TDD-caught error — the real implementation derives 24 words** from 32-byte entropy, matching the M1.2 record) and a Playwright E2E smoke (`web/playwright.config.ts` + `web/e2e/smoke.spec.ts`, 2 tests: landing renders + `/sign-in` "Get Started" link; **the assumed "Sign in" link label was a TDD-caught error**). Verified locally `npm test` 4/4 + `E2E_PORT=3211 npx playwright test` 2/2 (next-auth UntrustedHost server-log noise is harmless; `AUTH_URL` is set in the webServer command). `.github/workflows/ci.yml` (6-job matrix: gateway/shared/fee-sponsor/web/circuits/contract, Node 24 + `npm ci`, concurrency cancel) + `.github/workflows/deploy-smoke.yml` (post-deploy health template) created; both YAML-parse clean. Circuit artifacts un-ignored + committed (`.wasm`/`*_final.zkey` for `circuits/` + `web/public/circuits/` — a fresh checkout previously lacked the browser proof path and the CI circuits inputs).
- [x] Vercel build packaging regression (2026-08-09): the first `vercel build --yes` failed because Turbopack could not resolve the linked `@zk-credits/shared` package. A TDD regression test was added, then `web/scripts/prepare-shared-package.mjs` was implemented and wired into `prebuild`; the next `vercel build --yes` passed through compilation, serverless-function tracing, and static collection. The linked Vercel project still has no environment variables, so public promotion remains pending.
- [x] M3.1 public contract edge confirmation (2026-08-09): after restarting the attached trial Postgres machine, `GET https://zk-credits-gateway.fly.dev/v1/contract-status` returned HTTP 200 with `depositCount: 3`, a current root, the deployed contract ID, and `network: stellar:testnet`; gateway `/health` remained HTTP 200.
- [x] M3.5-CI live run → **GREEN** (2026-08-05, run 31025062673, all 6/6 jobs pass: contract 22s, fee-sponsor 25s, gateway 50s, shared 28s, web 1m12s incl. Playwright 2/2, circuits 18s). Four runs were iterated to green; each failure was a real gap local macOS dry-runs could not catch. The chain: (1) **Run 31021171827** — Gateway + Web `npm ci` failed `Missing: @emnapi/runtime@1.11.3 / @emnapi/core@1.11.3 from lock file` (mac-vs-linux platform-sensitive npm-11 arborist: top-level `@emnapi` peer entries missing from the lockfiles). Fixed by adding the missing top-level entries to `ts/` (+11) and `web/` (+22) lockfiles; **verified `npm ci` EXIT=0 in a node:24 linux container** for both. Fee-sponsor typecheck failed in the same run (TS2307/TS7006) because `@gateway/*` → `../../ts/*` imports type-check shared `ts/` sources needing gateway deps that the job never installed — the job now also `npm ci`s in `ts/` (reproduced locally: removing `ts/node_modules` → 13 errors, exit 2; fix passes exit 0 + container simulation EXIT=0). (2) **Run 31023559066** — installs green but Gateway + Web typecheck failed `Cannot find module '@zk-credits/shared'`: the `file:`-linked shared package needs its gitignored `dist/` built; `prepare`-script attempt rejected (`tsc: not found` — npm runs `prepare` without the package's devDeps), so consuming jobs (gateway/web/fee-sponsor) now run an explicit `Build @zk-credits/shared` step. (3) **Run 31024419645** — the build step failed because step-level `working-directory: ../packages/...` resolves from the repo root in GitHub Actions → fixed to repo-relative `packages/zk-credits-shared`. (4) **Run 31025062673 — GREEN.** Post-fix local re-verification (fresh installs): `ts` 129/139 exit 0, coverage exit 0 (**65.58%**), web typecheck 0 + vitest 4/4 + Playwright 2/2, shared build + 12/12, circuits all-pass, fee-sponsor typecheck 0.
- [ ] Gateway stale-root rejection (defense-in-depth) — hosted E2E (M3.3/M4.1), out of the local M2.2 scope.

## Test Coverage Goals
**What level of testing do we aim to?**

- 100% coverage of new/changed security-critical branches in the fee-sponsor, durable storage layer, proof self-verification, and isomorphic shared crypto; every uncovered line requires written rationale.
- Retain unaffected v1 gateway/contract tests, but replace every epoch-nullifier, random-signal, commitment-linked API-key, and "seen nullifier always rejects" assertion. Historical green tests for those behaviors are regression evidence for the legacy implementation, not launch acceptance.
- Hosted-testnet E2E tests exercise the public deployment (sign-in -> buy -> call -> slash -> withdraw) against the live Render/Vercel/Soroban endpoints.
- Alignment: every requirements success criterion has at least one test scenario.

## Unit Tests
**What individual components need testing?**

### Paper-aligned fixed-cost indexed tickets (release-blocking redesign)
- [ ] Circuit accepts private ticket indices `0` and `99`, rejects `100`, and proves the fixed-cost solvency specialization `(i + 1) * C_demo <= D` with `D = 100 * C_demo` and `R = 0`.
- [ ] For one `secret_k`, ticket indices `i` and `i + 1` produce distinct `a = H(k,i)` values and distinct `nullifier = H(a)` values; neither public proof reveals `i` or the deposit commitment.
- [ ] For the same ticket index and canonical request, independently generated proofs produce the same `(nullifier, x, y)` even when Groth16 proof bytes differ.
- [ ] For the same ticket index and two different canonical requests, nullifier is equal, `x`/`y` differ, and the slash circuit recovers the exact `secret_k` whose commitment is in the Merkle tree.
- [ ] A canonical request mutation (model, messages, max tokens, or other forwarded field) changes `x`; the gateway rejects a proof whose `x` does not match the exact request sent to OpenRouter.
- [ ] Same `(nullifier, x, y, requestDigest)` is idempotent and returns the stored response/status without a second OpenRouter forward. Same nullifier with different `x` is recorded as `fork_detected`, rejected before forwarding, and yields slash evidence.
- [ ] Same nullifier and `x` with a different `y` is rejected before forwarding and recorded as an integrity/collision alert, but does not enter the exact-retry path or produce invalid two-point slash evidence.
- [ ] Two independently randomized valid Groth16 proofs for the same ticket/request have different proof hashes but follow the exact-retry path; `proofHash` is never the idempotency or fork-classification key.
- [ ] Two concurrent requests with the same unseen nullifier are transactionally serialized: at most one reaches OpenRouter; a different-`x` loser preserves valid slash evidence, while an exact duplicate receives the idempotent result/status.
- [ ] The fixed Starter deposit amount is enforced by the contract; a smaller or arbitrary amount cannot enter the membership tree and acquire the 100-ticket statement.
- [ ] Spend accepts only the current active root or an unexpired additive-update grace root; slash/withdraw remove membership and invalidate every root that still contains the removed commitment.
- [ ] A proof from a slashed or withdrawn identity fails even if it was generated against a formerly valid historical root.
- [x] Indexed-ticket, slash, and withdrawal-removal artifacts are generated
  for BLS12-381; each final zkey is verified against its current R1CS and
  exports the committed VK. The new contract accepts only the fresh RLN
  four-signal, slash nine-signal, and membership three-signal layouts.
- [ ] Contract stores separate spend, slash/removal, and membership-transition VKs; each valid proof succeeds only under its matching key/layout and fails under every other key.
- [ ] Legacy `H(secret_k, epoch)` proofs and the legacy verification key are rejected by the new gateway/contract.

### Browser ticket allocator and recovery
- [ ] IndexedDB reserves ticket indices atomically under concurrent calls and never allocates one index twice.
- [ ] A crash after reservation marks/skips the ambiguous ticket instead of reusing it and risking self-slash.
- [ ] Mnemonic recovery reconstructs used indices locally by comparing all 100 derived ticket nullifiers with the public spent-ticket event set; candidate nullifiers are not submitted as an identity-linked batch to the gateway.
- [ ] Recovery's global spent-ticket snapshot includes accepted-pending and on-chain nullifiers, accepts no candidate query, and prevents reuse during the asynchronous settlement window.
- [ ] Two consecutive playground prompts reserve different indices, generate different nullifiers, return two assistant answers, and update usage `0 -> 1 -> 2`.
- [ ] The anonymous call path uses only the shared compatibility bearer and proof; no request lookup can join that bearer or accepted call to a billing commitment.
- [ ] Dashboard used/reserved/skipped/remaining counts are computed from IndexedDB plus public events; `/v1/status/:commitment` returns funding status only and no server-derived call count.

### Fee-sponsor service (new)
- [x] Valid slash transaction targeting the configured contract method is fee-bumped and returned. (covers happy path — verified M2.4: `fee-relay.test.ts` 9)
- [x] Valid withdraw transaction is fee-bumped and returned.
- [x] Transaction calling a non-slash/withdraw method is rejected with 403. (covers validation gate)
- [x] Malformed/non-contract transaction is rejected with 400.
- [x] Duplicate inner tx hash is idempotent (returns the same fee-bumped tx, no double-sponsor). (covers idempotency)
- [x] Fee bump does not alter the inner transaction's effects (byte-compare inner tx before/after wrap). (covers fee-only authority)

### Durable storage layer (new)
- [x] PostgreSQL schemas provisioned + idempotent migrations verified (M2.1): `gateway`/`billing`/`fee-sponsor` created; re-run is a no-op. (covers durable storage layer setup)
- [x] Connection config fails closed on missing/bad configuration (M2.1 config tests).
- [x] Accepted call is persisted to PostgreSQL before upstream forwarding; a crash after persist does not lose the call. (M2.2, transactional accept)
- [x] Gateway restart reconstructs nullifier cache + call counts + settlement queue from durable rows. (covers restart durability, M2.2 — Postgres integration restart-resumption)
- [ ] Nullifier cache is invalidated when an on-chain `NullifierSpent` event is received. (store transitions tested offline; the on-chain event→cache integration is a hosted test) (covers v1 OQ #3, M2.2)
- [x] Stale cache falls back to an on-chain read. (M2.2 — server test with mocked adapter: miss → `is_nullifier_spent` fallback → 403 + durable spent record)
- [x] Stripe webhook event ID is idempotent across retries. (covers v1 OQ billing, M2.3)
- [x] API-key issuance record does not link commitment to calls (privacy boundary). (M2.2 — accepted_calls/nullifier_records carry no commitment column)
- [ ] Replace the legacy nullifier row with a spent-ticket record containing first `x`, `y`, request digest, proof hash, response/status, and fork state; migration preserves historical rows as legacy data without treating them as indexed tickets.
- [ ] Exact-retry cache stores no prompt body, encrypts the OpenRouter response at rest, expires response content after the configured short TTL, and retains only digest/provider ID/settlement metadata.
- [ ] Provider receipt capture retains the OpenRouter generation ID plus redacted model/provider/token/cost/latency metadata, exposes no upstream bearer or prompt/completion content, and labels the receipt as operator-authenticated operational evidence rather than a signed public attestation.
- [ ] Prove at the schema and handler layers that the shared compatibility credential has no commitment field or join path to billing/deposit records.

### Proof self-verification (new)
- [x] Shared `generateRlnProofSelfVerified` implemented: proves then locally verifies against the injected rln VK; throws `ProofSelfVerificationError` (for both `false` results and thrown snarkjs errors) and returns nothing on failure (code wired into `scripts/e2e-test.js` client path). (covers self-verify)
- [x] Valid RLN proof is self-verified + sent — verified against the artifact set (shared package 12/12). (covers self-verify happy path)
- [x] A deliberately malformed proof (wrong VK) fails local verification and is never sent — verified; rejection is `ProofSelfVerificationError`. (covers error handling)
- [ ] Gateway re-verifies and rejects a proof that passed client verify but is stale (old root) — hosted E2E (M3.3/M4.1), depends on a running gateway + on-chain state; out of the local M1.3 scope.
- [ ] Browser and gateway self-verify/re-verify the new four-signal indexed-ticket statement `[root, nullifier, x, y]`; tests using the legacy five-signal epoch statement fail closed.

### Isomorphic shared crypto (new)
- [x] Poseidon/witness-core functions implemented in `packages/zk-credits-shared` (MiMCSponge aside: the circuit hash in this codebase is MiMCSponge, not Poseidon) — pure functions tested in Node vitest: secret_k gen, BIP-39 mnemonic derive/recover, Fr field reduction. (covers isomorphism of the pure crypto core)
- [x] No `fs`/`path`/`createRequire`/`globalThis`/`window` pollution in the shared core (code review + import smoke test; DI provides circuit resources per runtime). (covers PRXVT anti-pattern)
- [x] Shared proof helpers (`computeDepositCommitment`, `generateDepositProof`, `verifyGroth16Proof`) tested in Node vitest — confirmed 12/12, now un-conditional since the circuit artifacts are committed (shared package suite). (covers isomorphism of the prove/verify path)
- [ ] Browser parity (Playwright): shared package produces identical outputs in the browser (deposit commitment + self-verify) — browser proof parity remains; the M3.5 Playwright smoke covers the app shell (landing renders) but not in-browser proving. Tracked for the hosted E2E (M4.1).

### Web app (new, M3.5)
- [x] `web/src/lib/crypto.test.ts` (vitest, 4): browser wiring of `@zk-credits/shared` — `generateSecretK` 32 bytes, `deriveMnemonic`→`recoverSecretK` round-trip (24-word), `secretKToField` fr-reduction below the BLS12-381 Fr modulus + determinism, alias stability. (covers web unit baseline)
- [x] `web/e2e/smoke.spec.ts` (Playwright, 2): landing page renders "ZK API Credits" + value prop; "Get Started" link → `/sign-in`. Runs against `next build`+`next start` (webServer). (covers browser app-shell smoke)
- [x] **Web UI fix E2E (2026-08-06, Playwright +9 → 13 total):** `e2e/auth-flow.spec.ts` (session endpoint 200 for anonymous visitors; anonymous `/sign-in` shows the GitHub button + recover link; anonymous `/dashboard` redirects to `/sign-in`), `e2e/landing.spec.ts` (styled rendering proves Tailwind active: hero h1 ≥ 36px + non-white body background; site header with Sign in link; honest-caveats footer containing testnet / trusted setup / no real money), `e2e/onboarding.spec.ts` (full wizard: Generate → 24 mnemonic words → confirm 3 requested words → "All Set!" → IndexedDB `secret_k` (64-hex) + `commitment` persisted; recover round-trip restores the identical commitment after wiping IndexedDB; malformed phrase rejected with "Expected 24 words, got N"). Playwright webServer now sets a test-only `AUTH_SECRET` (next-auth v5 throws MissingSecret in production mode without it). (covers auth guards, styled UI, wizard, recover)
- [x] `web/src/lib/format.test.ts` (vitest, 3): USDC 6-decimal formatting (`5000000` → "5", fractional kept readable, malformed → "0") — regression guard for the dashboard `balanceUsdc / 1_000_0000` (10⁷ vs 10⁶) bug. Web vitest now 10/10 including the Vercel packaging and runtime-configuration regression tests. (covers dashboard balance display)
- [x] `web/src/lib/vercel-build.test.ts` (vitest, 1): the Vercel `prebuild` script materializes the shared package before Next builds. (covers deployment packaging)
- [x] `e2e/dashboard.spec.ts` (Playwright, 3): with `ENABLE_DEV_LOGIN=1` (test-only, see implementation doc) the dev login reaches `/dashboard`, renders API Key + Buy Credits sections and the no-commitment placeholder; signed-in header shows the Dashboard link; missing gateway/Stripe configuration is explained and the affected buttons are disabled. Covers the signed-in flow without a GitHub OAuth app. (covers dashboard render + session-aware header + safe configuration failure)
- [x] Browser proof path (LOCAL scope, 2026-08-06): the onboarding spec runs `computeCommitment` in a real browser against the served `/circuits/deposit_membership.{wasm,final.zkey}` — previously an untested gap despite the vitest config comment; verified live via Playwright MCP against a production build (wizard completed, IndexedDB persisted). Hosted re-verification remains at M4.1.
- [ ] Browser proof path (HOSTED): `web/public/circuits/*` served such that `computeCommitment` runs against the hosted app — hosted E2E (M4.1).

### Existing v1 (retained/replaced)
- [ ] OpenRouter provider adapter, fee sponsorship, withdrawal, and unaffected durable-storage behavior are retained.
- [ ] Contract deposit/spend/slash tests are rewritten for fixed denomination, unique ticket nullifiers, idempotent retry, and ticket-fork slashing.
- [ ] Epoch RLN circuit/prove/verify fixtures are replaced by indexed-ticket fixtures; historical artifacts remain only as migration evidence and are never served by the launch frontend.

## Integration Tests
**How do we test component interactions?**

- [ ] Gateway + PostgreSQL: accepted ticket and its OpenRouter response persist across a forced restart; exact retry returns that result and settlement resumes without a second upstream forward.
- [ ] Gateway + Soroban: two distinct ticket proofs from one identity both verify and emit distinct `NullifierSpent` events; event reconciliation preserves first-share metadata.
- [ ] Gateway + Soroban root lifecycle: a slash/withdraw transition updates active membership, revokes unsafe grace roots, and causes all later proofs from that commitment to fail without a call-path commitment lookup.
- [ ] Fee-sponsor + Soroban: two different requests using the same private ticket index produce a valid fee-bumped slash transaction and verifiable 50/50 split.
- [ ] Fee-sponsor + Soroban: fee-bumped withdraw transaction lands on-chain; full amount transferred.
- [ ] Web + Stripe + gateway: checkout -> webhook -> deposit flow is idempotent across webhook retries.
- [ ] Browser + gateway: two distinct self-verified ticket proofs are accepted; proof-free and body/proof mismatch requests are rejected; exact retry is idempotent; ticket fork is rejected and flagged for slash.

## End-to-End Tests
**What user flows need validation?**

- [ ] **Public demo (hosted testnet):** a tester visits the public Vercel URL, signs in, buys the fixed $5 Starter package, submits two different playground prompts from one browser identity, receives two real OpenRouter answers, observes usage `0 -> 1 -> 2` and remaining tickets `100 -> 99 -> 98`, inspects each generation ID/redacted provider receipt, and sees the OpenRouter Logs link with the authenticated-operator caveat.
- [ ] **Idempotent retry (hosted testnet):** replaying the exact first request/proof returns its stored response/status, does not call OpenRouter again, does not decrement remaining tickets again, and does not create slash evidence.
- [ ] **Ticket-fork slash (hosted testnet):** a dedicated attack fixture uses one private ticket index for two different request digests; the second is not forwarded, `secret_k` is recovered through the slash proof, and a fee-sponsored 50/50 slash lands on Stellar testnet.
- [ ] **Withdraw (hosted testnet):** an unslashed user withdraws unused test credits to a chosen Stellar address via the fee-relay, without acquiring XLM.
- [ ] **Restart durability (hosted testnet):** the Render gateway is restarted mid-session; the tester's next call succeeds and no accepted call is lost or duplicated.
- [ ] `scripts/e2e-test.js` passes against the public deployment.
- [ ] `scripts/slash-demo.js` passes against the public deployment.

## Test Data
**What data do we use for testing?**

- Stellar testnet funded accounts: gateway, treasury, reporter, user, fee-sponsor (disposable testnet keys).
- Stripe test-mode webhook fixtures (event IDs, checkout sessions).
- Circom circuit fixtures: valid/invalid proof vectors, witness vectors.
- Fixture mnemonics (test-only), ticket indices `0`, `1`, `99`, and invalid `100`, canonical request vectors, Merkle trees/witnesses, exact-retry pairs, and ticket-fork pairs.
- Mock OpenRouter responses for non-live E2E; real OpenRouter for the hosted demo.
- PostgreSQL test schemas (isolated from any production schema).

## Test Reporting & Coverage
**How do we verify and communicate test results?**

- `cd ts && npm run test -- --coverage` - gateway + fee-sponsor + shared crypto; enforce 100% for new/changed security-critical modules.
- `cd web && npm run test` (vitest) + Playwright E2E (`npm run test:e2e`; `E2E_PORT` overrides the port when local dev servers occupy 3000).
- `cd zk-credits-contract && cargo test` - contract unit tests (Rust ≥1.85; CI pins 1.94.0).
- `cd circuits && node scripts/test.js` - off-chain prove/verify (artifacts committed).
- CI (GitHub Actions, M3.5) — `.github/workflows/ci.yml`: 6 jobs (gateway, shared, fee-sponsor, web, circuits, contract) on push + PR, concurrency cancel-in-progress; uploads `gateway-coverage` + `playwright-report` (on failure) as artifacts. `.github/workflows/deploy-smoke.yml`: post-deploy health smoke for `GATEWAY_URL`/`WEB_URL`/`FEE_SPONSOR_URL` (template; activates once secrets exist; the full hosted E2E at M4.1/4.2/4.3 is the launch gate).
- CI emits coverage reports, test outputs, and Stellar testnet tx hashes as artifacts with secrets redacted.
- Coverage gaps below 100% require written rationale. **Current gateway report (M3.5, 2026-08-05):** overall 65.58% stmts / 58.77% branch. Not-gated by CI (no `thresholds` in the vitest config; the coverage step is a report/artifact, not a hard gate). Rationale for uncovered lines: many modules are exercised only through integration/DB paths that need Postgres (`RUN_DB_TESTS=1`) or a live network — `db/*.ts` (client/migrate/index are 0%, gateway/billing/fee-sponsor stores ~40%) and `prover.ts` (browser-only proofgen paths) are not covered by the Node unit suite; `storage.ts` (browser IndexedDB) is excluded by config. Security-critical module `fee-relay.ts` is 86% (branch 65%) with the uncovered paths being the live fee-bump submission branches; `server.ts` 76% / `spend-worker.ts` 95% / `withdraw.ts` 100% / `merkle.ts` 100% / `crypto.ts` 100% stmts. New/changed security-critical branches in the fee-sponsor gate, durable store, self-verification, and shared crypto are covered by their dedicated suites (see Completed Evidence).

## Manual Testing
**What requires human validation?**

- [ ] Public URL accessibility (gateway health, web landing) from an external network.
- [ ] Onboarding + mnemonic-confirmation accessibility, clipboard warnings, IndexedDB behavior.
- [ ] Stripe test checkout cancel/success/webhook-retry UX on the hosted web app.
- [ ] Fee-relay slash/withdraw UX for a reporter and a user (no XLM needed).
- [ ] Dashboard status visibility against live on-chain state.
- [ ] Inspect network requests + service logs + PostgreSQL schemas to confirm no secret leakage and no call-to-commitment linkage.

## Performance Testing
**How do we validate performance?**

- [ ] Measure cold/warm browser Groth16 proving, gateway verification, and on-chain verification on the hosted deployment.
- [ ] Sustain 100 accepted calls and verify no accepted call is dropped or duplicated across a gateway restart.
- [ ] Measure fee-relay round-trip latency for slash/withdraw.

## Bug Tracking
**How do we manage issues?**

- Security/privacy, escrow-transfer, or fee-sponsor authority failures are release-blocking.
- Every fix adds a regression test at the lowest relevant layer.
- A violation of the durable-restart or fee-only-authority guarantee blocks the public launch.

## Historical Fly deployment evidence (2026-08-09)

- [x] W7 local web completion re-verification: feature lint exit 0; web strict typecheck exit 0; Vitest 10/10; Playwright 13/13 against a production build; production build exit 0.
- [x] Fly recovery: attached Postgres restarted with `pg`/`role` checks passing; gateway machine restarted; Fly gateway `/health` check passing; internal `/v1/contract-status` returned `depositCount: 3` and a current root.
- [x] Public edge verification: direct HTTPS gateway checks returned 200 for `/health` and `/v1/contract-status` after recovery; trial Postgres autostop can still cause transient 502/503 responses while the machine restarts.

## Acceptance evidence (2026-08-10)

> Legacy evidence below demonstrates hosting, checkout, browser proving, OpenRouter, and Stellar serialization, but it does **not** satisfy the revised launch gate. The one-call epoch proof and `nullifier_spent` replay behavior must be replaced by the indexed-ticket evidence above.

- [x] OpenRouter credential: a real `openai/gpt-4o-mini` request returned HTTP 200 with choices and no provider error; the key was never printed.
- [x] Gateway/upstream path: a temporary acceptance test generated and locally self-verified a real RLN Groth16 proof, sent it through `/v1/chat/completions` to OpenRouter, received a real response, and replayed the same proof; the replay returned 403 `nullifier_spent`.
- [x] Credit boundary: valid proofs for an unfunded commitment return 402 `credits_required`, do not forward upstream, and do not enter the durable accepted-call store. The dashboard status endpoint now reports the active Soroban deposit amount/status instead of a hardcoded zero.
- [x] Checkout UX: Playwright completed a Stripe test-mode checkout and returned to `/dashboard?checkout=success`; the dashboard displayed the new pending-confirmation state and polled for the asynchronous webhook/deposit result.
- [x] Stripe routing: the configured test webhook was corrected from the gateway endpoint to the Vercel signature-verifying route; a correctly signed probe passed signature verification and now returns 502 `gateway_relay_failed` while Fly is suspended, correctly requesting a Stripe retry.
- [x] Hosted Stripe flow on Render/Vercel: Playwright completed multiple Stripe test-mode payments, the dashboard reached the confirmed state, and Soroban deposit count advanced from the hosted baseline. The checkout request commitment matched the browser's IndexedDB commitment; no card or Stripe secret was printed.
- [x] Root-cause regression: a real RLN proof generated against the hosted pre-fix tree did not match the Soroban root. A TDD regression test reproduced the mismatch locally, then passed after replacing BN254 `circomlibjs` Merkle arithmetic with BLS12-381 Fr MiMCSponge arithmetic.
- [x] Soroban proof-shape regression: a TDD test caught that `nativeToScVal()` encoded the snarkjs proof object with the wrong field names and shape for the named Soroban `Groth16Proof` map; the converter now emits validated BLS12-381 G1/G2 byte values under `a`/`b`/`c` for `spend()` and `slash()`.
- [x] Soroban spend-argument regressions: public signals are explicitly serialized as `u256`, and the event watcher emits the topic as base64 ScVal XDR; both have focused TDD coverage.
- [x] Hosted funded call after BLS, proof-shape, and signal-serialization fixes: both Render services are live on `c02891c`; Playwright completed the hosted sign-in → API-key → Stripe test checkout path, the gateway returned a real OpenRouter response, and the live Soroban contract emitted two `NullifierSpent` events using the corrected event filter. Legacy pre-fix queued rows still fail with `RootMismatch` and are intentionally excluded from acceptance fixtures.
- [x] Dashboard status proxy: a fresh no-payment Playwright check returned the same HTTP 200 `unfunded` status and zero balance from Vercel `/api/dashboard/status` and the direct Render gateway, ruling out a Vercel/Render proxy mismatch for the earlier checkout UI symptom.
- [x] Browser LLM playground (2026-08-10, live Playwright interaction): local production web build served the dashboard UI; a fresh testnet-funded identity was transferred into the browser test context without exposing the secret in output; clicking `Generate response` visibly entered `Sending to OpenRouter…`, returned `ZK API Credits works.`, reported `self-verified proof` with ~24.7s end-to-end latency, and refreshed usage from `0` to `1` call with `99` remaining. The gateway health/upstream path was the hosted Render service, not a mock; console errors were 0.
- [x] LLM playground shell regression: `web/e2e/dashboard.spec.ts` asserts the signed-in dashboard exposes the `LLM Playground` heading and labeled `Prompt` textbox, including the safe disabled state when gateway configuration is absent.

## Indexed-ticket rollout validation (2026-08-11)

- [x] Deposit rollback RED/GREEN: a mocked on-chain rejection initially increased `merkleTree.getLeafCount()` from 0 to 1. The staged-tree fix leaves both the root and leaf count unchanged. Gateway + Merkle regression suite: 54/54; full gateway suite: 142 passed, 11 skipped; strict typecheck passed.
- [x] Shared proof suite: 19/19 passed. Web unit suite: 17/17 passed; strict typecheck and optimized Next build passed. Contract deployment transaction test passed.
- [x] Soroban contract suite: 24/24 passed with `cargo +1.92.0 test`. The default local Cargo 1.79 remains too old for the Edition 2024/Soroban 26 dependency graph.
- [ ] Hosted indexed-ticket acceptance is intentionally not claimed yet. The live Render gateway is still serving committed revision `42ef3d1`, whose five-signal endpoint rejects the current four-signal proofs before OpenRouter forwarding. The validated source revision must be pushed and redeployed before re-running two-ticket, exact-retry, fork/slash, withdrawal, and restart checks.
- [x] Fee-relay envelope RED/GREEN: a live fee bump exposed that slash/withdraw envelopes were signed before Soroban preparation. The new contract-client regression first failed with no helper, then passes by asserting `prepareTransaction()` precedes the signer. Full gateway suite: 143 passed, 11 skipped; strict typecheck passed. The fix awaits its Render rollout before repeating the live slash.

## Hosted M4 evidence (2026-08-11)

- [x] Render deployment `dd38685`: both services live with the four-signal endpoint; live health and contract-status report the intended contract and active root.
- [x] Two-ticket provider path: two fresh Groth16 proofs self-verified locally, matched the contract root, returned HTTP 200 with real provider responses, and each corresponding Soroban nullifier became spent. The exact first tuple returned its stored HTTP 200 response rather than issuing a second request.
- [x] Fork/slash: a different request with ticket zero returned `409 fork_detected`; a locally verified nine-signal slash proof was accepted by the public fee relay after `90caf21` and the original deposit read back as `slashed`.
- [x] Withdraw: a fresh 1-USDC test deposit returned 200 from `/v1/deposits`; its locally verified membership-removal proof returned 200 from `/v1/withdraw` with a fee-bump hash; the deposit read back as `withdrawn`.
- [x] Restart durability: Render restart deployment `dep-d9tdhsjncjis7391ec80` reached `live`; an accepted ticket replay returned an identical SHA-256 response fingerprint after restart and the restarted worker's nullifier settlement was verified on Soroban.
- [x] Chrome/Playwright observation: the Vercel preview and production deployments rendered the landing without console errors. Chrome clicked Get Started into the dashboard on preview; production reached the GitHub sign-in screen with its OAuth button visible and zero console errors.
- [!] Operational caveat: Render's public edge intermittently timed out during the long live pass while the API reported the service `live`; retrying health checks recovered. Treat free-tier cold-start/edge availability as a launch-monitoring risk.

## M5.0 durable membership-tree validation (2026-08-11)

- [x] `ts/merkle.test.ts`: RED/GREEN indexed rebuild reconstructs a two-member
  root exactly and preserves both leaf positions.
- [x] `ts/db/gateway.test.ts`: a staged membership leaf is persisted apart
  from accepted calls, activates only with its expected root, and versions the
  root state. `ts/db/migrate.test.ts` asserts migration `0008` creates only
  separate membership-tree tables.
- [x] `ts/membership-tree.test.ts`: a chain-confirmed pending deposit is
  promoted after simulated restart; an unknown chain root fails closed; an
  empty durable store bootstraps atomically from an exact public
  `{ leaves, layers }` snapshot, including a post-removal retained zero branch
  that leaf-only reconstruction cannot reproduce.
- [x] `ts/server.test.ts`: the public snapshot is parameter-free and exposes
  indexed leaf values, layers, and a fresh timestamp; successful deposits and
  slash/withdraw removals activate durable leaf/root state; existing rollback
  coverage confirms rejected deposits leave the in-memory root unchanged.
- [x] Focused local evidence covers the durable tree, signed slash transition,
  and strict typecheck. The final suite count is refreshed in M5.4.
- [ ] Pending M5.4: migrate Render with an exact
  `MEMBERSHIP_TREE_BOOTSTRAP_SNAPSHOT` (`leaves` plus `layers`) and verify live
  root/restart;
  PostgreSQL integration tests remain opt-in (`RUN_DB_TESTS=1`) and must run
  against a disposable database before production rollout.

## M5.1–M5.3 proof-aware transport validation (2026-08-11)

- [x] Shared crypto tests derive a valid witness for a second active leaf,
  reject a tampered root, and preserve a post-removal zero branch through the
  published layers. The RLN proof suite self-verifies a non-first-leaf proof.
- [x] Web tests assert the snapshot call is parameter-free and `no-store`;
  shared browser proof wiring uses the derived witness for chat and withdrawal.
- [x] Gateway tests cover proof-bound `/v1/responses` acceptance, missing proof
  rejection, JSON exact retry, SSE transcript exact replay, and the terminal
  bounded-stream replay outcome without a second upstream call.
- [x] Sidecar unit/integration tests cover secret persistence boundaries,
  one-time headless input, artifact-manifest mismatch rejection, local witness
  derivation with no commitment query, durable ticket serialization, local
  bearer rejection, Responses forwarding, package build, and package dry-run.
- [ ] Pending M5.4: use a real testnet membership through the sidecar and an
  OpenAI-compatible Responses client; then deploy and inspect the hosted web
  application in Chrome/Playwright.

## M5.4 Render bootstrap preflight (2026-08-11)

- [x] Replayed the live contract event and transaction history to produce an
  exact public `{root, depth, leaves, layers}` snapshot for the current root.
- [x] Verified the replayed root against `get_current_root` and the replayed
  deposit/slash/withdraw transitions.
- [x] Set the one-time Render bootstrap environment variable without storing
  the Render credential in the repository.
- [x] Deploy revision `f0c1b77`, confirm gateway and fee-sponsor health, and
  verify the hosted membership endpoint returns the recovered root.
- [x] CI run `31497435312` passed all seven jobs, including the Linux sidecar
  credential-store test after installing `libsecret-1-0`.
- [ ] Complete a funded sidecar Responses request and the Chrome/Playwright
  walkthrough. The public Vercel walkthrough is complete; the funded sidecar
  portion requires the recovery phrase for the active testnet commitment.

## M5.4 live validation reconciliation (2026-08-11)

- [x] Playwright generated a fresh browser identity without exposing its
  recovery phrase; the generated commitment was funded through the testnet
  gateway deposit path.
- [x] Waited for the Soroban current root to match the gateway snapshot after
  the deposit.
- [x] Started the sidecar with the phrase in process memory, generated a
  self-verified RLN proof, and completed a real `/v1/responses` request with
  HTTP 200.
- [x] Public hosted pages and the deployed gateway/fee-sponsor health checks
  remain green after the live validation.

## M5.5 Codex companion verification (2026-08-11)

- [x] TDD coverage for profile isolation/permissions, lifecycle reuse/startup
  timeout, detached process arguments, token publication after bind, identity
  presence, CLI setup/token/status/launch behavior, Codex exit propagation,
  health, authenticated model discovery, and package metadata.
- [x] Full sidecar suite: 15 files and 39 tests passed.
- [x] Standalone build produced an executable 39,588-byte ESM launcher with no
  checkout path or unresolved `@zk-credits/shared` import. Path-sensitive
  proving/native libraries are package dependencies so Node workers and
  `keytar` resolve from the installed package rather than from bundled paths.
- [x] `npm pack --dry-run` produced a 6,083,920-byte tarball (8,276,935 bytes
  unpacked, 36 files).
- [!] `npm audit --omit=dev` reports 19 production dependency findings
  (13 low, 2 moderate, 4 high, 0 critical), all in the legacy
  `circomlibjs`/ethers/jsonpath dependency graph. npm's advertised remediation
  changes `circomlibjs` across versions and is not applied automatically;
  dependency replacement or an upstream release remains a distribution risk
  to resolve before treating the package as production-hardened.
- [x] Installing that tarball into an empty temporary prefix succeeded; its linked
  `zk-credits --help` ran without access to the monorepo.
- [x] With no server running, clean-installed `token` automatically started a
  detached loopback server from packaged circuits and returned one
  43-character line. `/health` returned the exact ready contract,
  authenticated `/v1/models` returned `openai/gpt-4o-mini`, `status` reported
  the running process without mutation, and both token/log files were `0600`.
- [x] Codex CLI 0.147.0 accepted the generated isolated profile and selected
  provider `zk_credits`. TDD regressions cover Codex's `models` response shape
  and 256 KB gateway requests; the latter failed with HTTP 413 before the
  bounded 2 MB parser limit and passed afterward.
- [x] Revision `73df52b` reached the hosted Render gateway. The exact end-user
  command `zk-credits codex exec ...` exited 0, returned exactly
  `ZK Credits Codex works.`, and left local ticket index `2` in `consumed`
  state. Failed compatibility probes reserved indices `0` and `1` without
  marking them consumed, preserving the no-reassignment ambiguity rule.
- [x] Published `zk-credits@0.1.0` to the public npm registry. Its registry
  integrity matched the locally verified tarball; a clean registry install ran
  `--help` and reported the configured identity/profile/running sidecar. The
  globally installed registry binary then stopped and automatically restarted
  the loopback sidecar without spending a ticket.

## Task 4.5 Honest caveats + public URLs verification (2026-08-28)

- [x] TDD unit tests in `web/src/lib/honest-caveats.test.ts` (4/4 passed) verify `README.md` documents public gateway and web URLs, launch contract `CBDGHYF5CQM527IM3GVDDWXLDB4XNPA5BT4KXFVCSJZTQIOFZGOIHAIT`, no legacy contract ID or "dummy VK" references, all nine honest caveats, and no required GitHub sign-in step.
- [x] Playwright specs `e2e/landing.spec.ts` and `e2e/smoke.spec.ts` (5/5 passed) verify Tailwind layout, site header, honest-caveats footer covering all nine caveats, browser-secret identity framing without "Sign in with GitHub", 100-ticket rate limiting without "100 calls/day", and public hosted URLs/contract.
- [x] `playwright-cli` browser QA verified desktop + mobile landing page, `/sign-in` (with disabled GitHub button explaining missing env and dev account option), `/onboarding` (key generation wizard), `/recover` (24-word recovery form), and `/dashboard` footer (dev sign-in flow). Zero console errors observed.

## Task 4.8 Whole-web lint gate verification (2026-08-28)

- [x] TDD unit tests in `web/src/lib/checkout-state.test.ts` (4/4 passed) verify `checkoutStateFromParam` derivation logic and `.vercel/**` in `eslint.config.mjs` `globalIgnores`.
- [x] `npx eslint src/app/dashboard/buy-credits-section.tsx src/app/dashboard/dashboard-status.tsx` exits 0 with 0 errors / 0 warnings.
- [x] `npm run lint` whole-web gate exits 0 with 0 errors across all files.
- [x] `npm run typecheck` exits 0.
- [x] `npm test` passes 27/27 unit tests.
- [x] `CI=1 E2E_PORT=3216 npm run test:e2e` passes 14/14 browser specs.

## Task 4.6 OpenRouter per-key tier verification (2026-08-28)

- [x] Read-only verification via `GET https://openrouter.ai/api/v1/key` using parent `.env` credential.
- [x] Returned status: `is_free_tier: true`, `limit: null`, `limit_remaining: null`. Key is active with sufficient allowance for live multi-agent proofs without rate limit restrictions.

## Task 5.7 Codex SDK live protocol proof verification (2026-08-28)

- [x] TDD unit tests in `packages/zk-credits-sidecar/src/codex-sdk-options.test.ts` (3/3 passed) verify options generation for `@openai/codex-sdk` `Codex` and `Thread`.
- [x] Verified full sidecar unit test suite in `packages/zk-credits-sidecar` passes (64/64 tests across 19 test files).
- [x] Live proof script `scripts/live-codex-sdk-proof.mjs` executed:
  - Pointed `@openai/codex-sdk` `Codex` instance at loopback sidecar `http://127.0.0.1:3210/v1` with isolated temp `CODEX_HOME`.
  - Executed turn prompt `Reply with exactly: [CODEX-SDK-LIVE]`.
  - Verified model output returned `[CODEX-SDK-LIVE]` with exit 0.
  - Verified ticket ledger advanced from 13 to 14 consumed tickets, durably marking ticket index `16` (`dd3529d028cd090f269e08f81529a827e1180328417c4db4db6d0b4ba87cf10a`) as `consumed`.
- [x] Verified published npm package version `npm view zk-credits version` remains `0.1.1`.

## Task 5.8 Claude Code Messages adapter verification (2026-08-28)

- [x] TDD unit tests in `packages/zk-credits-sidecar/src/anthropic-messages.test.ts` (6/6 passed) verify Anthropic to OpenAI request translation, OpenAI to Anthropic JSON response translation, and SSE streaming chunk transformation.
- [x] TDD unit tests in `packages/zk-credits-sidecar/src/sidecar.test.ts` (7/7 passed) verify loopback `/v1/messages` handling, `x-api-key` auth, proof generation/forwarding to `/v1/chat/completions`, and ticket ledger consumption on 200.
- [x] TDD unit tests in `packages/zk-credits-sidecar/src/claude-launcher.test.ts` (2/2 passed) and `src/cli-runtime.test.ts` (14/14 passed) verify isolated `CLAUDE_CONFIG_DIR`, loopback base URL injection, and ENOENT guidance.
- [x] Verified full sidecar unit test suite passes: 64/64 tests across 19 test files.
- [x] Live proof execution: `node dist/zk-credits.js claude -p "Reply with exactly: [CLAUDE-CODE-LIVE]" --output-format json --max-turns 1`:
  - Output returned valid JSON: `{"type":"result","subtype":"success","is_error":false,"result":"[CLAUDE-CODE-LIVE]","stop_reason":"end_turn",...}` with exit code 0.
  - Verified ticket ledger in `~/.zk-credits/tickets.json` advanced from 14 to 16 consumed tickets, durably marking ticket indices `17` and `18` as `consumed`.

## Task 4.1 Hosted Stripe & GitHub OAuth verification status (2026-08-28)

- [x] Deterministic CI baseline: `web/e2e/dashboard.spec.ts` retains strict deterministic assertions for unconfigured integration states; Playwright E2E suite passes 14/14 with isolated test environment.
- [x] Stripe API test connectivity: Initialized Stripe SDK with operator-configured `STRIPE_SECRET_KEY`. Verified `stripe.balance.retrieve()` returns HTTP 200 with `livemode: false` and currency `usd`.
- [x] Live Stripe checkout payment in browser:
  - Created live checkout session `cs_test_a11TSNYBSbMiwLRtYvauhAs2MyMeRvEWuVuZN6wvgWDvoCHNQ4q5MNwA51` with `tier: 'starter'` and `success_url` pointing to `https://feature-zk-api-credits-gadillacers-projects.vercel.app/dashboard?checkout=success`.
  - Loaded checkout URL in browser, populated test card `4242 4242 4242 4242`, expiration `12/34`, CVC `123`, cardholder name `Demo User`, and submitted payment.
  - Verified Stripe API status updated to `payment_status: "paid"`, `status: "complete"`, `payment_intent: "pi_3U9Mo71I3zjIgUTM0Ssr3MNS"`.
- [x] Live Vercel webhook endpoint delivery & retry:
  - Retrieved real Stripe event `evt_1U9Mo81I3zjIgUTMe1FE3XEe` from Stripe API.
  - Signed payload with `STRIPE_WEBHOOK_SECRET` via `stripe.webhooks.generateTestHeaderString`.
  - Sent `POST https://feature-zk-api-credits-gadillacers-projects.vercel.app/api/webhooks/stripe` with `stripe-signature` header: Vercel verified the signature, relayed to gateway, and returned HTTP 200 `{"received":true,"processed":false,"duplicate":true}` (confirming both signature verification on Vercel and idempotency on the gateway).
- [x] Live Gateway status confirmation:
  - Queried `GET https://zk-credits-gateway.onrender.com/v1/status/18392400176021343575686504278220200007490597768258067808547211916758327342062` directly.
  - Returned HTTP 200 `{"commitment":"1839...","callsThisEpoch":0,"epochQuota":100,"remainingCalls":100,"balanceUsdc":"5000000","depositStatus":"active"}`.
- [x] Hosted Vercel auth behavior: Verified `/dashboard` and `/api/dashboard/status` fail closed (HTTP 401 / redirect to `/sign-in`) when unauthenticated. Verified `/sign-in` renders disabled "Sign in with GitHub" until `GITHUB_CLIENT_*` is provisioned in Vercel project environment variables.
- [ ] Open hosted acceptance gaps under 4.1: (1) hosted `/dashboard?checkout=success` pending $\rightarrow$ confirmed UI was not rendered on Vercel (redirects to `/sign-in`); (2) hosted Vercel `/api/webhooks/stripe` response was a retry (`duplicate: true`), not an initial first delivery; (3) GitHub OAuth remains unconfigured in Vercel project environment variables (button disabled on live site).
- [x] Full test gates: `npm test` passed 27/27 unit tests; `npm run lint` and `npm run typecheck` passed with 0 errors.
## Task 4.7 Render API credential rotation verification (2026-08-28)

- [x] Verified current Render service health: `GET https://zk-credits-gateway.onrender.com/health` (HTTP 200 `status: ok`, `proofVerification: enabled`) and `GET https://zk-credits-fee-sponsor.onrender.com/health` (HTTP 200 `status: ok`).
- [x] Evaluated Render REST API endpoints: `GET https://api.render.com/v1/api-keys` and `GET https://api.render.com/v1/tokens` return HTTP 404 (Render API key creation and revocation is restricted strictly to the Web Dashboard).
- [x] Operator rotation path documented: Dashboard click-path (`https://dashboard.render.com/` -> Account/Workspace Settings -> API Keys) provides manual key generation and old key revocation without leaking secrets into logs or repository files.
