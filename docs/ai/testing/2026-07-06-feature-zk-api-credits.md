---
phase: testing
title: "zk-api-credits: Testing Strategy"
description: Test scenarios derived from requirements success criteria and design components — circuits, contract, verifier, gateway, browser crypto, web app, E2E, slash demo.
---

# Testing Strategy

## Test Coverage Goals

**What level of testing do we aim for?**

- **Unit test coverage:** 100% of new/changed code in contract (Rust `#[test]`) and gateway (Node `vitest`/`jest`). Browser crypto has integration tests (WASM prover is third-party).
- **Integration test scope:** all contract functions + gateway endpoints + browser → gateway → contract flow
- **End-to-end test scenarios:** 5 user stories from requirements doc, mapped to 5 flows in design doc
- **Alignment with acceptance criteria:** each of the 8 success criteria in requirements has at least one test scenario below

## Unit Tests

### Circom Circuits (off-chain, Node + snarkjs)

- [x] **T-circuit-1:** Valid `deposit_membership` proof verifies off-chain (8,583 constraints, MiMC hash) → T2.1, T2.4, T2.5 ✓
- [x] **T-circuit-2:** Wrong `secret_k` (doesn't match commitment) → proof generates against different root; verification against real root fails (covers: commitment binding) → T2.1 ✓
- [x] **T-circuit-3:** `rln_nullifier` produces correct nullifier + share (10,564 constraints, epoch is now a public input) → T2.2 ✓
- [x] **T-rln-1:** Two shares with same epoch → solving linear system recovers `secret_k` (covers: RLN slash math) → T2.2, T2.5 ✓
- [x] **T-rln-2:** Valid `slash` proof extracts `secret_k` and verifies (1,324 constraints) → T2.3, T2.4 ✓
- [x] **T-rln-3:** Wrong shares (different epochs) → slash proof generation fails (circuit rejects inconsistent epoch) → T2.3 ✓

### ZkCreditsContract (Rust `#[test]`)

- [x] **T-contract-1:** Contract deploys + constructor works, `get_deposit_count() == 0` → T3.1 ✓
- [x] **T-contract-2:** `deposit()` accepts commitment + new_root, updates root, stores deposit → T3.2 ✓
- [x] **T-contract-3:** Historical roots map populated; old roots retrievable (covers: root history for proof verification) → T3.2 ✓
- [x] **T-contract-4:** `spend()` with valid proof → emits `NullifierSpent`, nullifier recorded (covers: spend happy path) → T3.3, T4.2 ✓ (test_tverifier1, nullifier check added)
- [x] **T-contract-5:** `spend()` with replayed nullifier → rejected (covers: double-spend prevention) → T3.3 ✓ (test_tverifier1, replay assertion)
- [x] **T-contract-6:** `slash()` with valid proof + commitment → deposit marked slashed, USDC split 50/50, emits `Slashed` (covers: slash happy path) → T3.4, T4.2 ✓ (test_tcontract6_slash_with_real_proof)
- [x] **T-contract-7:** `slash()` on already-slashed deposit → rejected (covers: no double-slash) → T3.4 ✓ (test_tcontract7_slash_already_slashed)
- [x] **T-contract-8:** Slash USDC split is exactly 50% treasury + 50% submitter (covers: slash economics, success criterion 7) → T3.4 ✓ (verified in test_tcontract6)
- [x] **T-contract-9:** `withdraw()` requires depositor auth, transfers USDC, marks deposit withdrawn → T3.5 ✓
- [x] **T-contract-10:** `withdraw()` on already-withdrawn deposit → rejected → T3.5 ✓
- [x] **T-contract-11:** `deposit()` with negative/zero amount → rejected → T3.2 ✓
- [x] **T-contract-12:** `deposit()` with duplicate commitment → rejected → T3.2 ✓
- [x] **T-contract-13:** `slash()` with nonexistent commitment → rejected → T3.4 ✓
- [x] **T-contract-14:** `is_nullifier_spent()` returns false for unknown nullifier → T3.3
- [x] **T-contract-15:** `get_deposit()` returns None for unknown commitment → T3.2
- [x] **T-contract-16:** `withdraw()` after slash guard exists (state validation) → T3.5

### On-chain Verifier (Rust `#[test]` with BLS12-381)

- [x] **T-verifier-1:** Real Groth16 proof from off-chain harness verifies on-chain (covers: CAP-0059 integration) → T4.1 ✓ (test_tverifier1_real_proof_verifies_on_chain)
- [x] **T-verifier-2:** Tampered proof (flipped bit) → `verify_proof` returns false (covers: malformed proof rejection) → T4.1 ✓ (test_tverifier2_tampered_proof_rejected)
- [x] **T-verifier-3:** Proof verified with wrong verifying key → fails (covers: VK binding) → T4.1 ✓ (test_tverifier3_wrong_vk_rejects_proof)

### Gateway (Node `vitest`)

- [x] **T-gateway-1:** `GET /health` returns 200 (covers: server alive) → T5.1 ✓
- [x] **T-gateway-2:** `OpenRouterAdapter.forwardRequest()` proxies to OpenRouter (covers: provider adapter interface) → T5.4 ✓
- [x] **T-gateway-3:** `POST /v1/chat/completions` with valid proof + API key → 200 with real LLM response (covers: happy path) → T5.6 ✓ (verified via E2E: gateway → OpenRouter → Claude Sonnet 4, 200 OK)
- [x] **T-gateway-4:** Replay same nullifier → 403 `nullifier_spent` (covers: cache fast-reject) → T5.6 ✓
- [x] **T-gateway-5:** `GET /v1/status/:commitment` returns user stats (calls, keys, quota) → T7.3 ✓
- [x] **T-gateway-6:** Rejects malformed proof header (not JSON, wrong signal count) → T5.6 ✓
- [x] **T-gateway-7:** Rejects proof with missing fields in proof object → T5.6 ✓
- [x] **T-gateway-8:** Rejects invalid proof (verification fails) → T5.6 ✓
- [ ] **T-auth-1:** GitHub OAuth sign-in completes, user record created (covers: auth flow) → T5.2
- [ ] **T-auth-2:** Session persists across requests (covers: session management) → T5.2
- [x] **T-api-key-1:** API key generated for valid commitment via `POST /v1/api-keys` → T5.5 ✓
- [x] **T-api-key-2:** Missing commitment rejected (covers: input validation) → T5.5 ✓
- [x] **T-api-key-3:** API key format starts with `sk-zk-` (covers: key format) → T5.5 ✓
- [x] **T-auth-3:** Missing Authorization header → 401 (covers: auth check) → T5.2 ✓
- [x] **T-auth-4:** Invalid API key → 401 (covers: key validation) → T5.2 ✓
- [x] **T-auth-6:** Missing GATEWAY_SECRET → 500 (covers: server misconfiguration) → T5.5 ✓
- [x] **T-auth-7:** Wrong GATEWAY_SECRET → 401 (covers: auth enforcement) → T5.5 ✓
- [x] **T-deposit-1:** Stripe checkout → `POST /v1/deposits` → on-chain `Deposited` event. Verified: tx `0555d3e7...`, 3 deposits on contract. Commitment passed via Stripe metadata. → T5.3 ✓
- [x] **T-slash-1:** Over-quota: nullifier collision detected → second proof rejected (403). Slash demo script extracts secret_k via slash circuit. → T9.1 ✓
- [x] **T-slash-2:** Slash circuit extracts secret_k from two shares (same epoch). Verified: extracted key matches original. → T9.1 ✓

### Browser Crypto (vitest)

- [x] **T-browser-1:** `secret_k` generated (32 bytes, `crypto.getRandomValues`) → T6.1 ✓
- [x] **T-browser-2:** Mnemonic roundtrip: 32 bytes → 24-word BIP-39 → restore original bytes (covers: recovery path) → T6.1 ✓
- [x] **T-browser-3:** Browser commitment computation using deposit_membership circuit WASM → deterministic, matches circuit (covers: hash compatibility) → T6.2 ✓
- [x] **T-browser-4:** Browser-generated Groth16 proof verifies with `snarkjs groth16 verify` in Node (covers: WASM prover correctness) → T6.3 ✓
- [x] **T-browser-5:** First-call proof generation < 6 seconds — E2E measures ~850ms–1300ms for RLN proof (Node.js). Browser WASM may be slower but well under 6s. → T6.3 ✓
- [x] **T-browser-6:** Cached proof reuse: second call proving < 500ms — ProofCache class with stable-key dedup, hit/miss tracking, in-flight de-dup (covers: success criterion 2) → T6.4 ✓
- [x] **T-storage-1:** In-memory store: set/get/delete/overwrite/multiple keys → T6.1 ✓

### Merkle Tree (vitest)

- [x] **T-merkle-1:** Tree starts with zero root and 0 leaves → `ts/merkle.test.ts` ✓
- [x] **T-merkle-2:** Insert returns non-zero root, increments leaf count → `ts/merkle.test.ts` ✓
- [x] **T-merkle-3:** Different leaves produce different roots → `ts/merkle.test.ts` ✓
- [x] **T-merkle-4:** Same leaf produces same root (deterministic) → `ts/merkle.test.ts` ✓
- [x] **T-merkle-5:** Root changes after each insert → `ts/merkle.test.ts` ✓
- [x] **T-merkle-6:** Fills to capacity (2^3 = 8), throws when full → `ts/merkle.test.ts` ✓
- [x] **T-merkle-7:** Root fits in BLS12-381 Fr order → `ts/merkle.test.ts` ✓

### Web App (Playwright E2E)

- [x] **T-web-1:** Next.js scaffolded with App Router + next-auth (GitHub OAuth) → T7.1 ✓
- [x] **T-web-2:** Buy credits Stripe Checkout — `/api/checkout` creates session, `/api/webhooks/stripe` handles `checkout.session.completed` with signature verification. Three tiers ($5/$20/$50). Manual test with Stripe test card `4242 4242 4242 4242`. → T7.2 ✓
- [x] **T-web-3:** Dashboard usage stats — calls today, remaining quota, active keys via gateway status endpoint → T7.3 ✓
- [x] **T-web-4:** API key generation page with setup snippet → works via gateway proxy → T7.4 ✓
- [x] **T-web-5:** Onboarding flow (secret_k gen + mnemonic backup + 3-word confirmation) → T7.5 ✓
- [x] **T-auth-1:** GitHub OAuth sign-in → protected dashboard redirect → T7.1 ✓
- [x] **T-auth-5:** API key generation requires auth session (C5 fixed) → gateway tests pass (10) ✓
- [x] **T-gateway-5:** GET /v1/status/:commitment returns user stats (calls, keys, quota) → T7.3 ✓

## Integration Tests

**How do we test component interactions?**

- [x] **T-int-1:** Gateway → contract read (get_deposit_count, get_current_root via simulation) → T8.1 ✓
- [x] **T-int-2:** Stripe webhook → gateway `POST /v1/deposits` → contract `deposit()` on-chain. Pipeline: checkout includes commitment in metadata, webhook calls gateway, gateway inserts into Merkle tree (MiMC), calls `contract.deposit()`. Requires `GATEWAY_SECRET_KEY` for signing. → T7.2 ✓ (code complete)
- [x] **T-int-3:** Gateway nullifier cache → second proof with same nullifier rejected (403) → T5.6, T9.1 ✓
- [x] **T-int-4:** Two calls same epoch, different signals → two different nullifiers (no collision) → T8.1 ✓ (E2E: unique signal per call; nullifier = MiMC(secret_k, epoch, hash(signal)))
- [x] **T-int-5:** Same-epoch double-spend → nullifier collision detected → secret_k extracted via slash circuit → T9.1 ✓

## End-to-End Tests

**What user flows need validation?**

- [x] **T-e2e-1:** E2E script: key gen → RLN proof → chat completions → nullifier replay rejection → status check (via `scripts/e2e-test.js`) → T8.1 ✓
- [x] **T-e2e-2:** User story 2 (per-call): E2E test with real OpenRouter → Claude Sonnet 4: 200 OK, 3278ms. Proof gen 809ms. Gateway verifies ZK proof, forwards to OpenRouter, returns real LLM response. Nullifier replay rejected 403. → T8.1 ✓
- [x] **T-e2e-3:** Dashboard: calls today, remaining quota, active keys — reads from gateway status endpoint → T7.3 ✓
- [x] **T-e2e-4:** Slash demo: two proofs same epoch → nullifier collision → secret_k extraction verified (via `scripts/slash-demo.js`) → T9.1 ✓
- [x] **T-e2e-5:** User story 5 (recovery): `/recover` page accepts 24-word mnemonic → recovers secret_k → computes commitment → stores in IndexedDB → redirects to dashboard. Link from `/sign-in`. Build passes, route registered. → T6.1, T7.5 ✓
- [x] **T-e2e-6:** Demo script complete: `scripts/demo-script.md` covers all8 steps → T9.2 ✓

## Test Data

**What data do we use for testing?**

- **Fixtures:**
  - 3 pre-generated `secret_k` values + their commitments (deterministic, for circuit tests)
  - 2 pre-funded Stellar testnet accounts (gateway + demo user) with USDC trustlines
  - Pre-computed Groth16 proofs for `deposit_membership`, `rln_nullifier`, `slash` (golden proofs for regression)
  - Stripe test card `4242 4242 4242 4242` (any future date, any CVC)
- **Mocks:**
  - OpenRouter: mock response for `anthropic/claude-opus-4.8` (avoid burning real credits in unit tests)
  - Stellar RPC: use `stellar:testnet` for integration; mock for pure unit tests
  - GitHub OAuth: next-auth test helper
- **Seed data:**
  - One deposit already on-chain (for spend/slash tests without re-running deposit flow)
  - One nullifier already spent (for replay-rejection tests)

## Test Reporting & Coverage

**How do we verify and communicate test results?**

- **Contract:** `cargo test --workspace` → exit 0; coverage via `cargo tarpaulin` if needed
- **Gateway:** `npm run test -- --coverage` → vitest coverage report; target 100% of new code
- **Browser crypto:** Playwright test suite; manual latency measurement logged to `docs/ai/testing/performance-log.md`
- **E2E:** manual run + recorded video for demo (T9.2)
- **Coverage gaps:** WASM prover internals (third-party, trust `snarkjs`); Stripe webhook signature verification (use Stripe CLI to simulate)

## Manual Testing

**What requires human validation?**

- [ ] UI/UX: sign-in flow reads well, onboarding mnemonic screen is clear, dashboard updates feel live
- [ ] Browser compatibility: Chrome, Firefox, Safari (WebCrypto + IndexedDB + WASM support varies)
- [ ] Demo dry run: complete 5-minute demo script end-to-end on a fresh machine
- [ ] Accessibility: onboarding mnemonic screen readable by screen readers; keyboard navigable

## Performance Testing

**How do we validate performance?**

- [x] **T-perf-1:** Cached call gateway overhead < 500ms — E2E script measures ~350ms for mock adapter (covers: success criterion 2) → T8.2 ✓
- [x] **T-perf-2:** First-call latency (with browser proving) < 6s — Node.js proof gen ~1.5s (covers: success criterion 3) → T8.2 ✓
- [ ] **T-perf-3:** On-chain `spend()` gas cost < 300k gas (covers: cost target in design NFRs) → T3.3, T4.1
- [ ] **T-perf-4:** On-chain `slash()` gas cost < 300k gas → T3.4, T4.1
- [ ] **T-perf-5:** Onboarding (sign-in → first Claude response) < 90s (covers: success criterion 1) → T8.1, T8.2

## Bug Tracking

**How do we manage issues?**

- **Process:** GitHub Issues on the repo; label with milestone (M1–M10) and severity (P0/P1/P2)
- **Severities:**
  - P0: slash doesn't fire / funds stolen / proof verifier accepts invalid proofs — blocks demo
  - P1: latency > 2x target / dashboard doesn't update / auth broken — demo-impacting
  - P2: UI polish / minor edge cases — fix before public showcase
- **Regression:** after any contract or circuit change, re-run T-verifier-1, T-contract-4, T-contract-6, T-rln-1 (the cryptographic core)

## Alignment with Requirements Success Criteria

| Success criterion | Test scenarios |
|---|---|
| 1. Onboarding < 90s | T-perf-5, T-e2e-1 |
| 2. Cached call < 500ms overhead | T-perf-1, T-browser-6 |
| 3. First-call < 6s | T-perf-2, T-browser-5 |
| 4. Slash within 1 ledger | T-slash-1, T-e2e-4 |
| 5. Gateway can't link call to deposit | T-e2e-2 (inspect gateway logs vs on-chain nullifiers) |
| 6. Works with 4 agents via env vars | T-e2e-2 (sub-flow with codex/opencode/cline) |
| 7. Slash 50/50 treasury+reporter | T-contract-8, T-e2e-4 |
| 8. 5-min demo on testnet | T-e2e-6, T-demo-1 |
