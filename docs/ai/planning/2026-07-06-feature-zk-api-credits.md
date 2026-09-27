---
phase: planning
title: Project Planning & Task Breakdown
description: Break down work into actionable tasks and estimate timeline
---

# Project Planning & Task Breakdown

> **M6 reconciliation (2026-09-11):** This file is the historical M1–M5
> planning record. The current Level 4 implementation and acceptance status
> live in [`docs/ai/planning/2026-09-11-stellar-launch-level4.md`](../../ai/planning/2026-09-11-stellar-launch-level4.md).
> Historical counts, package versions, and “complete” labels below are not
> production evidence.

## Milestones
**What are the major checkpoints?**

- [x] Milestone 1: Contract & Core Circuits Stable
- [x] Milestone 2: Gateway & Web App Functional
- [x] Milestone 3: E2E Integration & Demo Ready
- [x] Milestone 4: Browser E2E & Dev-Mode Testing
- [ ] Milestone 6: Stellar Launch Level 4 production evidence (code implemented; live cohort and deployment gates open)

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

### Phase 4: Dev Mode & Browser E2E
- [x] Task 4.1: Dev auth bypass — `web/src/auth.ts` conditional Credentials provider; sign-in page shows "Dev Sign In".
- [x] Task 4.2: Dev deposit bypass — `web/src/app/api/dev/deposit/route.ts` with simulated fallback.
- [x] Task 4.3: Playwright browser E2E — `web/e2e/full-flow.spec.ts` full user journey; `playwright.config.ts`.
- [x] Task 4.4: Gateway startup fix — `import.meta.dirname` → `__dirname`, Express 5 type, `ts-node` → `tsx`.
- [x] Task 4.5: Dashboard dev-mode UI — buy-credits detects localhost, routes to dev deposit.

### Phase 5: Polish & Hardening
- [x] Task 5.1: `stellar.ts` stub fix — remove `@ts-nocheck`, use `rpc.Server` simulation for contract reads.
- [x] Task 5.2: Gateway slash watcher — poll Soroban contract events and report repeated nullifiers.
- [x] Task 5.3: On-chain VK serialization — generate and test real BLS12-381 points for Soroban.
- [x] Task 5.4: Dashboard on-chain balance — read the configured deposit from the contract.
- [x] Task 5.5: Recovery flow E2E — Playwright test for `/recover` page.
- [x] Task 5.6: OpenRouter upstream test - opt-in proof-backed forwarding test for a real model.

### Phase 6: Stellar Launch Level 4 evaluation
- [x] Task 6.1: Isolated consent, HMAC participant identity, retention, feedback, and Postgres migration.
- [x] Task 6.2: SEP-53 wallet challenge/proof verification with replay, network, uniqueness, and rate-limit controls.
- [x] Task 6.3: Test-mode `$1` checkout metadata, ownership-checked receipts, webhook idempotency, and deposit evidence linking.
- [x] Task 6.4: Opt-in PostHog, Sentry scrubbing, synthetic health workflow, loading/error boundaries, and responsive evaluation UI.
- [x] Task 6.5: Redacted evidence exporter, desktop/mobile Playwright coverage, and lifecycle documentation.
- [ ] Task 6.6: Restore live Render services, configure monitoring, and complete three cold/warm smoke passes.
- [ ] Task 6.7: Run the ten-person consented cohort, verify ten unique deposits, capture screenshots/video, and publish the submission index.

## Dependencies
**What needs to happen in what order?**

- Task 1.2 -> Task 2.1 (Circuits needed for verification)
- Task 1.1 -> Task 2.4 (Contract logic needed for interaction)
- Task 1.3 -> Task 2.1 (Gateway needed for ZK proof handling)
- Task 1.4 -> Task 2.2 (Web app needed for client-side crypto)
- Task 4.1 -> Task 4.2 (Auth bypass needed before deposit bypass testable)
- Task 4.1 -> Task 4.3 (Dev auth needed for Playwright to reach dashboard)
- Task 4.4 -> Task 4.3 (Gateway must start cleanly for Playwright webServer)

## Timeline & Estimates
**When will things be done?**

- Phase 1: Completed (Foundation)
- Phase 2: Completed (Core Features)
- Phase 3: Completed (Integration & Polish)
- Phase 4: Completed (Dev Mode & Browser E2E)
- Phase 5: Completed (Polish & Hardening)

## Status Summary

**Historical progress:** M1–M5 implementation tasks were completed in the
branch history. M6 code and local verification are implemented; the milestone
is not complete until the external service, monitoring, ten-person cohort, and
submission-artifact gates are verified.

**What works end-to-end today (dev mode):**
1. Landing page -> Dev Sign In (no GitHub OAuth needed)
2. Onboarding: generate secret_k -> 24-word BIP-39 mnemonic -> confirm -> IndexedDB
3. Dashboard: generate API key, view usage stats
4. Buy credits: dev deposit (simulated when no on-chain infra)
5. Browser E2E: Playwright passes the full journey and valid recovery flow in Chromium.

**What works end-to-end today (production mode, needs credentials):**
1. GitHub OAuth sign-in (needs `GITHUB_CLIENT_ID` / `GATEWAY_SECRET`)
2. Legacy Stripe Checkout tiers for `$5/$20/$50`, plus the Level 4 `$1` test-mode enrollment checkout (needs `STRIPE_SECRET_KEY`)
3. Gateway `/v1/chat/completions` with ZK proof verification (needs gateway + circuits)
4. On-chain deposit via gateway `/v1/deposits` (needs `GATEWAY_SECRET_KEY` + funded account)
5. Headless E2E via `scripts/e2e-test.js` (needs gateway + circuits)
6. Configured dashboard on-chain status (needs `ZK_CONTRACT_ID`, `GATEWAY_ADDRESS`, and funded RPC access)
7. Level 4 evaluation flow (needs `EVALUATION_HMAC_SECRET`, persistent evaluation Postgres, Freighter testnet wallets, Stripe test-mode webhooks, and a live gateway/fee-sponsor deployment)

## Risks & Mitigation
**What could go wrong?**

- Technical risks: BLS12-381 serialization complexity (Mitigation: generated Soroban VK fixtures are checked by conversion tests and contract tests).
- Resource risks: Browser proving latency (Mitigation: Cache proofs aggressively).
- Dependency risks: `soroban-sdk` API changes (Mitigation: Pin versions).
- Dev-mode drift: Bypasses could mask real integration bugs (Mitigation: run production-mode E2E periodically with real credentials).
- Gateway in-memory state: `apiKeys`, `nullifierCache`, `callCounts` lost on restart (Mitigation: v1 limitation, documented; v2 needs persistent storage).
- Slash monitoring reports repeated successful `NullifierSpent` events and leaves slash-proof submission to the configured operator; automatic proof submission is deferred.
- OpenRouter forwarding coverage is opt-in because it requires a live `OPENROUTER_API_KEY` and model access.

## Resources Needed
**What do we need to succeed?**

- Team: 1 Rust dev (contract), 1 TS dev (gateway/web).
- Tools: Circom, snarkjs, Stellar CLI, Node.js 20+, Playwright.
- Infrastructure: Stellar Testnet access, Stripe test keys (optional for dev mode), GitHub OAuth app (optional for dev mode).
