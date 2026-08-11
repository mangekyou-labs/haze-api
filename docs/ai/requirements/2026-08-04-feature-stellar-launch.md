---
phase: requirements
feature: stellar-launch
title: "stellar-launch: Public Testnet Launch of the Stellar ZK-RLN API Credits Gateway"
description: Deploy a paper-aligned, fixed-cost specialization of the ZK API Usage Credits protocol to a public Stellar testnet, with indexed RLN tickets, real OpenRouter responses, fee sponsorship, durable storage, type safety, and browser proof self-verification.
---

# Requirements & Problem Understanding

## Problem Statement
**What problem are we solving?**

The `zk-api-credits` Stellar v1 (on `main`) is a working testnet MVP: Circom + snarkjs BLS12-381 proofs, a Stellar smart contract, a Node.js/Express gateway, and a Next.js web app with GitHub OAuth + Stripe test-mode onboarding. It demos a 5-minute flow (sign-in -> buy credits -> real OpenRouter call -> slash). But it is not **launch-ready**:

- **Non-durable state:** the gateway keeps API keys, nullifier cache, and call counts in in-memory `Map`s - a restart clears them, risking dropped calls, lost counts, and double-forwards on restart (the same anti-pattern found in PRXVT/sdk).
- **No fee sponsorship for slash (permissionless) or withdraw (gateway-mediated):** a reporter must hold XLM to submit a slash (weakens the watchtower incentive); the gateway pays withdraw fees out of operational XLM with no clean sponsorship path, and there is no fee-relay so the end-actor always bears the fee (breaks the "buy with a card, never touch crypto" thesis for slash).
- **Six unresolved open questions:** trusted setup ceremony quality, OpenRouter per-key tier, nullifier cache invalidation policy, session token format, withdrawal flow, and IndexedDB encryption - all blocking a credible public launch.
- **Quality guardrails absent:** no enforced type safety, no client-side proof self-verification, non-isomorphic browser/Node crypto paths.
- **The v1 RLN statement contradicts the product:** the UI promises 100 calls while `nullifier = H(secret_k, epoch)` and the linear share equation make a second distinct call in the same epoch slashable. The deployed gateway therefore rejects the second prompt as `nullifier_spent` before OpenRouter. This is a release-blocking protocol mismatch, not an acceptable rate-limit UX.
- **The v1 request path is not paper-aligned:** `share_x` is derived from random browser data rather than the canonical API request, and a commitment-linked bearer key lets the gateway associate calls with a deposit despite the stated privacy boundary.

**Affected users:** developers buying test credits, coding agents making OpenAI-compatible requests, reporters of rate-limit violations, and operators provisioning testnet deposits.

**Current situation/workarounds:** the v1 runs only on `localhost`; a public tester cannot reach it. The Mina migration (`feature-mina-protocol-migration`) is rewriting the protocol on Mina in parallel, but that is a multi-milestone effort. `stellar-launch` takes the existing, proven Stellar code to a public hosted testnet now, so the protocol is live and demonstrable while Mina matures.

## Goals & Objectives
**What do we want to achieve?**

**Primary goals:**
- Deploy the Stellar implementation to a public, hosted testnet: gateway on Render, web app on Vercel, `ZkCreditsContract` on Stellar testnet - accessible at public URLs.
- Fold in PRXVT/sdk learnings: (a) Stellar fee bump sponsorship so users and reporters never need XLM for withdraw/slash; (b) durable PostgreSQL storage replacing in-memory state; (c) full type safety; (d) client-side proof self-verification before submit; (e) isomorphic browser+Node code.
- Resolve the six v1 open questions (see Questions & Open Items).
- Preserve the paper's core protocol: users deposit once, spend distinct private ticket indices on multiple unlinkable API calls, and reveal `secret_k` only if the same ticket is forked across different requests. The launch uses the paper's fixed-cost special case (`R = 0`) rather than replacing its ticket/nullifier construction with an epoch quota.

**Secondary goals:**
- A public 5-minute demo (sign-in -> buy -> at least two real OpenRouter calls -> dashboard -> deliberate ticket-fork slash) on the hosted testnet.
- CI pipeline (GitHub Actions) for gateway + web + contract + circuits, with E2E smoke test on deploy.

**Non-goals (explicitly out of scope):**
- Mina mainnet deployment, real MINA, or any Mina work - `stellar-launch` is the Stellar track; `feature-mina-protocol-migration` is the parallel Mina track. No shared runtime, no dual-chain.
- Stellar mainnet, real USDC, real money, or a production SLA.
- A real MPC trusted-setup ceremony (single-contributor dev-only setup is retained and honestly labeled; MPC is a mainnet-phase non-goal).
- Multi-gateway cross-provider unlinkability, self-custody, network-layer anonymity (Tor/relay), per-token accurate metering, or bring-your-own-key - all deferred per the v1 roadmap.
- x402 (HTTP 402) protocol support and non-LLM paid APIs - deferred (roadmap Tier 2).
- Encrypted-mnemonic backup beyond the raw 24-word BIP-39 - deferred (future enhancement).
- Variable-cost metering, server-signed refunds, homomorphic refund accumulation/rerandomization, and dual policy staking from the full paper are deferred. Fixed price per request is explicitly the paper's simpler special case and is the launch scope.
- Multiple price tiers and top-ups are deferred. The launch has one fixed Starter denomination granting exactly 100 tickets; future top-ups must extend the ticket ceiling without reusing prior indices.

## User Stories & Use Cases
**How will users interact with the solution?**

- As a developer, I want to visit a public URL, sign in with GitHub, and buy $5 test credits with a card (Stripe test mode) so that I can try the protocol without local setup.
- As a developer, I want my browser to generate `secret_k` + commitment and back up a 24-word mnemonic so that I can recover my identity if I lose my browser storage.
- As a developer, I want to send several prompts from the browser playground and receive several real OpenRouter responses without creating a new identity or waiting for another day.
- As a coding-agent user, I want a proof-aware OpenAI-compatible client to call the public gateway so that every request carries a fresh indexed-ticket proof without using a stable identity-linked API key.
- As a developer, I want my browser to verify its own ZK proof before sending it so that I catch malformed proofs locally (and the gateway re-verifies as defense in depth).
- As a developer, I want to withdraw unused test credits to my Stellar account without acquiring XLM, via a gateway-mediated fee-sponsored withdrawal, so that the "buy with a card, never touch crypto" promise holds (with the honest caveat that the gateway must co-sign).
- As a reporter, I want to submit a slash proof on-chain without acquiring XLM, via a fee-sponsored transaction, so that the permissionless watchtower incentive works.
- As an operator, I want the gateway to survive a restart without losing accepted-call records, nullifier state, or the settlement queue, so that a public deployment is reliable.

**Key workflows:**
- Happy path: public sign-in -> buy the fixed Starter package -> send prompt 1 -> receive a real response -> send prompt 2 with the next ticket -> receive another real response.
- Call path: browser atomically reserves the next ticket index, binds the canonical request digest into the RLN share, generates + self-verifies the proof, and submits through the shared compatibility credential. Every distinct call receives a distinct proof; proof artifacts may be cached, but proofs are never reused across requests.
- Privacy path: every call proves membership in the current active fixed-denomination deposit root without exposing which commitment it owns; usage/remaining-ticket counts are computed in the browser and are never reconstructed by joining calls to a commitment.
- Attack path: the same ticket index is used for two different canonical requests -> identical ticket nullifier + different shares -> secret reveal -> permissionless, fee-sponsored slash -> 50/50 split.
- Withdrawal path: user requests withdraw via gateway -> gateway co-signs as depositor -> fee-sponsor fee-bumps -> broadcast to chosen Stellar address (gateway-mediated; user never needs XLM).
- Restart path: gateway restarts -> reconstructs spent-ticket state + accepted-call records + settlement queue from PostgreSQL -> no lost/duplicated calls.

**Edge cases:**
- Gateway restart mid-batch: durable settlement queue resumes; no double-forward or dropped call.
- Fee-relay unavailable: slash/withdraw callers get a clear 503; the inner transaction is never broadcast without a valid fee bump. Gateway unavailable: withdrawal cannot proceed (gateway-mediated; honest caveat).
- Nullifier cache stale vs. on-chain: cache is invalidated by subscribing to on-chain `NullifierSpent` events; a stale cache falls back to an on-chain read.
- Ledger closes mid-call (5s on Stellar): off-chain verify + async on-chain submit; slash protection is eventual (documented honestly).
- User loses mnemonic AND browser: unused test credits unrecoverable (documented honestly; testnet only).
- Browser crashes after reserving a ticket: that ticket is skipped rather than reused. Losing one test credit is preferable to accidental self-slashing.
- Browser recovers from the mnemonic without local ticket state: it reconstructs used indices locally from the public spent-nullifier set/events, rather than sending identity-linked candidate nullifiers to the gateway.
- Exact request retry after an ambiguous network failure: the same ticket nullifier + same `x` + same `y` is idempotent and returns the stored result/status even if Groth16 proof bytes differ; it is not treated as a slashable fork. The same ticket nullifier with a different `x` is a fork and is slashable.
- Same nullifier and `x` but a different `y` is neither a valid retry nor sufficient two-point slash evidence; reject it without forwarding and retain it as an integrity/collision alert.
- A commitment is slashed or withdrawn: the active membership root is updated and roots that still contain that commitment are revoked for spend proofs. A removed member cannot continue spending with a historical root.

## Success Criteria
**How will we know when we're done?**

- [ ] The gateway is deployed to Render and reachable at a public URL; `GET /health` returns 200.
- [ ] The web app is deployed to Vercel and reachable at a public URL; sign-in -> buy -> dashboard works end-to-end.
- [ ] The `ZkCreditsContract` is deployed to Soroban testnet; `GET /v1/contract-status` returns deposit count and roots.
- [ ] A public tester can complete the 5-minute demo: sign in -> buy the $5 fixed Starter package -> submit two different prompts from one identity -> receive two real OpenRouter responses -> see usage move `0 -> 1 -> 2` and remaining tickets `100 -> 99 -> 98` -> inspect each response's OpenRouter generation ID and redacted provider receipt.
- [ ] Each successful playground result displays the OpenRouter generation ID, resolved model/provider, token usage, upstream cost, and latency returned or subsequently fetched from OpenRouter. It links to OpenRouter Logs for operator reconciliation and labels this as operational evidence, not a public cryptographic receipt: OpenRouter's generation-metadata endpoint and account logs require the operator's bearer token.
- [ ] The browser verifies each indexed-ticket proof locally before sending it; the gateway re-verifies it and checks `share_x` against the canonical request digest before forwarding to OpenRouter.
- [ ] Ticket indices `0..99` yield distinct unlinkable nullifiers and are accepted once each. Index `100` cannot satisfy the circuit. The same proof/request retry is idempotent; the same ticket index used for a different request yields slash evidence and is rejected before upstream forwarding.
- [ ] A simulated ticket fork is slashed permissionlessly on testnet with a fee-sponsored transaction; the recovered `secret_k` matches the deposit commitment and the 50/50 treasury/reporter split is verifiable on-chain.
- [ ] Deposit, slash, and withdrawal maintain an active-membership root lifecycle: only a currently active fixed-denomination member can spend; roots containing a slashed/withdrawn commitment are not accepted for future calls.
- [ ] An unslashed user withdraws unused test credits to a chosen Stellar address via a gateway-mediated, fee-sponsored withdrawal (gateway co-signs as depositor; fee-sponsor pays the fee), without acquiring XLM.
- [ ] The gateway survives a restart with no lost accepted-call records, nullifier state, or spend-submission queue (durable PostgreSQL backing; Stellar v1 does per-call async on-chain `spend()`, not batch settlement); `scripts/e2e-test.js` passes immediately after a restart.
- [ ] Shipped code has full type safety: no `// @ts-nocheck`, no `any`-escape hatches, no disabled strict checks across gateway, web, and fee-sponsor.
- [ ] Browser and Node.js code paths are isomorphic via dependency injection / environment detection, with no `globalThis`/`window` global-pollution hacks.
- [ ] The spent-ticket nullifier set is backed by a durable table and reconciled with on-chain `NullifierSpent` events; it stores the first deterministic `(nullifier, x, y, requestDigest)` tuple needed to distinguish an idempotent retry from a slashable fork. A proof hash is retained only for diagnostics because randomized Groth16 proofs for the same witness need not have identical bytes.
- [ ] The six v1 open questions are resolved and documented (see Questions & Open Items).
- [ ] CI (GitHub Actions) runs gateway, web, contract, and circuit tests on push and runs an E2E smoke test on deploy.
- [ ] The README and web landing page document all honest caveats: testnet-only (no real money), fixed-cost 100-ticket paper specialization, variable-cost refunds deferred, single-contributor dev-only trusted setup (no production-security overclaim), custodial gateway-mediated withdrawal, asynchronous per-call on-chain audit as a testnet implementation deviation, single gateway timing-pattern visibility, browser proving latency, and IP/network identity not hidden.

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
- Browser crypto: shared canonical-request hashing plus BLS12-381-field MiMCSponge witness arithmetic, Circom WASM proving, and Groth16 self-verification.
- Fixed-cost paper specialization: one Starter deposit has `D = 100 * C_demo`, refund total `R = 0`, and private ticket index `i` is constrained to `0 <= i < 100`.
- Indexed RLN ticket statement: `a = H(secret_k, i)`, `nullifier = H(a)`, `x = H(canonical_request)`, and `y = secret_k + a * x`. The circuit proves membership and ticket bounds without revealing `secret_k`, the deposit commitment, or `i`.
- The contract stores and selects separate immutable verification keys for indexed-ticket spend, ticket-fork slash/root removal, and any membership-update statement. A proof is never verified with a key for a different circuit or public-signal layout.
- The gateway may use a shared non-user-specific compatibility bearer for OpenAI-shaped transport, but no per-user credential used on the call path may be stored with or derived from a deposit commitment. The proof is the authorization.
- Anonymous usage cannot be served by `GET /v1/status/:commitment`: the dashboard derives used/reserved/remaining tickets locally from its allocator and public spent-ticket events. The commitment status endpoint reports funding state only and is never joined to accepted calls.
- Recovery downloads a global spent-ticket snapshot containing accepted-pending and on-chain nullifiers, then compares all 100 locally derived nullifiers in the browser. It never sends candidate nullifiers or `secret_k` to the gateway and waits for pending settlement before re-enabling calls.

**Business constraints:**
- Parallel to the Mina migration; no shared runtime, no dual-chain; the two tracks ship independently.
- No real money (Stripe test mode, USDC testnet faucet).
- Public testnet audience: individual developers (not institutions).

**Assumptions (accepted):**
- OpenRouter accepts the gateway operator's upstream provider key; that secret is never exposed to users. Its provider-side tier is checked pre-launch and is distinct from the shared, non-user-specific compatibility bearer on the public gateway.
- Browser Groth16 proving (~2-5s first call) is acceptable for the public testnet audience.
- 5s Stellar ledger close is mitigated via off-chain verify + async on-chain submit; slash protection is eventual (documented honestly).
- Custodial model accepted for the testnet launch: gateway holds USDC, user holds `secret_k`. The gateway cannot make anonymous API calls (`spend()`) or unilaterally withdraw: `withdraw()` requires both the gateway depositor co-signature and a browser-secret membership-removal proof. A malicious or disappearing gateway can still block a withdrawal by withholding its signature; this availability risk is accepted for the testnet launch (no real value at risk; USDC is testnet faucet) and documented honestly. Fully permissionless user-submitted withdrawal remains a future UX upgrade.
- Stripe test-mode webhooks are reliable enough for the public testnet.
- Trusted setup is single-contributor dev-only; the public launch labels it honestly as "testnet ZK with dev-only setup" and does not overclaim "real ZK" security (v1 open question #1).
- Session token is a custom signed JWT with a `secret_k`-derived signature (v1 open question #4). It is restricted to identity-bearing dashboard and withdrawal routes and is never attached to the anonymous LLM call path.
- Withdrawal is gateway-mediated and fee-sponsored: the gateway co-signs as the on-chain depositor (the contract requires `deposit.depositor.require_auth()`); the fee-sponsor fee-bumps so the user never needs XLM (v1 open question #5).
- `secret_k` is stored in IndexedDB via WebCrypto non-extractable + 24-word BIP-39 mnemonic backup (v1 open question #6).
- Fixed-price accounting is an accepted launch specialization of the paper. The full refund/solvency state machine is deferred, not replaced with a different nullifier protocol.
- The current `H(secret_k, epoch)` circuit, random `signal_value`, commitment-linked call credential, and "second call = nullifier_spent" behavior are legacy and must not be used as launch acceptance evidence.
- The active membership root, not an API-key lookup, is the payment-status authority on the call path. Root history may be used only in a bounded in-flight grace window that is invalidated when membership is revoked.
- Idempotent response storage is privacy-bounded: no prompt body is persisted; the OpenRouter response is encrypted at rest and retained only for a short retry window, after which only the request digest, provider generation ID, and settlement status remain.
- OpenRouter generation metadata is supporting operational evidence only. The browser can see the upstream generation ID and a redacted receipt, while only the operator can authenticate to OpenRouter's generation endpoint/logs to reconcile it; the launch does not claim a signed or publicly verifiable provider receipt.

## Questions & Open Items
**What do we still need to clarify?**

### Resolved (v1 open questions + PRXVT hardening)

1. **Trusted setup ceremony (v1 OQ #1)** - Resolved: single-contributor powers-of-tau, documented prominently as dev-only; honest framing "testnet ZK with dev-only setup." MPC ceremony is a mainnet-phase non-goal.
2. **OpenRouter tier (v1 OQ #2)** - Resolved: check per-key limits pre-launch; use a sufficient tier to avoid gateway-key rate limits during public testnet load. Accepted assumption.
3. **Nullifier cache invalidation (v1 OQ #3)** - Resolved: durable PostgreSQL-backed cache, invalidated by subscribing to on-chain `NullifierSpent` events; stale cache falls back to an on-chain read.
4. **Session token format (v1 OQ #4)** - Resolved: custom signed JWT with `secret_k`-derived signature, restricted to identity-bearing dashboard/withdrawal routes and excluded from anonymous LLM calls. Accepted assumption.
5. **Withdrawal flow (v1 OQ #5)** - Resolved: gateway-mediated withdrawal to a chosen Stellar address. The browser first creates and self-verifies a membership-removal proof from `secret_k`; the gateway co-signs the resulting withdraw tx as the on-chain depositor, and the fee-sponsor fee-bumps so the user never needs XLM. Honest caveat: withdrawal is not permissionless — if the gateway disappears, it can withhold its required co-signature (testnet only).
6. **Browser IndexedDB encryption (v1 OQ #6)** - Resolved: WebCrypto non-extractable + 24-word BIP-39 mnemonic backup. Encrypted-mnemonic backup is a future enhancement.
7. **Fee sponsorship (PRXVT hardening)** - Resolved: Stellar fee bump via a dedicated fee-sponsor service with a public fee-relay; fee-only authority (fee bump doesn't alter inner tx effects; contract auth gates state).
8. **Durable storage (PRXVT hardening)** - Resolved: PostgreSQL with isolated schemas for spent-ticket/idempotency records, aggregate operational metrics, settlement queue, webhook receipts, and fee-relay idempotency. The anonymous call schema has no commitment-linked API-key record.
9. **Quality guardrails (PRXVT hardening)** - Resolved: full type safety, client-side proof self-verification, isomorphic browser+Node code - all encoded as success criteria.
10. **RLN accounting model (paper alignment)** - Resolved: fixed-cost indexed tickets following the paper's `a = H(k, i)`, `Nullifier = H(a)`, `x = H(M)`, `y = k + a*x` construction. `R = 0`, one fixed Starter denomination grants 100 tickets, and variable-cost refunds are deferred.
11. **Replay versus fork semantics** - Resolved: same nullifier + same `x` + same `y`/request digest is an idempotent retry even if proof randomness changes the proof hash; same nullifier + different `x` is a slashable ticket fork. A seen nullifier alone is not sufficient to label an event malicious.
12. **Call-path credential privacy** - Resolved: no stable commitment-linked bearer is accepted on the anonymous call path. OpenAI compatibility uses a shared transport credential or proof-aware wrapper; the ZK proof authorizes spend.

### Open items

None. The fixed-cost ticket model, paper-alignment boundary, end-user demo behavior, fee sponsorship, durable storage, privacy boundary, guardrails, trusted setup, and all v1 open questions are approved.

## Research Basis

- [ZK API Usage Credits: LLMs and Beyond](https://ethresear.ch/t/zk-api-usage-credits-llms-and-beyond/24104) - normative protocol basis for private indexed tickets, request-bound shares, solvency, and fork recovery/slashing.
- [Proposal v2](https://hackmd.io/3da7PaYmTqmNTTwqxVidRg) and [RLN protocol documentation](https://rate-limiting-nullifier.github.io/rln-docs/rln.html) - supporting rationale for RLN share/nullifier behavior.
- [Stellar CAP-0059](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0059.md) - BLS12-381 host functions used for the Stellar Groth16 realization.
- [OpenRouter generation metadata](https://openrouter.ai/docs/api/api-reference/generations/get-request-&-usage-metadata-for-a-generation) and [Logs/feedback workflow](https://openrouter.ai/docs/guides/overview/report-feedback) - authenticated provider-side reconciliation boundary for demo receipts.
