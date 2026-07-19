# Roadmap & Expansion: zk-api-credits

> Companion to `docs/ai/{requirements,design}/2026-07-06-feature-zk-api-credits.md`.
> v1 docs cover the LLM-only MVP. This doc captures the broader protocol vision,
> provider expansion strategy, and monetization paths.

## Core insight

The ZK-RLN deposit/proof/slash mechanism is **API-agnostic**. The pattern (deposit → anonymous credential → ZK-verified call → slashable rate limit) works for any paid API where the *pattern of queries* is sensitive.

The privacy value prop **strengthens** as the query sensitivity increases:

| API type | What the provider sees today | Value of hiding it |
|---|---|---|
| LLM API (Anthropic, OpenAI) | Your codebase patterns, prompt content | Nice-to-have (hobbyist concern) |
| Market data (Bloomberg, Refinitiv, Polygon.io) | Which tickers you query, when, how often | **Worth millions to a fund** (strategy leak) |
| On-chain analytics (Chainalysis, Nansen, Glassnode) | Which addresses you're investigating | **Worth millions to a fund / LE** |
| Credit/scoring APIs | Who you're checking | High (compliance + competitive) |
| Financial data (Plaid, Yodlee) | Whose bank data you're pulling | High (PII + competitive) |

v1 starts with LLMs because OpenRouter's universal protocol makes it one integration for 400+ models. But the protocol's real moat is financial-sensitive APIs, where the privacy buyer has a dollar-valued reason to pay.

## Provider expansion — three tiers

### Tier 1: Anything on OpenRouter (zero work, instant, v1)

OpenRouter aggregates 400+ models across 70+ providers. A new LLM launching tomorrow and added to OpenRouter is available to users the same day by changing one model string (`anthropic/claude-opus-4.8` → `newprovider/newmodel`). No admin work, no integration, no code. This is why OpenRouter is the right v1 upstream — you inherit their provider catalog for free.

**Coverage:** ~95% of LLM API demand.
**Cost:** $0.
**Moat:** none (OpenRouter can do this too).

### Tier 2: Admin-curated direct integrations (v2)

For providers NOT on OpenRouter, or providers where direct relationships beat OpenRouter's margin (lower cost, lower latency, custom terms):

```
User dashboard: "Request API provider"
  → Submit: provider name, use case, expected volume
  → Admin evaluates: demand, ToS compatibility, pricing, sensitivity of query patterns
  → Admin integrates: gateway gets a direct API key, implements a new ProviderAdapter
  → User gets: anonymous access via the same ZK-RLN flow
```

**Anonymity properties:**
- From the provider: ✅ (they see the gateway's key, not the user's)
- From the gateway: ✅ (ZK-RLN still works — gateway can't link call to deposit)
- From OpenRouter: N/A (direct integration)

**Realistic v2 targets** (per-call pricing, no resale restrictions, sensitive query patterns):
- Polygon.io — market data
- Alpha Vantage — market data
- CoinGecko API — crypto data
- Etherscan / Dune — on-chain data
- Nansen / Glassnode — on-chain analytics
- Plaid — financial data (KYC tension, see below)

**NOT realistic without enterprise deals:**
- Bloomberg, Refinitiv — ToS restricts resale; need a redistribution license (enterprise sales, not MVP)

**Cost:** 1–5 days per integration. Cap at ~5–10 direct integrations before it becomes unsustainable solo.
**Moat:** strong — you're the only anonymous path to that API. OpenRouter can't undercut (they don't do privacy), and the provider won't sell anonymous access directly.

### Tier 3: Bring-your-own-key (v2, different value prop)

User pastes their own API key for a provider. The gateway still verifies ZK-RLN proofs and enforces rate limits, but the upstream call uses the user's key.

**Anonymity properties:**
- From the provider: ❌ (they see the user's key)
- From the gateway: ✅ (ZK-RLN still works on our layer)
- From the employer (if user is an employee): ✅

**Use case:** self-hosted vLLM, internal company APIs, or providers where the user IS the buyer. Different pitch — "privacy from the gateway/employer, not from the provider." Real use case but a different value prop; don't mix it into the v1 privacy-from-provider pitch.

### Tier 4: Self-serve provider onboarding (v3, the "becomes large" path)

Providers integrate themselves to reach anonymous buyers. You define the `ProviderAdapter` spec and the ZK-RLN proof format as a standard; providers implement it to access your distribution.

```
Provider dashboard: "List your API on zk-credits"
  → Provider implements the ProviderAdapter interface (or a lightweight SDK)
  → Provider sets pricing (per-call, per-tier, or subscription)
  → Users see the provider in the catalog, pay anonymously, call via gateway
  → You take a protocol fee on every call
```

**This is when the protocol becomes a platform.** You're not begging providers for access — you're a distribution channel they want into. Network effect: more providers → more users → more providers.

**Moat:** the ZK-RLN standard + the user base. Hard to replicate.
**Cost:** building the provider SDK + self-serve onboarding UI. ~2–3 months.
**Revenue:** protocol fee on every call across every provider.

## Monetization paths

### Path A: Niche privacy gateway for developers (small business, $10k–$100k MRR)

- Take rate: user pays $5, gets $4.50 of API credits, you keep 10%. OpenRouter already takes ~5%, so stacked margin is ~10–15%.
- Plus a $5–$10/month "privacy subscription" on top.
- Buyer: individual developers worried about provider profiling (proprietary code, security research, M&A). Maybe 1,000–10,000 paying users at scale.
- **Verdict:** shippable solo, makes money, doesn't "get large." A thin proxy with a privacy moat. OpenRouter could crush you by adding a "privacy mode" — but they haven't, because their buyers want audit logs, not anonymity.

### Path B: Financial-sensitive API access (mid-market, $50k–$500k MRR)

- Take rate: 10–20% on per-call pricing for financial/data APIs ($0.01–$1.00/call vs LLMs' $0.001/call).
- Buyer: hedge funds, trading desks, crypto analytics firms, security researchers. ~70 users at $1,500/month = $100k MRR.
- **Verdict:** real business, stronger moat than Path A (financial APIs can't be aggregated by OpenRouter), higher margin per call. Requires Tier 2 integrations and navigating ToS/KYC tension. This is where the protocol's value prop is strongest.

### Path C: Enterprise self-host license (B2B, $50k–$500k ACV)

- Sell the gateway software to institutions that want internal RLN rate-limiting without surveilling employees. "Run our gateway on your infra, your employees get anonymous tier access to LLM APIs, you enforce rate limits cryptographically not by tracking."
- Buyer: large engineering orgs, consultancies, government labs. Same buyer as LiteLLM Enterprise.
- **Verdict:** real money, but you pivot from product to B2B SaaS. Sales motion, not dev motion. Needs a founder who can do enterprise sales. ~10–50 customers at scale. Not an MVP outcome.

### Path D: Protocol standard (slow, hard, big if it works)

- v3+ multi-gateway: multiple gateways share one deposit pool. Users hop between gateways. Anonymity compounds because no single gateway sees the full picture.
- You define the "ZK-RLN API credits" standard, ship the reference implementation, get other gateways to adopt it.
- Monetize via: (a) hosted gateway tier, (b) protocol fee on slash claims, (c) enterprise support.
- **Verdict:** the only path that matches "protocol becomes large." Requires network effect (multiple gateways, multiple providers accepting the same proof format). 2–3 years of work. Most likely outcome is it stays a research project. Highest risk, highest ceiling.

## Evolution timeline

```
v1 (MVP, now, ~14.5 days):
  LLM APIs via OpenRouter (Tier 1)
  → proves the protocol, real users, easy demo
  → single gateway, custodial, Stellar testnet

v2a (3–6 months):
  Admin-curated financial/data APIs (Tier 2)
  → Polygon, Etherscan, Dune, Nansen, Glassnode
  → 10–20% take rate, $0.01–$1.00/call
  → privacy value prop is strong, margin is real
  → navigate ToS + KYC tension per provider

v2b (3–6 months, parallel):
  Bring-your-own-key (Tier 3)
  → self-hosted vLLM, internal APIs
  → different pitch (privacy from gateway/employer)

v3 (6–12 months):
  Self-serve provider onboarding (Tier 4)
  → providers integrate themselves to reach anonymous buyers
  → you become the "anonymous API marketplace"
  → this is where it gets large

v4 (12–24 months):
  Enterprise self-host license (Path C)
  → institutions run it internally
  → $50k–$500k ACV

v5 (24–36 months):
  Multi-gateway protocol standard (Path D)
  → cross-gateway unlinkability
  → the protocol becomes a platform
```

## What NOT to do

- **Don't build a "provider marketplace" UI in v1.** OpenRouter is your marketplace. Tier 1 covers it.
- **Don't build Tier 3 (BYO keys) in v1.** It's a different value prop and dilutes the privacy-from-provider pitch.
- **Don't pitch "we'll be the OpenRouter of privacy."** You won't out-aggregate OpenRouter. Pitch "we're the privacy layer on top of OpenRouter" (v1) and "the anonymous distribution channel for sensitive APIs" (v2+).
- **Don't pre-commit to a monetization path.** Ship v1, see who shows up. If individual developers use it → Path A. If an institution asks to self-host → Path C. If other gateways want to share the deposit pool → Path D. The MVP tells you which path is real.

## Dependencies between phases

| Phase | Depends on | Hard part |
|---|---|---|
| v1 (MVP) | nothing | browser proving latency, 5s ledger close |
| v2a (financial APIs) | v1 working | ToS navigation, KYC tension, per-provider integration work |
| v2b (BYO keys) | v1 working | different pitch, doesn't dilute v1 |
| v3 (self-serve) | v2a proving demand | provider SDK, self-serve UI, network effect cold start |
| v4 (enterprise) | v1 stable | sales motion, not dev motion |
| v5 (multi-gateway) | v3 adoption | cross-gateway proof format, shared deposit pool, governance |

## Honest assessment

v1 is a portfolio piece that proves the protocol. Path A (small dev privacy gateway) is the most likely modest business. Path B (financial APIs) is where the real money and moat are, but it requires navigating ToS and KYC — a business problem, not a tech problem. Path D (protocol standard) is the only "becomes large" path, but it's 2–3 years of work and most likely stays a research project.

The MVP's job is to figure out which path is real by seeing who shows up. Don't pre-commit.
