---
phase: requirements
title: "zk-api-credits: Anonymous RLN-Rate-Limited API Credits for Coding Agents"
description: Privacy gateway on Stellar between coding agents and OpenRouter; developers buy credits with a card, agents call LLMs via ZK-RLN proofs, over-quota calls slash deposits on-chain.
---

# Requirements & Problem Understanding

## Problem Statement
**What problem are we solving?**

Coding agents (Claude Code, Codex, OpenCode, Cline) call LLM APIs with API keys tied to user identity. Providers can profile codebases, correlate sessions across agents, and build usage dossiers tied to a wallet or org. Developers working on proprietary IP, M&A research, or security research have no good way to pay for LLM API access without revealing which wallet/org is calling.

**Current situation / workarounds:**
- **API keys (direct to Anthropic/OpenAI):** identity-linked, provider sees every call and can correlate sessions.
- **OpenRouter (aggregator):** convenient, 400+ models, but payments are still tied to one account; provider sees gateway's key but OpenRouter itself links all calls to the user's account.
- **LiteLLM (self-hosted gateway):** enterprises use it for internal rate-limiting, but it does not provide payment-layer privacy from upstream providers.
- **x402 / MPP Charge (per-request on-chain payments):** each call is a separate on-chain transaction, linkable by wallet address.
- **MPP Channel (deposit-then-spend):** deposit once, spend many times off-chain, settle once — but no cross-call unlinkability and no slashable rate-limit enforcement.

**Gap:** No existing solution offers (a) web2-friendly onboarding, (b) payment-layer unlinkability from the upstream LLM provider, AND (c) slashable rate-limit enforcement without identity collection. zk-api-credits covers all three by combining a custodial web2 onramp (Stripe), a privacy gateway (OpenRouter upstream), and ZK-RLN proofs verified on-chain via Stellar's native BLS12-381 (CAP-0059).

**Scope note — the protocol is API-agnostic, v1 is LLM-only by choice:**
The ZK-RLN deposit/proof/slash mechanism does not depend on what the upstream API is. The same pattern (deposit → anonymous credential → ZK-verified call → slashable rate limit) works for any paid API where the *pattern of queries* is sensitive: market data (Bloomberg, Polygon.io), on-chain analytics (Nansen, Glassnode), credit/scoring APIs, financial data (Plaid), and others. The privacy value prop actually *strengthens* for financial-sensitive APIs — a fund querying multiple providers for the same ticker leaks strategy, which is a dollar-valued leak.

v1 deliberately scopes to LLM APIs via OpenRouter because: (1) OpenRouter's universal OpenAI-compatible protocol means one integration covers 400+ models with zero per-provider work, (2) the coding-agent audience is the easiest to reach for an MVP, (3) the demo is approachable for a non-technical audience. Broader API coverage (financial, data, analytics) is captured in the roadmap (`docs/roadmap.md`) as v2–v3 scope, not v1.

## Goals & Objectives
**What do we want to achieve?**

**Primary goals:**
- Developers buy anonymous API credits with a card (web2 onboarding via Stripe + GitHub OAuth)
- Agents call LLMs via OpenRouter through a privacy gateway, with zero changes to agent UX (OpenAI-compatible base URL)
- RLN-enforced per-epoch rate limits (default 100 calls/day for demo, configurable to 1000 for prod-like)
- Over-quota double-spend slashes deposit on-chain, permissionless (anyone can submit the slash proof)
- Browser holds `secret_k`; gateway cannot link a call to a deposit (ZK enforced, contract is the verifier)

**Secondary goals:**
- 5-minute demo from sign-in to real Claude response to live slash event
- OpenAI-compatible base URL — works with Claude Code, Codex, OpenCode, Cline via env vars only
- Real OpenRouter upstream so the demo is a real product, not a mock

**Non-goals (v1, explicitly out of scope):**
- Multi-gateway cross-provider unlinkability (v2, needs network effect to matter)
- User-supplied custom API keys / bring-your-own-provider (breaks anonymity from that provider; defer to v2)
- Mainnet deployment, real USDC, real money (testnet only for v1)
- Self-custody path (v1 is custodial by necessity for web2 onboarding; self-custody is v2)
- ZK tier-eligibility proofs (volume discounts, premium tiers — separate feature, option 2 from design exploration)
- Per-token accurate metering (flat $0.001/call for demo; production needs pass-through OpenRouter pricing)
- Network-layer anonymity (Tor/client-side relay to hide IP — v2; v1 hides payment identity, not network identity)
- Browser proving optimization below 2s (v1 accepts 2-5s first-call latency, cached after)

## User Stories & Use Cases
**How will users interact with the solution?**

1. **Onboarding:** As a developer, I sign in with GitHub, buy $5 credits with a card (Stripe test mode), and my browser generates a `secret_k` + commitment. The gateway mints an on-chain USDC deposit referencing my commitment. I receive an `sk-zk-...` API key and a base URL.

2. **Per-call (cached proof):** As a developer, I set `OPENAI_BASE_URL` and `OPENAI_API_KEY` in my shell and run `claude "write a haiku"`. My browser generates a ZK proof once per session (cached after), the gateway relays it to the Soroban contract for on-chain verification, forwards my request to OpenRouter, and Claude responds. The gateway cannot link this call to my deposit.

3. **Dashboard:** As a developer, I view my dashboard showing balance, calls today (per-epoch), nullifier history read from the on-chain contract, and slash status.

4. **Slash (over-quota):** As a developer, I hammer past my 100-call/day quota. My 101st call reuses a nullifier. RLN math extracts my `secret_k` from the two nullifier shares. Anyone (the gateway, a watchtower, or another user) submits the slash proof on-chain. My deposit is slashed: 50% to protocol treasury, 50% to the reporter. My `secret_k` is burned publicly on-chain.

5. **Recovery:** As a developer who lost my browser IndexedDB, I restore my `secret_k` from the 12-word BIP-39 mnemonic I backed up during onboarding. Without the mnemonic, my unused credits are unrecoverable (honest custodial-hybrid model: gateway holds USDC, user holds the only key to claim/spend).

6. **Provider request (v2 preview, not in v1 build):** As a developer, I want to request a new API provider the gateway doesn't yet support (e.g., a financial data API), so the admin can evaluate demand and integrate it. v1 covers 400+ LLM models via OpenRouter so this workflow is deferred, but the provider adapter interface in the design makes adding providers a bounded task rather than a rewrite.

**Key workflows:**
- Happy path: sign in → buy credits → set env vars → run agent → get response
- First-call path: browser generates proof (~2-5s) → cache for session → subsequent calls fast
- Privacy path: every call's proof is unlinkable to deposit (ZK enforced by on-chain verifier)
- Attack path: over-quota → nullifier collision → secret reveal → slash
- Recovery path: lose browser → restore from mnemonic → continue

**Edge cases:**
- User loses mnemonic AND browser: unused credits unrecoverable (documented honestly)
- Ledger closes mid-call (5s on Stellar): off-chain verify + async on-chain submit means slash protection is eventual, not instant
- OpenRouter rate-limits the gateway's key: demo failure; mitigate by using OpenRouter's higher tier
- Browser proving fails (WASM load error): fallback to gateway-assisted proving with explicit "anonymity reduced" warning (v2; v1 just errors)

## Success Criteria
**How will we know when we're done?**

1. **Onboarding speed:** Sign-in → first real Claude response: < 90 seconds (excluding card entry)
2. **Cached call latency:** < 500ms gateway overhead on top of OpenRouter's response time
3. **First-call latency (with browser proving):** < 6 seconds including proof generation
4. **Slash speed:** Slash fires within 1 ledger of nullifier collision detection (~5s on Stellar)
5. **Privacy guarantee:** Gateway cannot determine which deposit funded a given call (ZK enforced, verified by inspection of gateway logs vs on-chain nullifiers)
6. **Agent compatibility:** Works with Claude Code, Codex, OpenCode, Cline via env vars only (`OPENAI_BASE_URL` + `OPENAI_API_KEY`) — zero code changes to the agent
7. **Slash economics:** 50% of slashed USDC to protocol treasury, 50% to whoever submitted the slash proof (permissionless watchtower incentive)
8. **Demo completeness:** A 5-minute live demo covers sign-in, buy, real Claude call, dashboard, and slash — all on Stellar testnet with real USDC (testnet faucet)

## Constraints & Assumptions
**What limitations do we need to work within?**

**Technical constraints:**
- Chain: Stellar testnet (`stellar:testnet`), CAP-0059 BLS12-381 host functions live (Protocol 22+)
- Smart contracts: Rust + `soroban-sdk`
- ZK circuits: Circom + snarkjs compiled with `-p bls12381` (the only toolchain that verifies on-chain today; BN254 gated on CAP-0074)
- Poseidon hash (CAP-0075) NOT live → hash entirely in-circuit; on-chain contract only stores Merkle roots and verifies proofs
- Payments: USDC testnet via Circle faucet, 7-decimal base units, trustline required on both gateway and user accounts
- Browser crypto: `@noble/hashes` for Poseidon, `ffjavascript` for field arithmetic, Circom WASM prover for Groth16
- Gateway: Node.js + Express + TypeScript, OpenAI-compatible `/v1/chat/completions` endpoint
- Web app: Next.js 14 (App Router), GitHub OAuth via next-auth, Stripe test mode for card payments
- Upstream LLM: OpenRouter only (`openrouter.ai/api/v1`) — one integration, 400+ models, 70+ providers
- Rate limit: per-epoch (UTC midnight reset), nullifier = `H(secret_k, epoch)`
- Pricing: flat $0.001/call (1 USDC base unit × 1000) for demo; not pass-through OpenRouter pricing

**Business constraints:**
- Single-developer build (solo), ~14.5 days estimated effort
- No real money in v1 (Stripe test mode, USDC testnet faucet)
- Demo audience: individual developers (not institutions — institutions want audit logs, not anonymity)

**Assumptions:**
- OpenRouter accepts the gateway's API key without per-user tracking that would defeat the privacy model
- Browser Groth16 proving (~2-5s first call) is acceptable for the demo audience
- 5s Stellar ledger close is mitigated via off-chain verify + async on-chain submit; slash protection is eventual but the demo doesn't hit this race
- Custodial model accepted for v1: gateway holds USDC, user holds `secret_k`; gateway cannot spend user's deposit without the user's proof (contract enforces)
- Stripe test mode webhooks are reliable enough for demo
- Trusted setup for Groth16 is single-contributor dev setup for MVP; documented as dev-only (production needs a real MPC ceremony)

## Questions & Open Items
**What do we still need to clarify?**

1. **Trusted setup ceremony:** Single-contributor powers-of-tau for MVP — acceptable for demo, or do we need at least a ceremonial multi-party setup to claim "real ZK"? (Assumption: single-contributor, documented as dev-only.)
2. **OpenRouter tier:** What OpenRouter tier is needed to avoid gateway-key rate limits during demo load? (Need to check their per-key limits before the demo.)
3. **Nullifier cache invalidation:** Gateway keeps an in-memory nullifier cache for fast reject before on-chain check. What's the invalidation policy — TTL, or subscribe to contract events? (Assumption: TTL + event subscription, design detail.)
4. **Session token format:** EIP-191-style (original design) vs custom signed JWT vs Stellar-native auth entry signing? (Assumption: custom signed JWT with `secret_k`-derived signature; design detail.)
5. **Withdrawal flow:** Can a user withdraw unused credits back to their Stellar account, or is it session-deplete only? (Assumption: withdraw allowed, requires `secret_k` proof; design detail.)
6. **Browser IndexedDB encryption:** `secret_k` stored in IndexedDB — encrypted with session-derived key, or WebCrypto non-extractable? (Assumption: WebCrypto non-extractable + BIP-39 mnemonic backup; design detail.)
