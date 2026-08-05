---
phase: testing
feature: stellar-launch
title: "stellar-launch: Testing Strategy"
description: Verification plan for the public testnet launch - hosted deployment, fee sponsorship, durable storage, PRXVT guardrails, and the six v1 open-question resolutions.
---

# Testing Strategy

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
- [x] M2.6 spend worker settlement queue: `db/spend-queue.test.ts` (2) proves the store round-trips the full proof + pub signals and pending-spend excludes spent rows; `spend-worker.test.ts` (6) proves drain submits each pending call + records the tx hash, treats `NullifierAlreadySpent` as settled (no infinite retry), leaves calls pending on transient failure, never re-submits spent calls, and skips pre-M2.6 rows without a proof. Migration `0004_spend_queue.sql` verified offline + against Postgres 16 (proof/jsonb columns). Postgres integration (<code>gateway.integration.test.ts</code>, 4 tests) proves restart resumption with the proof intact + `markSpendResult` settles atomically. `ts` suite now **101/109**, DB integration **29/29** (serial), web typecheck OK.
- [x] M2.4 fee-sponsor + public fee-relay: `MemoryFeeSponsorStore` tests (4) cover relay idempotency (first wins, retry returns prior state, submit/fail transitions, ordering); Postgres integration (2, `RUN_DB_TESTS=1`) proves cross-instance idempotency on the inner tx hash. `fee-relay.test.ts` (9) builds real SDK txs to prove the method-validation gate: slash+withdraw accepted, payment (non-contract) → 403, `deposit` → 403 (not sponsored), malformed XDR → 400; `relayOne` fee-bumps + submits exactly once, is idempotent on retry, and marks `failed` + 503 on submission failure; `buildFeeBumpEnvelope` wraps the inner tx. `fee-sponsor-app.test.ts` (5, supertest) covers `/health`, accept withdraw, idempotent retry, missing inner tx (400), payment rejection (403). Migration `0005_fee_sponsor.sql` offline + Postgres-16 verified. Service boots via tsx and fails closed on missing env/DB. `ts` suite now **120/130**, DB integration **36/36** (serial), services typecheck OK.
- [x] M2.5 gateway `/v1/withdraw` co-signer: `withdraw.test.ts` (5) proves the orchestrator builds the depositor envelope, relays it to the fee sponsor once (relay-reported duplicate is a no-op), rejects missing fields (400), and surfaces 502/503 on build/relay failure. `server.test.ts` (now 38) adds `/v1/withdraw` endpoint tests: co-signed withdraw relayed with fee-bump hash returned, missing auth → 401, missing fields → 400, fee-relay rejection → 502 (contract `buildWithdrawEnvelope` and global `fetch` both mocked). `ts` suite now **129/139**, DB integration **36/36** (serial), typecheck OK.
- [x] M3.5 CI pipeline + web test baseline: `web` gained a vitest unit suite (`web/src/lib/crypto.test.ts`, 4 tests — 32-byte secret gen, 24-word BIP-39 derive→recover round-trip, `secretKToField` fr-reduction + determinism, alias stability; **the 12-word assertion was a TDD-caught error — the real implementation derives 24 words** from 32-byte entropy, matching the M1.2 record) and a Playwright E2E smoke (`web/playwright.config.ts` + `web/e2e/smoke.spec.ts`, 2 tests: landing renders + `/sign-in` "Get Started" link; **the assumed "Sign in" link label was a TDD-caught error**). Verified locally `npm test` 4/4 + `E2E_PORT=3211 npx playwright test` 2/2 (next-auth UntrustedHost server-log noise is harmless; `AUTH_URL` is set in the webServer command). `.github/workflows/ci.yml` (6-job matrix: gateway/shared/fee-sponsor/web/circuits/contract, Node 24 + `npm ci`, concurrency cancel) + `.github/workflows/deploy-smoke.yml` (post-deploy health template) created; both YAML-parse clean. Circuit artifacts un-ignored + committed (`.wasm`/`*_final.zkey` for `circuits/` + `web/public/circuits/` — a fresh checkout previously lacked the browser proof path and the CI circuits inputs).
- [ ] Gateway stale-root rejection (defense-in-depth) — hosted E2E (M3.3/M4.1), out of the local M2.2 scope.

## Test Coverage Goals
**What level of testing do we aim to?**

- 100% coverage of new/changed security-critical branches in the fee-sponsor, durable storage layer, proof self-verification, and isomorphic shared crypto; every uncovered line requires written rationale.
- Retain the existing v1 gateway (46) + contract (15) + circuit test suites; replace in-memory state tests with PostgreSQL-backed equivalents.
- Hosted-testnet E2E tests exercise the public deployment (sign-in -> buy -> call -> slash -> withdraw) against the live Fly.io/Vercel/Soroban endpoints.
- Alignment: every requirements success criterion has at least one test scenario.

## Unit Tests
**What individual components need testing?**

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

### Proof self-verification (new)
- [x] Shared `generateRlnProofSelfVerified` implemented: proves then locally verifies against the injected rln VK; throws `ProofSelfVerificationError` (for both `false` results and thrown snarkjs errors) and returns nothing on failure (code wired into `scripts/e2e-test.js` client path). (covers self-verify)
- [x] Valid RLN proof is self-verified + sent — verified against the artifact set (shared package 12/12). (covers self-verify happy path)
- [x] A deliberately malformed proof (wrong VK) fails local verification and is never sent — verified; rejection is `ProofSelfVerificationError`. (covers error handling)
- [ ] Gateway re-verifies and rejects a proof that passed client verify but is stale (old root) — hosted E2E (M3.3/M4.1), depends on a running gateway + on-chain state; out of the local M1.3 scope.

### Isomorphic shared crypto (new)
- [x] Poseidon/witness-core functions implemented in `packages/zk-credits-shared` (MiMCSponge aside: the circuit hash in this codebase is MiMCSponge, not Poseidon) — pure functions tested in Node vitest: secret_k gen, BIP-39 mnemonic derive/recover, Fr field reduction. (covers isomorphism of the pure crypto core)
- [x] No `fs`/`path`/`createRequire`/`globalThis`/`window` pollution in the shared core (code review + import smoke test; DI provides circuit resources per runtime). (covers PRXVT anti-pattern)
- [x] Shared proof helpers (`computeDepositCommitment`, `generateDepositProof`, `verifyGroth16Proof`) tested in Node vitest — confirmed 12/12, now un-conditional since the circuit artifacts are committed (shared package suite). (covers isomorphism of the prove/verify path)
- [ ] Browser parity (Playwright): shared package produces identical outputs in the browser (deposit commitment + self-verify) — browser proof parity remains; the M3.5 Playwright smoke covers the app shell (landing renders) but not in-browser proving. Tracked for the hosted E2E (M4.1).

### Web app (new, M3.5)
- [x] `web/src/lib/crypto.test.ts` (vitest, 4): browser wiring of `@zk-credits/shared` — `generateSecretK` 32 bytes, `deriveMnemonic`→`recoverSecretK` round-trip (24-word), `secretKToField` fr-reduction below the BLS12-381 Fr modulus + determinism, alias stability. (covers web unit baseline)
- [x] `web/e2e/smoke.spec.ts` (Playwright, 2): landing page renders "ZK API Credits" + value prop; "Get Started" link → `/sign-in`. Runs against `next build`+`next start` (webServer). (covers browser app-shell smoke)
- [ ] Browser proof path: `web/public/circuits/deposit_membership.{wasm,final.zkey}` served such that `computeCommitment` runs in a real browser against the hosted app — hosted E2E (M4.1).

### Existing v1 (retained/replaced)
- [ ] Gateway proof-relay, OpenRouter adapter, session token (JWT) - retained.
- [ ] Contract deposit/spend/slash/withdraw - retained (Rust unit tests).
- [ ] Circuit prove/verify - retained; in-memory state tests replaced by durable equivalents.

## Integration Tests
**How do we test component interactions?**

- [ ] Gateway + PostgreSQL: accepted call persists across a forced restart; settlement queue resumes.
- [ ] Gateway + Soroban: proof relay verifies on-chain; `NullifierSpent` event invalidates the cache.
- [ ] Fee-sponsor + Soroban: fee-bumped slash transaction lands on-chain; 50/50 split verifiable.
- [ ] Fee-sponsor + Soroban: fee-bumped withdraw transaction lands on-chain; full amount transferred.
- [ ] Web + Stripe + gateway: checkout -> webhook -> deposit flow is idempotent across webhook retries.
- [ ] Browser + gateway: self-verified proof accepted; proof-free / replay calls rejected with correct status codes.

## End-to-End Tests
**What user flows need validation?**

- [ ] **Public demo (hosted testnet):** a tester visits the public Vercel URL, signs in with GitHub, buys $5 test credits (Stripe test), sets `OPENAI_BASE_URL`/`OPENAI_API_KEY`, runs `claude "..."`, and receives a real Claude response. (covers the 5-minute demo)
- [ ] **Slash (hosted testnet):** a simulated over-quota violation is slashed permissionlessly via the fee-relay; the 50/50 treasury/reporter split is verifiable on Stellar testnet.
- [ ] **Withdraw (hosted testnet):** an unslashed user withdraws unused test credits to a chosen Stellar address via the fee-relay, without acquiring XLM.
- [ ] **Restart durability (hosted testnet):** the Fly.io gateway is restarted mid-session; the tester's next call succeeds and no accepted call is lost or duplicated.
- [ ] `scripts/e2e-test.js` passes against the public deployment.
- [ ] `scripts/slash-demo.js` passes against the public deployment.

## Test Data
**What data do we use for testing?**

- Stellar testnet funded accounts: gateway, treasury, reporter, user, fee-sponsor (disposable testnet keys).
- Stripe test-mode webhook fixtures (event IDs, checkout sessions).
- Circom circuit fixtures: valid/invalid proof vectors, witness vectors.
- Fixture mnemonics (test-only), fixed UTC epochs, Merkle trees/witnesses.
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
- Coverage gaps below 100% require written rationale.

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
