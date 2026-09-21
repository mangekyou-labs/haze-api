# Product validation and startup-scale research

Date: 2026-09-20  
Scope: research note only; no product docs or implementation changed

## Executive conclusion

Ship a **small paid Sepolia design-partner pilot**, not a Base mainnet product.
The strongest initial wedge is not generic Web2 API billing. It is **one funded
principal operating multiple agents where the API must not be able to correlate
which agents share a payer**. That directly matches the most important comment
in the linked Ethereum Research thread: a production x402 implementer reports
that ordinary wallet sessions are simpler and that ZK becomes essential at the
agent-to-agent funding boundary, not for ordinary user-to-server continuity
([WGlynn, post 30](https://ethresear.ch/t/zk-api-usage-credits-llms-and-beyond/24104/30)).

x402 is a credible distribution rail, but x402 adoption does **not** validate
`zk-prepaid`. The official site currently reports 75.41 million transactions,
$24.24 million volume, 94,060 buyers, and 22,000 sellers over 30 days
([x402.org](https://x402.org/)); Coinbase's Agentic.Market launch reported 165
million cumulative transactions and 480,000 agents
([Coinbase](https://www.coinbase.com/developer-platform/discover/launches/agentic-market)).
Those are first-party ecosystem counters, not independently audited product
demand, and the mainstream client path registers the `exact` or
`batch-settlement` schemes. A custom scheme works only when the client,
resource server, and facilitator all register compatible adapters; the official
server implementation explicitly rejects a scheme unsupported by its
facilitator
([x402 resource server source](https://github.com/x402-foundation/x402/blob/main/typescript/packages/core/src/server/x402ResourceServer.ts)).

There is also a concrete circuit release blocker. On this worktree, fresh local
commands on 2026-09-20 produced:

```text
$ circom --version
0.5.46

$ npx snarkjs r1cs info build/private-credit/private_credit_spend.r1cs
# of Constraints: 10621
# of Private Inputs: 0
# of Public Inputs: 48
# of Outputs: 6
```

The source describes `secret`, tier, expiry, slot, and the Merkle path as a
private witness, but the current artifact exposes all 48 inputs as public. This
invalidates the primary privacy claim. Pin a supported compiler, declare the
intended public-input list explicitly, rebuild, and make the expected public
signal count/order a CI assertion before any user pilot.

## What the original proposal does—and what this product changes

The original proposal proves Merkle membership, solvency against a deposit plus
private refunds, and an RLN share/nullifier; its variable-cost protocol issues
refund tickets after each request. It also says fixed-cost calls are a simpler
special case
([proposal](https://ethresear.ch/t/zk-api-usage-credits-llms-and-beyond/24104)).
The current design intentionally implements that special case: a tier grants a
fixed slot allowance and each call consumes one slot. That subtraction is
reasonable for an MVP, but it is not an implementation of the paper's
variable-cost/refund protocol or dual policy stake.

The current RLN-style recovery equation is internally aligned with the desired
property: reuse the same nullifier with two different request signals and the
two shares reveal the secret. Binding membership, domain, slot, time, and the
request signal is directionally correct. The proof system and constraints still
require an independent cryptographic audit; witness tests are not a soundness
review.

The largest conceptual mismatch is market positioning. The original thread
contains repeated objections that prompt/timing features can relink inference
requests and that paid access and bonded anti-spam may be separate products.
Vitalik's response is that partial unlinkability can still be valuable even if
some requests are correlated, but it may also require mixnets and local prompt
sanitization
([thread page 2](https://ethresear.ch/t/zk-api-usage-credits-llms-and-beyond/24104?page=2)).
The product docs correctly promise payment unlinkability rather than content
anonymity. Sales copy and onboarding must preserve that exact boundary.

## Ecosystem and user fit

| Segment | Fit now | What must be true |
| --- | --- | --- |
| x402 agents | Promising design-partner wedge | Ship a maintained client adapter or MCP/agent skill, because generic agents only know registered schemes. The official Bazaar MCP flow automatically handles `exact` payments, verification, and settlement; it does not imply `zk-prepaid` support ([Coinbase Bazaar MCP](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/x402-facilitator/bazaar-mcp-server)). |
| Multi-agent operators | Best privacy story | One principal can provision separate credentials to agents without exposing common funding to resource servers. Validate that this separation changes an actual deployment decision, not merely that builders find it interesting. |
| Coding-agent users | Possible, but current UX is human-first | They need noninteractive credential import, local proof generation, hard spend controls, and OpenAI/Anthropic-compatible transport. Browser backup plus GitHub login creates an activation cliff for unattended agents. Coinbase already gives agents service search/payment skills and per-call/session limits, setting the baseline UX ([Agentic Wallet skills](https://docs.cdp.coinbase.com/agentic-wallet/cli/skills/overview)). |
| Web2 API buyers | Weak initial wedge | Stripe and OpenAI-compatible APIs are familiar, but Base, ceremonies, and custom x402 are implementation details rather than user value. Test “private prepaid API key replacement” language without crypto terminology. |
| Privacy-sensitive people | Narrow but real | They must accept that the gateway/provider still sees content, timing, and network metadata. Do not target users whose requirement is prompt confidentiality or anonymity from the model provider. |
| Base ecosystem | Good settlement/distribution context | Base mainnet provides the x402/USDC/agent ecosystem, but there is no per-call chain transaction here. The Base differentiator is portable collateral/slashing and ecosystem compatibility, not lower per-call gas. |

The x402 protocol itself has meaningful developer surface: the official
repository provides TypeScript, Python, Go, MCP, HTTP, and multiple-chain
packages, and directs production users to a hosted facilitator, self-hosted
facilitator, or self-facilitation
([x402 repository](https://github.com/x402-foundation/x402)). The Linux
Foundation's x402 Foundation and members across finance, payments, and cloud
are another credible ecosystem signal
([foundation announcement](https://x402.org/linux-foundation-announces-operational-launch-of-x402-foundation-to-standardize-internet-native-payments-for-ai-agents-and-applications/)).
These signals justify interoperability work; they do not justify building all
mainnet infrastructure before customer evidence.

## Fast validation plan

### Target decision

Within four weeks, decide whether at least one narrow segment will repeatedly
pay for payer-unlinkable API calls despite proof latency, credential handling,
and loss of ordinary account-level usage history.

### Week 1: problem evidence, not solution praise

Recruit 12-15 interviews across three groups: five multi-agent/x402 builders,
five privacy-oriented API or infrastructure operators, and five coding-agent
power users. Ask for the last incident in which API keys, payer linkage,
cross-agent profiling, budget leakage, or account bans caused a concrete loss.
Request artifacts: architecture diagrams, key-distribution code, incident
notes, or procurement/security requirements. A stated preference for privacy
without a recent costly workaround is weak evidence.

Offer two explicit designs:

1. a normal x402 wallet session that is simple but linkable; and
2. `zk-prepaid`, which adds local proving and credential recovery but makes
   ordinary spends unlinkable.

Ask which one they would deploy and what latency/price premium they accept.
This comparison directly tests the alternative described in post 30 rather
than treating ZK as the default.

### Week 2: concierge design partners

Select at most three partners. Manually provision a Sepolia bundle and integrate
one real endpoint for each. The minimum product should be an OpenAI-compatible
sidecar plus a tiny agent/MCP installation path, not the full marketplace.
Observe the user installing, backing up, proving, recovering, and rotating a
credential. Record time-to-first-success and every human intervention.

Do not offer an entirely free pilot. A reversible $10-$40 Stripe charge or a
signed letter of intent with a dated paid conversion tests budget authority.
Refund the bond as designed, but separately ask what the privacy feature alone
is worth.

### Weeks 3-4: repeated-use test

Run each partner for 7-14 days with a real workload. Compare against a linkable
control path. Measure only privacy-safe aggregates:

- checkout-to-first-valid-proof conversion;
- median and p95 local proof latency by supported machine class;
- proof failure and recovery rate;
- successful calls per activated credential (aggregated, never shown as a
  user history);
- exact-retry rate and replay bytes;
- week-one return rate;
- partner willingness to renew at a stated price; and
- number of resource servers/agents integrated without founder intervention.

Recommended continuation gate: at least three activated design partners, two
running 1,000+ real calls, two willing to renew/pay, p95 proof generation below
the latency they accepted in advance, and zero manual secret recovery. A
mainnet gate should be much higher: retained paid use plus an operator who needs
portable onchain collateral now. If users choose the linkable session control,
ship that simpler product or narrow `zk-prepaid` to multi-agent isolation.

## Startup-scale constraints and tests

The following estimates are inferences from the current design, not measured
production results.

### Proof path

Every request is bound to its exact body, nonce, requirements, response key,
domain, and timestamp, so a full proof cannot be stockpiled before the request
exists. Client proving latency therefore sits directly on every call's critical
path. The current test suite only builds witnesses; there is no proving key in
the repository and thus no end-to-end browser proof benchmark. The fresh full
circuit test took 4.87 seconds on this development machine, but that includes
compilation and multiple valid/invalid witness calculations and is **not** a
per-proof number.

Before choosing capacity or a proof stack, benchmark the production circuit on
the minimum supported laptop and phone-class browser for: witness generation,
proof generation, local self-verification, peak memory, proof bytes, gateway
verification, and 1/10/50 concurrent requests. Publish p50/p95 rather than a
single developer-laptop result. Keep proving client-side; a hosted prover would
receive the private witness and defeat the product claim unless it is a
separately designed private delegation system.

### Nullifier/claim store

One committed call creates at least one uniqueness-checked claim row. At 1,
10, and 100 sustained requests/second, that is approximately 2.59 million,
25.9 million, and 259 million rows per 30 days. PostgreSQL unique constraints
use unique B-tree indexes
([PostgreSQL](https://www.postgresql.org/docs/16/indexes-unique.html)), which is
the right atomic primitive for double-spend prevention, but the working index
must be load-tested at the intended write rate. Partitioning can make retention
deletion and active-index locality cheaper, but global uniqueness across time
partitions is constrained because a partitioned unique key must include the
partition key
([PostgreSQL partitioning](https://www.postgresql.org/docs/18/ddl-partitioning.html)).

Practical MVP: one authoritative, compact nullifier uniqueness table for every
still-valid bundle plus separate time-partitioned replay/evidence metadata.
Expire claim rows only after the bundle expiry and challenge window. Benchmark
atomic reserve/commit/conflict transactions with skewed concurrent retries;
average insert throughput is less important than p99 contention and recovery
after an ambiguous commit.

### Encrypted replay

The 24-hour guarantee and 10 MiB response cap can dominate storage. Per one
sustained request/second, one day of ciphertext is about 8.2 GiB at a 100 KiB
average response, 84.4 GiB at 1 MiB, and 843.8 GiB at the cap. Ten requests per
second is ten times those values. Do not place response ciphertext in the hot
claim table. Store it in encrypted object storage under a random locator, keep
only the locator/digest/expiry in the atomic commit record, enforce a much
smaller default response limit, and delete by lifecycle rule after 24 hours.
Validate that object publication and claim commit cannot produce a paid response
that is neither retrievable nor safely reconciled.

### Slashing and revocation enumeration

The append-only historical-root choice means a slashed credential's old proof
remains mathematically valid. The design compensates by deriving and inserting
up to 75,000 remaining nullifiers before advancing the finalized event cursor.
That is bounded, but one slash can amplify one chain event into 75,000 hashes
and database writes; a burst of slashes can stall all later event processing.

Before launch, measure Poseidon derivation plus idempotent bulk insertion for a
75,000-slot credential and for 10 simultaneous slashes. Separate the canonical
chain cursor from revocation job progress while still failing closed for the
affected root/credential domain; otherwise one poison job blocks unrelated
funding and maturity events. If the worst case misses the accepted revocation
SLO, reduce launch allowances substantially or redesign root lifecycle so
revoked bundles cannot continue proving against indefinitely valid roots.

### Event synchronization

Base exposes unsafe, safe, and finalized heads; its derivation pipeline handles
L1 reorgs, and L1 finality is roughly 6.4 minutes per epoch under normal
conditions
([Base derivation spec](https://docs.base.org/base-chain/specs/protocol/consensus/derivation)).
Funding must define exactly which head makes a root spendable, while slashing
must define how quickly it becomes rejecting. Persist block number **and hash**,
rewind on mismatch, use redundant RPCs, and prove a rebuild from deployment
history. Never advance a cursor merely because an event was queued; advance
only when its security effect is durable or the gateway is explicitly failing
closed.

## Stripe economics

The requirement's listed service fee and refundable bond imply checkout totals
of $10, $40, and $100. Under Stripe's current US standard domestic-card price
of 2.9% + $0.30, the processing fees are approximately $0.59, $1.46, and $3.20
([Stripe pricing](https://stripe.com/pricing)). Stripe states that original
processing fees are not returned on refunds
([Stripe refund fees](https://support.stripe.com/questions/understanding-fees-for-refunded-payments?locale=en-GB)).

| Tier | Checkout | Bond later refunded | Stripe fee | Service fee left before API, Base, support, and fraud costs |
| --- | ---: | ---: | ---: | ---: |
| starter | $10 | $5 | $0.59 | $4.41 |
| team | $40 | $20 | $1.46 | $18.54 |
| scale | $100 | $50 | $3.20 | $46.80 |

This is workable only if the call allowances are not literal expensive LLM
calls. The starter's $5 service fee across 5,000 calls leaves about $0.000882
per call after Stripe and before provider cost; the scale tier leaves about
$0.000624 per call. OpenRouter model cost must be capped or billed separately.
Calling these bundles “one API call” across arbitrary chat models creates
unbounded gross-margin risk.

Stripe currently lists a $15 fee for each card dispute, plus another $15 when a
dispute is manually countered (returned when won)
([Stripe pricing](https://stripe.com/pricing)). One lost starter dispute
therefore erases several good starter sales, aside from the disputed principal.
Model refund, dispute, fraud, Base gas, RPC, object storage, and provider spend
per tier before opening checkout. Consider ACH or larger minimum purchases for
high-volume customers, but validate conversion before adding payment methods.

## Comparison with the current docs

### What is strong

- The requirements explicitly restrict the release to Base Sepolia and put
  audit, ceremony, key protection, and recovery ahead of mainnet.
- The design correctly separates the spend plane from account/order identity,
  avoids a per-call chain transaction, defines exact-retry semantics, and
  states that content and timing remain visible.
- Self-hosting the custom facilitator and requiring explicit scheme adapter
  registration matches the official x402 architecture.
- The fixed-cost slot model is the right scope reduction for a pilot.

### Gaps to feed back into design/planning

1. **Circuit privacy gate:** pin the compiler/toolchain, fix the public/private
   interface, assert six public signals and their exact order, and regenerate
   every artifact.
2. **Market milestone before mainnet engineering:** add a design-partner
   milestone with paid/renewal gates ahead of ceremony, audit, or mainnet work.
3. **Agent-native activation:** add an MCP/coding-agent installation and
   credential-provisioning scenario. GitHub OAuth and browser backup alone do
   not validate autonomous x402 usage.
4. **Cost-safe API contract:** bound models, input/output tokens, and provider
   spend per credit, or sell model-specific/price-class credits. The current
   call allowances are economically incompatible with unrestricted LLM calls.
5. **Measured capacity gates:** add browser proving, gateway verification,
   nullifier contention, replay storage, 75,000-nullifier revocation, reorg
   rebuild, and ambiguous-commit benchmarks with numeric SLOs.
6. **Operational decoupling:** do not let revocation enumeration, object replay,
   or one failed event job block the complete chain cursor without an explicit
   fail-closed mode.
7. **Privacy claim wording:** sell payer/credential unlinkability, not anonymous
   prompts or confidential inference.

## Recommended shipping order

1. Fix and independently review the circuit interface before exposing any
   credential, even on Sepolia.
2. Build one polished OpenAI-compatible sidecar plus one agent/MCP adapter.
3. Run the three-partner paid Sepolia pilot and the linkable-session control.
4. Measure proof and data-plane capacity with the real production-shaped
   circuit and provider payload limits.
5. Decide whether the winning product is private multi-agent funding,
   privacy-focused API access, or the simpler linkable x402 session.
6. Only then fund an audit, select production proving/ceremony technology, and
   design the mainnet trust-minimized refund path.

