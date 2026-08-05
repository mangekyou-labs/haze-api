---
phase: implementation
feature: stellar-launch
title: "stellar-launch: Implementation Guide"
description: Technical implementation notes for the Stellar testnet public launch - PRXVT hardening (type safety, fee sponsorship, durable storage, self-verify, isomorphism), hosted deployment, and CI.
---

# Implementation Guide

## Development Setup
**How do we get started?**

Work in the `feature-stellar-launch` worktree (`/Users/kyler/repos/feature-zk-api-credits/.worktrees/feature-stellar-launch`, branch `feature-stellar-launch`).

- `cd ts && npm install && npm run typecheck && npm test` - gateway deps, type gate, unit tests.
- `cd web && npm install && npm run typecheck` - web deps + type gate (Next.js).
- `cd circuits && node scripts/test.js` - off-chain prove/verify (needs built `.wasm`/`.zkey` artifacts; see Known blockers).
- `cd zk-credits-contract && RUSTUP_TOOLCHAIN=1.94 stellar contract build` - Soroban contract (v1, unchanged for launch).
- Environment: copy the repo `.env.example`; set Stellar testnet keys, Stripe test keys, GitHub OAuth, OpenRouter key, PostgreSQL URL, fee-sponsor XLM key.

**Lockfile note:** `npm ci` fails on the pre-existing stale lockfiles (missing `@emnapi` transitive packages). Use `npm install` to sync the lockfile first - the same issue the Mina track recorded.

## Code Structure
**How is the code organized?**

- `ts/` - gateway (Node.js + Express + TypeScript): `server.ts` (OpenAI-compatible API), `crypto.ts`/`prover.ts` (ZK proof gen/verify), `merkle.ts` (off-chain Merkle), `contract.ts` (Soroban client), `providerAdapter.ts` (OpenRouter), `sessionToken.ts`, `storage.ts` (browser IndexedDB), `vitest.config.ts`. New: `tsconfig.json` (strict type gate), `circomlibjs.d.ts` (typed module decl).
- `web/` - Next.js app (GitHub OAuth, Stripe test checkout, dashboard, onboarding). `src/lib/crypto.ts` (browser witness calc). NOTE: `src/lib/stellar.ts` (stale Soroban read stub) was **removed** in M1.1 - all contract reads go through the gateway proxy (`/v1/contract-status`).
- `services/fee-sponsor/` - **(new, M2.4)** public fee-relay endpoint, fee bumps, PostgreSQL `fee-sponsor` schema.
- `zk-credits-contract/` - Soroban `ZkCreditsContract` (unchanged for launch; its `withdraw()` requires `deposit.depositor.require_auth()` - gateway-mediated withdrawal).
- `circuits/` - Circom circuits (deposit_membership, rln_nullifier, slash) + verification keys + `scripts/{debug,prove,test}.js`.

## Implementation Notes
**Key technical details to remember:**

### Type safety (M1.1 - done)
- `ts/tsconfig.json`: `strict: true`, `module: esnext`, `moduleResolution: bundler`, `noEmit: true` (type-gate only; runtime is built by vitest/esbuild). `npm run typecheck` exists in both `ts/` and `web/`.
- Removed the only `@ts-nocheck` (`web/src/lib/stellar.ts`) by deleting the unused stub (design routes contract reads through the gateway proxy; user-approved decision).
- `contract.ts` polling loop: `txResult` must be typed `Awaited<ReturnType<typeof server.getTransaction>>` (`GetTransactionResponse`), NOT the `SendTransactionResponse` from `sendTransaction()` - their status unions differ (`SEND` has `PENDING|DUPLICATE|TRY_AGAIN_LATER|ERROR`; `GET` has `SUCCESS|FAILED|NOT_FOUND`).
- `server.ts`: `req.params` is `string | string[]` under @types/express@5 - narrow with `as { commitment: string }` (path params are single segments). Catch blocks use `err: unknown` + an `errorMessage()` helper; no `any`.
- `circomlibjs` has no types - declared only the used members (MiMCSponge) in `circomlibjs.d.ts` instead of an `any` escape.

### Isomorphic shared crypto (M1.2 - done)
- `packages/zk-credits-shared` (`@zk-credits/shared`, `file:` dep from `ts/` and `web/`) is the single source of the browser+Node crypto core:
  - `src/crypto.ts` (pure, isomorphic): `generateSecretK` (32-byte via `crypto.getRandomValues`), `deriveMnemonic` / `recoverSecretK` (`@scure/bip39` v2 + english wordlist), `skToField` (BLS12-381 Fr reduction without Node `Buffer`). No `fs`/`path`/`createRequire`/`globalThis`/`window` usage.
  - `src/proof.ts` (DI circuit resources): `proveGroth16(input, wasm, zkey)`, `computeDepositCommitment(secretK, {depositWasm, depositZkey})`, `generateDepositProof`, `verifyGroth16Proof(vk, pubSignals, proof)`. Node passes filesystem paths; the browser passes `/circuits/*` URLs. `snarkjs` is imported as a **named** export (`{ groth16 }`) — snarkjs v0.7.6 is `type: module` with an exports map, so ESM consumers must not use a default import.
  - Package emits **ESM** (`"type": "module"`, `module: node16`): required because `@scure/bip39` v2 is ESM-only and cannot be `require`d from CJS output. Consumed via `require(esm)` on Node 24 (ts-node path) and via bundlers in Next.js. `dist/` is produced by `npm run build` — rebuild it after any shared source change before re-typechecking `ts/`/`web/`.
  - **Hash correction:** the design doc says "Poseidon hash"; the actual circuit hash in this codebase is **MiMCSponge** (circomlibjs `buildMimcSponge`, see `ts/merkle.ts`), which is what the shared mint/commit path uses. Poseidon would require CAP-0075 (not available) and is out of scope for this launch.
- `ts/` refactor: `ts/crypto.ts` re-exports the shared core + resolves Node resource paths from `CIRCUITS_DIR`; `ts/prover.ts` uses shared `proveGroth16`; `ts/server.ts` verifies via shared `verifyGroth16Proof` (inline `require('snarkjs')` removed from all shipped code; only `crypto.test.ts` still references snarkjs, test-only).
- `web/` refactor: `web/src/lib/crypto.ts` re-exports shared with browser URL resources; onboarding + dashboard pages now use shared `deriveMnemonic` (removed the `@scure/bip39` v1 direct imports — this was the v1↔v2 wordlist isomorphism hazard). `@scure/bip39` removed from `web/package.json`.
- Type safety retained: all packages compile under `strict`; escape-scan still 0.

### Client-side proof self-verification (M1.3 - done)
- `@zk-credits/shared` adds `generateRlnProofSelfVerified(input, {rlnWasm, rlnZkey, rlnVk})` + `ProofSelfVerificationError`. Flow: `proveGroth16` → `verifyGroth16Proof` against the injected rln VK → only on success returns `{ proof, publicSignals, nullifier }` (nullifier = `publicSignals[1]`). A failing proof throws and is **never returned** — it cannot be attached to an `X-ZK-Proof` header. The gateway re-verifies as defense in depth.
- Client path wired: `scripts/e2e-test.js` (the public demo client) now proves the deposit commitment and the RLN proof through the shared package; both use `skToField(secretK)` so the secret field value is identical across deposit + RLN proofs. Root `package.json` gained `"@zk-credits/shared": "file:packages/zk-credits-shared"` so `scripts/` resolve it (Node 24 `require(esm)`).
- **v1 bug fixed (discovered during 1.3):** `ts/server.ts` read the replay-protection nullifier from `pubSignals[2]` — which is `share_x`, not the nullifier — because the code assumed an `[epoch, root, nullifier, ...]` layout. The real RLN public signal layout (outputs first, then the public `epoch` input) is `[root, nullifier, share_x, share_y, epoch]`, confirmed by the fixture field names (`pub_root`/`pub_nullifier`/`pub_share_*`/`pub_epoch`), `circuits/scripts/test.js`, and the circuit's output declarations. Fixed via an exported `extractNullifier(pubSignals)` (= index 1) used by the handler, with 2 deterministic regression tests in `server.test.ts` (24/24 green). Before this fix, the nullifier cache keyed on `share_x`, so real replay protection silently failed.
- Robustness note: `generateRlnProofSelfVerified` converts **any** local-verify failure — snarkjs returning `false` OR throwing (e.g. a mismatched VK with a wrong public-signal count throws `TypeError`) — into `ProofSelfVerificationError`. Verified green: shared package 12/12 (valid RLN self-verifies; wrong-VK rejected).
- Boundary: the gateway *stale-root* rejection (a proof that verifies cryptographically but references an old tree root) is defense-in-depth beyond the local self-verify scope; it is exercised by the hosted E2E (M3.3/M4.1), not implemented as a separate gateway check in M1.

### Circuit artifacts (M1.0 - done)
- Shipped via the **verified-consistent v1 artifact set** (the fresh-setup alternative is pathologically slow on this machine — see note below):
  - Freshly-compiled `.wasm`/`.r1cs` (Aug 4) are byte-identical to the committed circuit source (r1cs sizes: deposit 1508732, rln 1856960, slash 348704 — matching the main tree's Jul 6/14 artifacts exactly).
  - v1 `*_final.zkey` (from the repo main tree) verified to match the committed `verification_key_*.json` — `snarkjs zkey export verificationkey` + diff: deposit/rln/slash all MATCH. So zkey ↔ VK ↔ wasm are mutually consistent.
  - Copied the zkeys into the worktree `circuits/` (gitignored) and restored `web/public/circuits/` (`deposit_membership.wasm` + `.zkey`) — the browser proof/self-verify path needs these static files.
  - Validation: `ts` suite 63/64 (1 pre-existing skip), shared package 12/12, `node scripts/test.js` — all circuits prove + verify (incl. slash `secret_k` extraction match).
- **Environment note:** the original `snarkjs groth16 setup` hang (4h+ at ~15% CPU) and a `zkey new`+`contribute`+`beacon` re-attempt (1.2h, still ~15-18% CPU even under `caffeinate -i`) both confirm snarkjs bls12381 WASM *setup* is pathologically slow on this machine (proof generation/verification is fast ~1-2s; the v1 setup was produced on a different machine). The v1 ptau (pot14_0000 → 0001 contribution → final) is a single-contributor dev-only setup, which satisfies the honest-caveat framing for the testnet launch.
- **M3.1 change:** the committed VKs already match the deployed Soroban contract (deployed 2026-07-14 with the real BLS12-381 VK), so M3.1 becomes "confirm the deployed contract matches `verification_key_*_soroban.json`" — **no contract redeploy required**. A fresh setup regen is an optional follow-up (would require the redeploy).

### Durable storage: PostgreSQL provisioning (M2.1 - done)
- Added `pg` (+ `@types/pg`) to `ts/`; new `ts/db/` module:
  - `config.ts` — `getDbConfig(env)` reads `DATABASE_URL` or PG* composite vars; **fails closed** (`DbConfigError`) when neither is present and on a non-numeric `PGPORT`; exports `SCHEMAS = ['gateway','billing','fee-sponsor']`.
  - `migrations/0001_init.sql` — creates the three isolated schemas (`CREATE SCHEMA IF NOT EXISTS "gateway"/"billing"/"fee-sponsor"`; note the quoted `"fee-sponsor"` identifier).
  - `migrate.ts` — `runMigrations(pool, dir)`: applies `.sql` files in filename order, each in a transaction, records them in `public.schema_migrations`; **idempotent** (re-run applies nothing).
  - `client.ts` — `createPool(env)` (fails closed via `getDbConfig`).
  - `index.ts` — re-exports.
- Tests: `config.test.ts` (5 offline, deterministic) + `migrate.test.ts` (2 offline static + 1 opt-in integration). Integration tests are gated on `RUN_DB_TESTS=1` (default `TEST_DATABASE_URL=postgres://localhost:5432/zk_credits_test`, `TEST_ADMIN_DATABASE_URL=postgres://localhost:5432/postgres`) so `npm test` stays green without a DB. Verified locally against Postgres 16 (schemas `billing`/`fee-sponsor`/`gateway` created; re-run is a no-op).
- `.env.example` documents the DB config (fails-closed contract + test-var overrides).
- M2.2/2.3/2.4 will add tables to these schemas via new migrations (`0002_*`).

### M2.5 - Gateway /v1/withdraw co-signer (done 2026-08-04)
- `ts/contract.ts`: new `buildWithdrawEnvelope(depositorSecretKey, commitment, recipient)` — builds the inner `withdraw{commitment, recipient}` tx as the gateway (depositor) key and signs it, returning the envelope XDR (not submitted — the fee relay handles submission).
- New `ts/withdraw.ts`: `requestWithdrawal(deps, commitment, recipient)` orchestration — injects `buildEnvelope` + `relayEnvelope` (both pure seams, offline-testable). Validates required fields (400), surfaces 502 on envelope-build failure, 503 when the fee relay rejects. `WithdrawError` carries the HTTP status.
- `ts/server.ts`: new `POST /v1/withdraw` (GATEWAY_SECRET-gated). Validates `commitment` + `recipient`, checks GATEWAY_SECRET_KEY, builds the co-signed envelope, POSTs it to the fee-sponsor relay (`FEE_SPONSOR_URL/v1/fee-relay`), returns `{ withdrawn, commitment, recipient, feeBumpHash, duplicate }`. Relay rejection → 502; build error → 500.
- Design decisions: withdrawal stays gateway-mediated (custodial v1 limitation — the contract requires `deposit.depositor` auth = the gateway). The user never acquires XLM: the gateway's envelope is fee-bumped by the relay. Honest caveat recorded in requirements: if the gateway disappears, the user cannot withdraw (testnet only).


### M2.4 - Fee-sponsor service + public fee-relay (done 2026-08-04)
- New `ts/db/migrations/0005_fee_sponsor.sql` — `"fee-sponsor".fee_relay_requests` (`inner_tx_hash` PK, `method`, `contract_id`, `inner_tx_xdr`, `status`, `fee_bump_hash`, timestamps) for relay idempotency.
- New `ts/db/fee-sponsor.ts`: `FeeSponsorStore` interface + `MemoryFeeSponsorStore` + `PostgresFeeSponsorStore` (idempotent `recordRelayRequestOnce` — first inner-tx hash wins, retries return the prior record; `markSubmitted`/`markFailed`).
- New `ts/fee-relay.ts`: the fee-relay core. `validateRelayRequest()` is the **method-validation gate** — parses the inner tx XDR, requires exactly one `invokeHostFunction` op, extracts the target contract id via `StrKey.encodeContract(address.contractId())`, and rejects any method other than `slash`/`withdraw` (403) plus any non-contract op (payment → 403) and malformed XDR (400). `buildFeeBumpEnvelope()` fee-bumps with the sponsor key (fee-only authority — inner tx signature/contents untouched). `relayOne()` orchestration: validate → record idempotently → fee-bump → submit (injected `submitEnvelope`) → mark submitted; duplicates return the prior `feeBumpHash` (no re-sponsor); failures mark `failed`.
- New `ts/fee-sponsor-app.ts`: `createFeeRelayApp(deps)` — Express factory exposing `GET /health` + `POST /v1/fee-relay` (body `innerTransactionXdr`). Errors map to `400 missing_inner_transaction`, `403 invalid_relay_request`, `503`/`500`.
- New `services/fee-sponsor/` deployment unit: standalone package (`package.json`, `tsconfig.json`) with `src/server.ts` bootstrap that wires the Postgres store + real RPC `submitEnvelope` (send + poll). Resolves the tested core via `@gateway/*` tsconfig alias; fails closed on missing `ZK_CONTRACT_ID`/`FEE_SPONSOR_SECRET_KEY`/DB.
- Design decisions: the fee relay never touches the inner tx contents (fee-only authority); arbitration is enforced by the contract's `slash{submitter}`/`withdraw{depositor.require_auth}` auth, not the relay. The relay is keyless/public (permissionless reporter slash + user withdraw). Envelope submission is injected so the drain/pipeline logic is fully offline-tested (mock `submitEnvelope`); real testnet submission is the M2.4 live spike pending user-funded keys.


- New `ts/db/migrations/0004_spend_queue.sql` — adds `gateway.accepted_calls.proof_json` (text) + `pub_signals` (jsonb) so the settlement queue is resumable after a restart (the full RLN proof is public inputs only — no secret_k, no commitment linkage).
- `ts/db/gateway.ts`: `AcceptedCall` gains `proof?`/`pubSignals?`; Postgres store persists/reads them; new `markSpendResult(proofHash, onChainSpendTx)` atomically sets `on_chain_spend_tx` + `spent_on_chain` and flips the nullifier's durable `spent_on_chain` record (transaction). `listAcceptedCalls({onlyPendingSpend})` now filters `spent_on_chain = false AND on_chain_spend_tx IS NULL`.
- New `ts/spend-worker.ts`: `drainSpendQueue()` drains pending accepted calls, submits `spend()` per call, marks results; `NullifierAlreadySpent` (durable replay guard) is treated as settled (no infinite retry); transient failures leave the call pending for the next pass; rows without a persisted proof are skipped with a warning. `startSpendWorker()` runs on an interval (`SPEND_WORKER_INTERVAL_MS`, default 10 000) and returns a `stop()` handle.
- New `ts/contract.ts` `spend(spenderSecretKey, proof, pubSignals)` — builds + signs + submits + polls the contract's `spend()` (mirrors `deposit()`).
- `ts/server.ts`: accepted calls now persist `proof` + `pubSignals`; `initDurableGatewayStore()` starts the spend worker (injected `submitSpend` → `contract.spend`).
- Design decision: the worker self-heals via the durable `NullifierSpent`/`is_nullifier_spent` paths — a call spent by another actor is marked settled rather than retried. Live testnet submission is gated on the user-provided Stellar keys (mocked `submitSpend` covers the drain logic offline; the hosted E2E in M3/M4 exercises the live path).

### M2.3 - Billing webhook idempotency (done 2026-08-04)
- New `ts/db/migrations/0003_billing.sql` — `billing.stripe_events` (`event_id` PK, `event_type`, `payload_hash`, `received_at`, `processed`, `processed_at`). Privacy: no customer PII, no card data, no commitment-to-call linkage.
- New `ts/db/billing.ts`: `BillingStore` interface + `MemoryBillingStore` + `PostgresBillingStore`. `recordStripeEventOnce()` is the idempotency primitive — INSERT ... ON CONFLICT via the SQLSTATE-23505 catch (Stripe redeliveries return `inserted: false`); `markStripeEventProcessed()` marks a deposit as submitted.
- New gateway endpoint `POST /v1/billing/stripe-event` (GATEWAY_SECRET-gated): relays a verified Stripe event; first delivery for `checkout.session.completed` extracts `commitment`+`amount` and calls the shared `submitDeposit()` (refactored out of `/v1/deposits`), then marks processed; duplicates return `duplicate: true` (no-op); missing commitment/amount returns `skipped: missing_commitment_or_amount`; non-checkout events are recorded without a deposit.
- `web/src/app/api/webhooks/stripe/route.ts`: now only verifies the Stripe signature then relays the event to the gateway (fire-and-forget; Stripe gets a fast 200). `handleCheckoutCompleted` removed — exactly-once is enforced gateway-side; the web app no longer calls `/v1/deposits` directly.
- Design decisions: DB access stays in the gateway (single Postgres owner; the web app is serverless and gets an idempotent relay instead of a direct DB handle). `payload_hash` uses SHA-256 of `event.id + event.type` (audit field).

### M2.2 - Gateway durable state (done 2026-08-04)
- New `ts/db/gateway.ts`: `GatewayStore` interface + `MemoryGatewayStore` (offline tests/dev) + `PostgresGatewayStore` (production, one transaction per durable accept). Store contract: `recordAcceptedCall(call, commitment)` persists accepted call + marks nullifier seen + increments the commitment's call count **atomically and BEFORE the request is forwarded upstream** (restart durability); `getNullifier`/`markNullifierSpentOnChain` (durable replay cache); `createApiKey`/`getApiKey`/`listApiKeys` (SHA-256 key hash only — raw key never stored); `incrementCallCount`/`getCallCount`/`getAllCallCounts`; `listAcceptedCalls({onlyPendingSpend})` (settlement-queue resumption).
- New `ts/db/migrations/0002_gateway.sql` — `gateway.accepted_calls`, `gateway.nullifier_records`, `gateway.api_key_records`, `gateway.call_counts` + indexes. **Privacy boundary:** accepted_calls/nullifier_records carry NO commitment column — a call can never be joined to a deposit in the schema; per-commitment call counts live in their own table (quota/status only).
- `ts/db/index.ts` re-exports the store types/impls; `reconstructGatewayState(store)` rebuilds `{ nullifiers, callCounts }` from durable rows (restart reconstruction).
- `ts/contract.ts`: new `fetchNullifierSpentEvents(startLedger, endLedger)` — SDK-16 `getEvents` subscription for `NullifierSpent` (topic `["NullifierSpent"]`, value `(nullifier, ledger)`), the on-chain invalidation source.
- `ts/server.ts`: replaced the v1 in-memory Maps with the store. Handlers now: hash the API key before lookup; replay-check the durable nullifier records **with an on-chain `is_nullifier_spent` fallback** when the local cache misses (stale-cache path); enforce quota against durable counts; and call `recordAcceptedCall` before upstream forwarding. New startup `initDurableGatewayStore()` runs migrations + restart reconstruction and **fails closed** if the DB is unreachable (refuses to run with non-durable state). Exported: `setGatewayStore`/`getGatewayStore`/`resetGatewayStoreForTests`, `extractEpoch`, `proofHashOf`, `hashApiKey`.
- Design decisions/deviations: slot defaults to 0 (v1 does not track RLN window slots); `nonceHash` = proofHash (no client nonce in the v1 proof path); the per-call async on-chain `spend()` worker is NOT added in M2.2 (v1 never submitted spend txs — the settlement-queue infrastructure is in place, the worker is an M2.x follow-up).



### M3.5 - CI pipeline (in progress 2026-08-05)
- New `.github/workflows/ci.yml` — a job matrix on `push` (feature-stellar-launch/main) + `pull_request`, with concurrency cancel-in-progress:
  - **gateway** (`ts/`): `npm ci`, `typecheck`, `npm test`, `npm test -- --coverage` → uploads `ts/coverage` artifact.
  - **shared** (`packages/zk-credits-shared`): `npm ci`, `build`, `npm test`.
  - **fee-sponsor** (`services/fee-sponsor`): `npm ci`, `typecheck` (behavior tests live in `ts/`, covered by the gateway job).
  - **web** (`web/`): `npm ci`, `typecheck`, `npm test` (new vitest unit suite), `npx playwright install --with-deps chromium`, `npm run test:e2e` (Playwright webServer runs `npm run build && npm run start`, so `next build` is validated by this step). Uploads `playwright-report` on failure.
  - **circuits** (`circuits/`): `npm ci`, `node scripts/test.js` (off-chain prove/verify).
  - **contract** (`zk-credits-contract`): `dtolnay/rust-toolchain` pinned `1.94.0` + `Swatinem/rust-cache`, `cargo test`.
- New `.github/workflows/deploy-smoke.yml` — post-deploy health smoke (template; activates once `GATEWAY_URL`/`WEB_URL`/`FEE_SPONSOR_URL` secrets exist): gateway `/health`, fee-relay `/health`, web landing renders "ZK API Credits", web `/api/dashboard/status` proxied. The full hosted E2E (`scripts/e2e-test.js`, `scripts/slash-demo.js`) is the M4.1/4.2/4.3 launch gate, run from a credentialed runner, not this health-only smoke.
- **Web test baseline (new, M3.5):** `web` had **no** test infra (no `test` script). Added `vitest` (`web/vitest.config.mts`, `web/src/lib/crypto.test.ts` — 4 unit tests for the browser wiring of `@zk-credits/shared`: 32-byte `generateSecretK`, `deriveMnemonic`→`recoverSecretK` round-trip, `secretKToField` fr-reduction + determinism, alias stability) and Playwright (`web/playwright.config.ts` + `web/e2e/smoke.spec.ts` — landing renders + `/sign-in` "Get Started" link). `web/package.json` gained `test` + `test:e2e` scripts; `@playwright/test@1.62.1` + `vitest@4.1.10` devDeps. `E2E_PORT` env overrides the default 3000 when local dev servers occupy it; `AUTH_URL` is set in the webServer command (next-auth's UntrustedHost log noise is harmless — the session fetch fails gracefully and does NOT fail the smoke).
- **Discovered gap (fixed):** the circuit artifacts (`.wasm`/`*_final.zkey`) were gitignored and untracked — yet they are load-bearing for BOTH the CI circuits job (off-chain prove/verify) and the browser proof/self-verify path (`web/public/circuits/`), so a fresh checkout (CI, Vercel) would lack them. Un-ignored + committed the specific release artifacts in `.gitignore`: `circuits/{deposit_membership,rln_nullifier,slash}.wasm`, `circuits/*_final.zkey`, and `web/public/circuits/deposit_membership.{wasm,final.zkey}`. The large `.ptau` (setup-only) and `.r1cs`/`.sym`/`.wtns` stay ignored.
- **Lockfile note (updated):** `npm ci` now works in every package (the stale-`@emnapi` lockfile failure from the base repo is resolved by the M2 lockfile sync; verified `npm ci --dry-run` exit 0 in `ts/`). CI uses `npm ci` everywhere.
- **Coverage provider (fixed, M3.5-CI validation):** the CI `gateway` job's `npm test -- --coverage` step failed with exit 1 because `@vitest/coverage-v8` was only an optional peer of `vitest` (in the lockfile but never installed by `npm ci`). Added it as a real `devDependency` in `ts/package.json` (lockfile synced via `npm install`) and added a `coverage` block to `ts/vitest.config.ts` (`provider: 'v8'`, `reporter: ['text','html']` for the `ts/coverage` artifact, excluding `node_modules`/`dist`/`storage.ts`/`db/migrations`/`*.d.ts`). Verified local: `npm test -- --coverage` exit 0 and writes `ts/coverage/`. Also added `coverage/`, `test-results/`, `playwright-report/` to the root `.gitignore` so generated reports are not committed.
- **deploy-smoke `if` fix (M3.5-CI validation):** the job-level `if` referenced `secrets.GATEWAY_URL` — the `secrets` context is unavailable in job-level `if` (would make the workflow invalid when activated). Moved the guard to a `Require GATEWAY_URL` step gated on `env.GATEWAY_URL == ''`.
- **First live CI run series (2026-08-05): 4 runs iterated to GREEN — run 31025062673 all 6 jobs pass; each failure was a real gap local macOS dry-runs could not catch:** (1) **`@emnapi` lockfile gap** — Gateway (`ts/`) + Web `npm ci` failed with `Missing: @emnapi/runtime@1.11.3 / @emnapi/core@1.11.3 from lock file` (run 31021171827). This is a platform-sensitive npm-11 arborist bug: the optional `@emnapi` peer tree (from `@napi-rs/wasm-runtime` ← `@rolldown/binding-wasm32-wasi` / `@unrs/resolver-binding-wasm32-wasi`) was missing the **top-level** `@emnapi/runtime`/`@emnapi/core` entries that linux resolution requires — macOS local `npm ci` succeeds (dedupe places them differently) while the linux runner fails. **Fix:** surgically added the missing top-level entries to `ts/package-lock.json` (+11) and `web/package-lock.json` (+22) with the registry `resolved`/`integrity` for `@emnapi/{core,runtime}@1.11.3` (matching the already-present `@napi-rs/wasm-runtime` peers). Verified `npm ci` EXIT=0 in a `node:24` linux container for both. (2) **Fee-sponsor typecheck** (same run) — TS2307 (`Cannot find module 'pg'/'express'/'@stellar/stellar-sdk'`) + TS7006 because the fee-sponsor `tsconfig.json` maps `@gateway/*` → `../../ts/*` and its `server.ts` imports `ts/fee-sponsor-app.ts` + `ts/db/index.ts`, so `tsc` transitively type-checks the shared `ts/` sources needing the gateway's deps — but the job only installed `services/fee-sponsor` deps (locally it passed only because `ts/node_modules` existed). **Fix:** the job now also `npm ci`s in `ts/`. (3) **Shared-package `dist/` gap** (run 31023559066) — installs were green but Gateway + Web typecheck failed `Cannot find module '@zk-credits/shared'`: the `file:`-linked shared package needs its gitignored `dist/` (with `index.d.ts`) built, and CI's fresh checkout has none. A `prepare` script was tried and rejected (npm runs `prepare` in the package dir without its devDeps → `tsc: not found`); the working fix is an explicit **Build @zk-credits/shared** step (`npm ci && npm run build`) in every consuming job (gateway, web, fee-sponsor). (4) **Step working-directory path** (run 31024419645) — step-level `working-directory: ../packages/zk-credits-shared` resolves **from the repo root** in GitHub Actions (not the job's default dir) → `/home/runner/work/../packages` (no such dir); fixed to the repo-relative `packages/zk-credits-shared`. (5) **Coverage provider** — the `@vitest/coverage-v8` addition (commit `0e249a9`) was confirmed valid. All three fixed job paths were simulated step-exact in a `node:24` linux container → EXIT=0 before the green push.
- **Contract toolchain:** local `cargo 1.79` cannot build soroban-sdk 26 (requires `edition2024`, i.e. Rust ≥1.85), so local `cargo test` is not runnable here; CI pins `1.94.0` via `dtolnay/rust-toolchain`. The `cargo test` command is standard and was previously green on the intended toolchain (test_snapshots committed).
**How do pieces connect?**

- Web -> Gateway: web app proxies status/keys/checkout via gateway `/v1/*` endpoints; never talks to Soroban directly.
- Gateway -> Soroban: `contract.ts` reads (simulate) + writes (deposit/spend/slash/withdraw via `server.sendTransaction` + `getTransaction` polling).
- Fee-sponsor -> Soroban: fee-relay wraps collected slash (reporter-built, permissionless) / withdraw (gateway-co-signed) txs in fee bumps; fee-only authority.
- Gateway -> PostgreSQL: durable nullifier cache, call counts, spend-submission queue, API-key records. Nullifier cache invalidated by on-chain `NullifierSpent` event subscription.
- Browser -> Gateway: `X-ZK-Proof` header; browser proves + self-verifies locally first.

## Error Handling
**How do we handle failures?**

- Gateway returns explicit JSON errors (`401` missing auth, `402` proof required, `403` invalid/replayed/over-limit, `409` stale state, `503` paused/unavailable).
- `contract.ts` deposit confirmation polls `getTransaction` up to 20 retries (2s apart), then throws on non-`SUCCESS`.
- Fee-relay: idempotent on inner tx hash; `400` malformed/non-method tx, `403` non-slash/withdraw method, `503` unavailable.

## Performance Considerations
**How do we keep it fast?**

- Browser Groth16 proving ~2-5s first call per session, cached after.
- Gateway off-chain verify < 100 ms; on-chain Soroban spend ~300k gas / ~5s ledger close.
- Merkle witnesses served from the PostgreSQL-backed store (M2); no full re-scan per proof (PRXVT anti-pattern avoided).

## Security Notes
**What security measures are in place?**

- Type safety enforced (strict `tsc` gate, no `@ts-nocheck`/`any`) - prevents the PRXVT anti-pattern.
- `secret_k` never leaves the browser (WebCrypto non-extractable); gateway sees proofs + nullifiers, no key-to-commitment mapping.
- Fee-sponsor: fee-only authority (fee bump does not alter inner tx effects; contract auth gates state; method-validation gate rejects non-slash/withdraw txs).
- **Custodial trust boundary (honest caveat):** the gateway is the on-chain depositor for all deposits and CAN call `withdraw()` on any deposit. Accepted for testnet (no real value); ZK-proof-authorized withdrawal is a future contract upgrade.
- Environment-separated, non-production secrets; missing testnet config fails closed.

## Known Blockers
- **snarkjs bls12381 Groth16 *setup*** is pathologically slow on this dev machine (~15-18% CPU for hours; both `groth16 setup` and `zkey new` paths) — matters only for the optional fresh trusted-setup regen (would also require a contract redeploy). Proof generation/verification at runtime is fast (~1-2s) and fully verified green. Tests/proofs use the verified-consistent v1 artifact set.
- **Live Stellar testnet spike (M2.4/2.5/2.6 live submission)** — the fee-relay, withdrawal co-signer, and spend-worker are code-complete and offline-verified, but real testnet fee-bump / withdraw / spend submission is pending **user-funded Stellar testnet keys**.
- **Hosted deploys (M3.2/3.3/3.4)** — pending Fly.io/Vercel accounts + `GATEWAY_URL`/`WEB_URL`/`FEE_SPONSOR_URL` deploy secrets; the deploy-smoke workflow is a template until these exist.
- **Local `cargo test` for the contract** — needs Rust ≥1.85 (`edition2024`); local toolchain is Cargo 1.79. CI pins `1.94.0`.
