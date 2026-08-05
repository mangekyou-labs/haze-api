---
phase: requirements
feature: stellar-launch
title: "stellar-launch: Public Testnet Launch of the Stellar ZK-RLN API Credits Gateway"
description: Deploy the existing Stellar v1 codebase to a public, hosted testnet in parallel with the Mina migration, hardened with PRXVT/sdk learnings (fee bump sponsorship, durable storage, type safety, self-verify, isomorphism) and with the six v1 open questions resolved.
---

# Requirements & Problem Understanding

## Problem Statement
**What problem are we solving?**

The `zk-api-credits` Stellar v1 (on `main`) is a working testnet MVP: Circom + snarkjs BLS12-381 proofs, a Soroban `ZkCreditsContract`, a Node.js/Express gateway, and a Next.js web app with GitHub OAuth + Stripe test-mode onboarding. It demos a 5-minute flow (sign-in -> buy credits -> real Claude call -> slash). But it is not **launch-ready**:

- **Non-durable state:** the gateway keeps API keys, nullifier cache, and call counts in in-memory `Map`s - a restart clears them, risking dropped calls, lost counts, and double-forwards on restart (the same anti-pattern found in PRXVT/sdk).
- **No fee sponsorship for slash (permissionless) or withdraw (gateway-mediated):** a reporter must hold XLM to submit a slash (weakens the watchtower incentive); the gateway pays withdraw fees out of operational XLM with no clean sponsorship path, and there is no fee-relay so the end-actor always bears the fee (breaks the "buy with a card, never touch crypto" thesis for slash).
- **Six unresolved open questions:** trusted setup ceremony quality, OpenRouter per-key tier, nullifier cache invalidation policy, session token format, withdrawal flow, and IndexedDB encryption - all blocking a credible public launch.
- **Quality guardrails absent:** no enforced type safety, no client-side proof self-verification, non-isomorphic browser/Node crypto paths.

**Affected users:** developers buying test credits, coding agents making OpenAI-compatible requests, reporters of rate-limit violations, and operators provisioning testnet deposits.

**Current situation/workarounds:** the v1 runs only on `localhost`; a public tester cannot reach it. The Mina migration (`feature-mina-protocol-migration`) is rewriting the protocol on Mina in parallel, but that is a multi-milestone effort. `stellar-launch` takes the existing, proven Stellar code to a public hosted testnet now, so the protocol is live and demonstrable while Mina matures.

## Goals & Objectives
**What do we want to achieve?**

**Primary goals:**
- Deploy the Stellar v1 to a public, hosted testnet: gateway on Fly.io, web app on Vercel, `ZkCreditsContract` on Soroban testnet - accessible at public URLs.
- Fold in PRXVT/sdk learnings: (a) Stellar fee bump sponsorship so users and reporters never need XLM for withdraw/slash; (b) durable PostgreSQL storage replacing in-memory state; (c) full type safety; (d) client-side proof self-verification before submit; (e) isomorphic browser+Node code.
- Resolve the six v1 open questions (see Questions & Open Items).
- Preserve the core product unchanged: developers buy anonymous credits with a card, agents call LLMs via ZK-RLN proofs, over-quota calls slash deposits on-chain, and the gateway cannot link a call to a deposit (ZK enforced).

**Secondary goals:**
- A public 5-minute demo (sign-in -> buy -> real Claude call -> dashboard -> slash) on the hosted testnet.
- CI pipeline (GitHub Actions) for gateway + web + contract + circuits, with E2E smoke test on deploy.

**Non-goals (explicitly out of scope):**
- Mina mainnet deployment, real MINA, or any Mina work - `stellar-launch` is the Stellar track; `feature-mina-protocol-migration` is the parallel Mina track. No shared runtime, no dual-chain.
- Stellar mainnet, real USDC, real money, or a production SLA.
- A real MPC trusted-setup ceremony (single-contributor dev-only setup is retained and honestly labeled; MPC is a mainnet-phase non-goal).
- Multi-gateway cross-provider unlinkability, self-custody, network-layer anonymity (Tor/relay), per-token accurate metering, or bring-your-own-key - all deferred per the v1 roadmap.
- x402 (HTTP 402) protocol support and non-LLM paid APIs - deferred (roadmap Tier 2).
- Encrypted-mnemonic backup beyond the raw 12-word BIP-39 - deferred (future enhancement).

## User Stories & Use Cases
**How will users interact with the solution?**

- As a developer, I want to visit a public URL, sign in with GitHub, and buy $5 test credits with a card (Stripe test mode) so that I can try the protocol without local setup.
- As a developer, I want my browser to generate `secret_k` + commitment and back up a 12-word mnemonic so that I can recover my identity if I lose my browser storage.
- As a coding-agent user, I want to set `OPENAI_BASE_URL` and `OPENAI_API_KEY` to the public gateway and run `claude "..."` so that I get a real Claude response via a ZK-RLN proof the gateway cannot link to my deposit.
- As a developer, I want my browser to verify its own ZK proof before sending it so that I catch malformed proofs locally (and the gateway re-verifies as defense in depth).
- As a developer, I want to withdraw unused test credits to my Stellar account without acquiring XLM, via a gateway-mediated fee-sponsored withdrawal, so that the "buy with a card, never touch crypto" promise holds (with the honest caveat that the gateway must co-sign).
- As a reporter, I want to submit a slash proof on-chain without acquiring XLM, via a fee-sponsored transaction, so that the permissionless watchtower incentive works.
- As an operator, I want the gateway to survive a restart without losing accepted-call records, nullifier state, or the settlement queue, so that a public deployment is reliable.

**Key workflows:**
- Happy path: public sign-in -> buy test credits -> set env vars -> run agent -> real response.
- First-call path: browser generates + self-verifies proof (~2-5s) -> cache for session -> subsequent calls fast.
- Privacy path: every call's proof is unlinkable to deposit (ZK enforced by on-chain Soroban verifier).
- Attack path: over-quota -> nullifier collision -> secret reveal -> permissionless, fee-sponsored slash -> 50/50 split.
- Withdrawal path: user requests withdraw via gateway -> gateway co-signs as depositor -> fee-sponsor fee-bumps -> broadcast to chosen Stellar address (gateway-mediated; user never needs XLM).
- Restart path: gateway restarts -> reconstructs nullifier cache + call counts + settlement queue from PostgreSQL -> no lost/duplicated calls.

**Edge cases:**
- Gateway restart mid-batch: durable settlement queue resumes; no double-forward or dropped call.
- Fee-relay unavailable: slash/withdraw callers get a clear 503; the inner transaction is never broadcast without a valid fee bump. Gateway unavailable: withdrawal cannot proceed (gateway-mediated; honest caveat).
- Nullifier cache stale vs. on-chain: cache is invalidated by subscribing to on-chain `NullifierSpent` events; a stale cache falls back to an on-chain read.
- Ledger closes mid-call (5s on Stellar): off-chain verify + async on-chain submit; slash protection is eventual (documented honestly).
- User loses mnemonic AND browser: unused test credits unrecoverable (documented honestly; testnet only).

## Success Criteria
**How will we know when we're done?**

- [ ] The gateway is deployed to Fly.io and reachable at a public URL; `GET /health` returns 200.
- [ ] The web app is deployed to Vercel and reachable at a public URL; sign-in -> buy -> dashboard works end-to-end.
- [ ] The `ZkCreditsContract` is deployed to Soroban testnet; `GET /v1/contract-status` returns deposit count and roots.
- [ ] A public tester can complete the 5-minute demo: sign-in -> buy $5 test credits -> set env vars -> run `claude "..."` -> receive a real Claude response -> view dashboard.
- [ ] The browser verifies each ZK proof locally before sending it to the gateway; the gateway re-verifies and rejects invalid/replayed proofs.
- [ ] A simulated over-quota violation is slashed permissionlessly on testnet with a fee-sponsored transaction; the 50/50 treasury/reporter split is verifiable on-chain.
- [ ] An unslashed user withdraws unused test credits to a chosen Stellar address via a gateway-mediated, fee-sponsored withdrawal (gateway co-signs as depositor; fee-sponsor pays the fee), without acquiring XLM.
- [ ] The gateway survives a restart with no lost accepted-call records, nullifier state, or spend-submission queue (durable PostgreSQL backing; Stellar v1 does per-call async on-chain `spend()`, not batch settlement); `scripts/e2e-test.js` passes immediately after a restart.
- [ ] Shipped code has full type safety: no `// @ts-nocheck`, no `any`-escape hatches, no disabled strict checks across gateway, web, and fee-sponsor.
- [ ] Browser and Node.js code paths are isomorphic via dependency injection / environment detection, with no `globalThis`/`window` global-pollution hacks.
- [ ] The nullifier cache is backed by a durable table and invalidated by on-chain `NullifierSpent` event subscription (v1 open question #3 resolved).
- [ ] The six v1 open questions are resolved and documented (see Questions & Open Items).
- [ ] CI (GitHub Actions) runs gateway, web, contract, and circuit tests on push and runs an E2E smoke test on deploy.
- [ ] The README and web landing page document all honest caveats: testnet-only (no real money), single-contributor dev-only trusted setup (no "real ZK" overclaim), custodial model with gateway-mediated withdrawal (the gateway as depositor CAN withdraw any deposit; if the gateway disappears, the user cannot withdraw unused test credits), single gateway (could log timing patterns), browser proving latency (~2-5s first call), and network identity not hidden (IP visible).

## Constraints & Assumptions
**What limitations do we need to work within?**

**Technical constraints:**
- Chain: Stellar testnet (`stellar:testnet`), CAP-0059 BLS12-381 host functions live (Protocol 22+).
- Smart contracts: Rust + `soroban-sdk` (existing `zk-credits-contract`).
- ZK circuits: Circom + snarkjs compiled with `-p bls12381` (existing `circuits/`); single-contributor trusted setup, dev-only.
- Poseidon hash (CAP-0075) NOT live -> hash entirely in-circuit; on-chain contract stores Merkle roots and verifies proofs.
- Payments: USDC testnet via Circle faucet, 7-decimal base units, trustline required.
- Gateway: Node.js + Express + TypeScript (existing `ts/`), OpenAI-compatible `/v1/chat/completions`.
- Web app: Next.js + App Router + next-auth (GitHub OAuth), Stripe test mode (existing `web/`).
- Upstream LLM: OpenRouter only.
- Fee sponsorship: Stellar fee bump transactions (SEP-0041-style) via a dedicated fee-sponsor service.
- Durable storage: PostgreSQL with isolated schemas (gateway, billing, fee-sponsor).
- Browser crypto: `@noble/hashes` for Poseidon, `ffjavascript` for field arithmetic, Circom WASM prover for Groth16 (client-side self-verification).
- Rate limit: per-epoch (UTC midnight reset), nullifier = `H(secret_k, epoch)`; pricing flat $0.001/call for demo.

**Business constraints:**
- Parallel to the Mina migration; no shared runtime, no dual-chain; the two tracks ship independently.
- No real money (Stripe test mode, USDC testnet faucet).
- Public testnet audience: individual developers (not institutions).

**Assumptions (accepted):**
- OpenRouter accepts the gateway's API key without per-user tracking that would defeat the privacy model; the per-key rate limit is checked pre-launch and a sufficient tier is used (v1 open question #2).
- Browser Groth16 proving (~2-5s first call) is acceptable for the public testnet audience.
- 5s Stellar ledger close is mitigated via off-chain verify + async on-chain submit; slash protection is eventual (documented honestly).
- Custodial model accepted for the testnet launch: gateway holds USDC, user holds `secret_k`. The gateway cannot make anonymous API calls (`spend()`) without the user's proof (the proof requires `secret_k`, which only the user holds). **However, as the on-chain depositor, the gateway CAN call `withdraw()` on any deposit to any recipient** (`deposit.depositor.require_auth()` passes for the gateway). This is the custodial trust risk: a malicious or disappearing gateway could withdraw user funds or block withdrawal. It is accepted for the testnet launch (no real value at risk; USDC is testnet faucet) and documented as an honest caveat. ZK-proof-authorized withdrawal (removing the gateway's depositor authority) is a future contract upgrade.
- Stripe test-mode webhooks are reliable enough for the public testnet.
- Trusted setup is single-contributor dev-only; the public launch labels it honestly as "testnet ZK with dev-only setup" and does not overclaim "real ZK" security (v1 open question #1).
- Session token is a custom signed JWT with a `secret_k`-derived signature (v1 open question #4).
- Withdrawal is gateway-mediated and fee-sponsored: the gateway co-signs as the on-chain depositor (the contract requires `deposit.depositor.require_auth()`); the fee-sponsor fee-bumps so the user never needs XLM (v1 open question #5).
- `secret_k` is stored in IndexedDB via WebCrypto non-extractable + 12-word BIP-39 mnemonic backup (v1 open question #6).

## Questions & Open Items
**What do we still need to clarify?**

### Resolved (v1 open questions + PRXVT hardening)

1. **Trusted setup ceremony (v1 OQ #1)** - Resolved: single-contributor powers-of-tau, documented prominently as dev-only; honest framing "testnet ZK with dev-only setup." MPC ceremony is a mainnet-phase non-goal.
2. **OpenRouter tier (v1 OQ #2)** - Resolved: check per-key limits pre-launch; use a sufficient tier to avoid gateway-key rate limits during public testnet load. Accepted assumption.
3. **Nullifier cache invalidation (v1 OQ #3)** - Resolved: durable PostgreSQL-backed cache, invalidated by subscribing to on-chain `NullifierSpent` events; stale cache falls back to an on-chain read.
4. **Session token format (v1 OQ #4)** - Resolved: custom signed JWT with `secret_k`-derived signature. Accepted assumption.
5. **Withdrawal flow (v1 OQ #5)** - Resolved: gateway-mediated withdrawal to a chosen Stellar address. The user requests via a gateway endpoint; the gateway co-signs the withdraw tx as the on-chain depositor (the contract requires `deposit.depositor.require_auth()`); the fee-sponsor fee-bumps so the user never needs XLM. Honest caveat: withdrawal is NOT permissionless — if the gateway disappears, the user cannot withdraw unused test credits (testnet only). ZK-proof-authorized withdrawal is a future contract upgrade.
6. **Browser IndexedDB encryption (v1 OQ #6)** - Resolved: WebCrypto non-extractable + 12-word BIP-39 mnemonic backup. Encrypted-mnemonic backup is a future enhancement.
7. **Fee sponsorship (PRXVT hardening)** - Resolved: Stellar fee bump via a dedicated fee-sponsor service with a public fee-relay; fee-only authority (fee bump doesn't alter inner tx effects; contract auth gates state).
8. **Durable storage (PRXVT hardening)** - Resolved: PostgreSQL with isolated schemas for nullifier cache, API-key records, call counts, settlement queue, webhook receipts, fee-relay idempotency.
9. **Quality guardrails (PRXVT hardening)** - Resolved: full type safety, client-side proof self-verification, isomorphic browser+Node code - all encoded as success criteria.

### Open items

None. Launch scope, fee sponsorship, durable storage, guardrails, trusted setup, and all six v1 open questions are approved.
