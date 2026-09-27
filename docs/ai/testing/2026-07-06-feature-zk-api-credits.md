---
phase: testing
title: Testing Strategy
description: Define testing approach, test cases, and quality assurance
---

# Testing Strategy

> **M6 reconciliation (2026-09-11):** The checks and counts in the original
> M1–M5 report below are historical. Use the fresh command evidence in
> [`docs/ai/testing/2026-09-11-stellar-launch-level4.md`](../../ai/testing/2026-09-11-stellar-launch-level4.md)
> for the current release decision.

## Test Coverage Goals
**What level of testing do we aim for?**

- Unit test coverage target: 100% of new/changed code.
- Integration test scope: Critical paths (deposit, verification, slash, withdraw).
- End-to-end test scenarios: Full user journey (onboard -> deposit -> prove -> slash).

## Unit Tests
**What individual components need testing?**

### Component/Module 1: Contract (`zk-credits-contract`)
- [x] Test case 1: `test_deposit_and_read` (Valid deposit flow)
- [x] Test case 2: `test_tverifier1_real_proof_verifies_on_chain` (ZK verification logic)
- [x] Test case 3: `test_tcontract6_slash_with_real_proof` (Slash logic with real crypto)
- [x] Test case 4: `test_withdraw` (Withdrawal logic)

### Component/Module 2: Gateway (`ts/`)
- [x] Test case 1: `POST /v1/chat/completions` (Proof verification & forwarding)
- [x] Test case 2: `POST /v1/api-keys` (Auth & key generation)
- [x] Test case 3: `POST /v1/deposits` (Deposit submission)
- [x] Test case 4: Nullifier extraction and configured on-chain dashboard status.
- [x] Test case 5: Soroban event cursoring and repeated-nullifier detection (`slashWatcher.test.ts`).

### Component/Module 3: Web and tooling
- [x] Test case 1: `web/src/lib/stellar.test.ts` verifies RPC simulation decoding for a deposit.
- [x] Test case 2: `scripts/vk-convert.test.js` verifies all generated RLN VK points against the checked-in Soroban fixture.

## Integration Tests
**How do we test component interactions?**

- [x] Integration scenario 1: Stripe Webhook -> Gateway Deposit
- [x] Integration scenario 2: Web App -> Gateway Status Check
- [x] Integration scenario 3: Web App -> configured Stellar deposit read.

## End-to-End Tests
**What user flows need validation?**

- [x] User flow 1: `scripts/e2e-test.js` (Full flow: Health -> Deposit -> Prove -> Replay -> Status)
- [x] User flow 2: `scripts/slash-demo.js` (Slash flow: Double-spend -> Extract -> Verify)
- [x] User flow 3: `web/e2e/full-flow.spec.ts` (Browser E2E: Landing -> Sign-in -> Onboarding -> Dashboard -> Buy Credits -> Generate API Key)
- [x] User flow 4: `web/e2e/full-flow.spec.ts` (Browser recovery: valid 24-word phrase -> recovered dashboard -> API key)
- [x] User flow 5: `ts/server.test.ts` opt-in OpenRouter forwarding with `RUN_OPENROUTER_E2E=1` and `OPENROUTER_API_KEY`.

## Test Reporting & Coverage
**How do we verify and communicate test results?**

- Contract: run the repository contract command before the live release; no historical count is treated as current evidence.
- Gateway: historical counts are superseded; the fresh 2026-09-11 run is `npm run typecheck` plus `npm test` (82 passed, 2 external tests skipped).
- Web unit/lint/build: `npm run test:unit` and `npm run build` pass in the current worktree; lint remains a separate release check.
- VK conversion: `node --test scripts/vk-convert.test.js` passes.
- Circuits: `node scripts/test.js` (3 circuits verified)
- Browser E2E: the Level 4 suite passes on `chromium-desktop` and `chromium-mobile` (6 mocked evaluation tests across both projects); the full suite is 10 tests across both projects.
- Evaluation tests cover HMAC identities, SEP-53 proofs, expiry/replay, wallet uniqueness, feedback validation, privacy scrubbing, checkout ownership/idempotency, migration idempotency, retention purge, and exporter gates.
- CLI smoke checks: `playwright-cli --help` and `vercel --help` return successfully.
