---
phase: testing
title: Testing Strategy
description: Define testing approach, test cases, and quality assurance
---

# Testing Strategy

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

## Integration Tests
**How do we test component interactions?**

- [x] Integration scenario 1: Stripe Webhook -> Gateway Deposit
- [x] Integration scenario 2: Web App -> Gateway Status Check

## End-to-End Tests
**What user flows need validation?**

- [x] User flow 1: `scripts/e2e-test.js` (Full flow: Health -> Deposit -> Prove -> Replay -> Status)
- [x] User flow 2: `scripts/slash-demo.js` (Slash flow: Double-spend -> Extract -> Verify)

## Test Reporting & Coverage
**How do we verify and communicate test results?**

- Contract: `cargo test` (22 tests passed)
- Gateway: `npm test` (61 tests passed)
- Circuits: `node scripts/test.js` (3 circuits verified)
