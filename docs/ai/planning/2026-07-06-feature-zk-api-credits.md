---
phase: planning
title: Project Planning & Task Breakdown
description: Break down work into actionable tasks and estimate timeline
---

# Project Planning & Task Breakdown

## Milestones
**What are the major checkpoints?**

- [x] Milestone 1: Contract & Core Circuits Stable
- [x] Milestone 2: Gateway & Web App Functional
- [x] Milestone 3: E2E Integration & Demo Ready

## Task Breakdown
**What specific work needs to be done?**

### Phase 1: Foundation
- [x] Task 1.1: Contract unit tests (Rust) - Validate logic for deposit, spend, slash, withdraw.
- [x] Task 1.2: Circuit compilation & Setup - Ensure `circom` build and `snarkjs` setup scripts work.
- [x] Task 1.3: Gateway setup - `ts/server.ts` basic health check and env config.
- [x] Task 1.4: Web app setup - `web/` basic Next.js app with landing page.

### Phase 2: Core Features
- [x] Task 2.1: Gateway ZK Proof verification - `ts/prover.ts` logic and integration with `server.ts`.
- [x] Task 2.2: Web App `secret_k` generation - `web/src/lib/crypto.ts` and onboarding flow.
- [x] Task 2.3: Stripe integration - `web/src/app/api/checkout` and webhook handling.
- [x] Task 2.4: Contract interaction logic - `ts/contract.ts` and `web/src/lib/stellar.ts` read/write stubs.

### Phase 3: Integration & Polish
- [x] Task 3.1: E2E test script - `scripts/e2e-test.js` implementation.
- [x] Task 3.2: Slash demo script - `scripts/slash-demo.js` implementation.
- [x] Task 3.3: Documentation updates - Ensure all READMEs are accurate and reflect current state.
- [x] Task 3.4: Error handling & Edge cases - Address custodial limitations and protocol details.

## Dependencies
**What needs to happen in what order?**

- Task 1.2 -> Task 2.1 (Circuits needed for verification)
- Task 1.1 -> Task 2.4 (Contract logic needed for interaction)
- Task 1.3 -> Task 2.1 (Gateway needed for ZK proof handling)
- Task 1.4 -> Task 2.2 (Web app needed for client-side crypto)

## Timeline & Estimates
**When will things be done?**

- Phase 1: Completed (Foundation)
- Phase 2: Completed (Core Features)
- Phase 3: Completed (Integration & Polish)
- Total: ~1 week for full integration (Actual: Completed)

## Risks & Mitigation
**What could go wrong?**

- Technical risks: BLS12-381 serialization complexity (Mitigation: Use arkworks as reference).
- Resource risks: Browser proving latency (Mitigation: Cache proofs aggressively).
- Dependency risks: `soroban-sdk` API changes (Mitigation: Pin versions).

## Resources Needed
**What do we need to succeed?**

- Team: 1 Rust dev (contract), 1 TS dev (gateway/web).
- Tools: Circom, snarkjs, Stellar CLI, Node.js 20+.
- Infrastructure: Stellar Testnet access, Stripe test keys.
