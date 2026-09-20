# Wayfinder map: paid private-credit pilot on Base Sepolia

Status: destination reached — hand off to implementation  
Created: 2026-09-20  
Scope: planning and design decisions only

## Destination

Produce a decision-complete, internally consistent requirements, design,
testing, and implementation plan for a paid Base Sepolia pilot. The handoff
must be safe enough to implement, narrow enough to ship quickly, and capable of
testing whether multi-agent and coding-agent operators will pay for payer and
credential unlinkability.

The pilot continuation gate is:

- three activated design partners;
- two partners completing at least 1,000 real calls;
- two partners with a two-agent deployment;
- two partners with renewal intent at the live SKU;
- p95 proving latency within each partner's accepted proving latency; and
- zero manual recoveries.

## Notes

Every session working this map should use `wayfinder`, `grilling`,
`domain-modeling`, `ai-devkit:dev-design`, and `ai-devkit:dev-planning`.

Use the [pilot domain glossary](CONTEXT.md) consistently in tickets and
lifecycle documents.

Read these evidence files before resolving a ticket:

- [Circuit and proving-system research](../../research/zk-api-credits-circuit-and-proving-system.md)
- [x402 and Base ecosystem research](../../research/x402-base-ecosystem-fit.md)
- [Product validation and scale research](../../research/product-validation-and-scale.md)
- [Current requirements](../../ai/requirements/2026-09-18-feature-base-zk-credits.md)
- [Current design](../../ai/design/2026-09-18-feature-base-zk-credits.md)
- [Current testing plan](../../ai/testing/2026-09-18-feature-base-zk-credits.md)
- [Current implementation plan](../../ai/planning/2026-09-18-feature-base-zk-credits.md)

Security facts are intentionally kept local:

- The leak is still in the repository. The root compiled artifacts
  `circuits/private_credit_spend.{r1cs,wasm,sym}` remain Circom 0.5 negative
  fixtures with 48 public inputs and zero private inputs, while the transport
  supplies only six public signals. The B3 rewrite did not remove them.
- The rejected share equation `share = secret * signal + nullifier` in those
  fixtures exposes the credential secret from one ordinary proof because
  `secret = (share - nullifier) / requestSignal`.
- The new Circom 2 compile under `circuits/build/private-credit/` is 6 outputs
  / 0 extra public inputs / 48 private inputs. That directory is gitignored,
  holds no proving key, and has no real verifier behind it yet.
- A user-selected historical timestamp can bypass bundle expiry because the
  gateway enforces only a future-skew bound.
- No generated Solidity verifier and adapter have been proven end to end.

These are release blockers. Do not run a ceremony, onboard pilot traffic, or
represent the circuit as privacy-preserving until they are closed.

## Decisions so far

- [Name the pilot destination and validation boundary](decisions/001-pilot-destination.md): run a paid Base Sepolia design-partner pilot for multi-agent and coding-agent operators, promising payer/credential unlinkability only.
- [Choose the first production proving-system direction](decisions/002-proving-system-direction.md): repair and review the construction, then retain Circom 2 plus BN254 Groth16 for v1; defer any ceremony until artifacts are frozen.
- [Define the pilot credit unit and economic safety envelope](tickets/01-credit-unit-and-economics.md): launch one 250-credit coding bundle with a versioned DeepSeek V4 Flash service class, success-only charging, bounded retries, and provider-spend caps that preserve positive contribution in the two-dispatch worst case.
- [Choose the pilot x402 interoperability posture](tickets/02-x402-interoperability.md): custom `zk-prepaid` requiring the project adapter; `amount`/`asset` name the credit asset, not the bond; no generic wallets, public facilitator, Bazaar, MCP, or `exact` rail.
- [Freeze the pilot proof and authorization boundary](tickets/03-proof-and-authorization-boundary.md): restore hidden slot-blinding shares; six-signal ABI; gateway-issued `issuedAt`; in-circuit allowance 250; paid traffic gated on review, R1CS, negative tests, real verifier, and two-transcript recovery.
- [Define pilot activation and continuation evidence](tickets/04-validation-evidence.md): twelve past-behavior interviews then at most three live-SKU partners; sidecar-local aggregates; continuation adds two-agent deployments and keeps 1,000 real calls, written renewal, and zero manual recovery.
- [Choose the pilot prover topology and operational SLOs](tickets/06-prover-topology-and-slos.md): sidecar-only Groth16 prove+self-verify; published SLO p50 ≤ 1.5s / p95 ≤ 3.0s hot prove time; proof failure is not a claim; hash-pinned local keys; no remote, browser, or helper path.
- [Review the reconciled pilot design and implementation plan](tickets/05-reconcile-pilot-docs.md): approved lifecycle set; rewrite in place; keep current proving artifacts as negative fixtures; README SKU freeze is planning B21.

## Live decision tickets

None. The destination is the decision-complete plan, and that plan is
approved. Planning B2, B3, and B4 landed 2026-09-20; current implementation
work is B5 in
[the delivery plan](../../ai/planning/2026-09-18-feature-base-zk-credits.md).

## Not yet specified

None on this map. Ceremony logistics and mainnet operating controls belong
to a later production go/no-go map if the pilot passes; they are out of
scope here.

## Out of scope

- Base mainnet deployment and production ceremony execution.
- Generic public-facilitator or Bazaar distribution for the first pilot.
- Generic x402 wallet compatibility and a standard `exact` payment rail as a
  supported product path.
- MCP transport, `/v1/responses`, and Anthropic translation as pilot
  acceptance requirements.
- Prompt confidentiality, provider blindness, network anonymity, or broad
  claims of user anonymity.
- Arbitrary providers, arbitrary models, variable-cost refund accounting, and
  unbounded token usage.
- Replacing conventional API keys for users without a demonstrated
  unlinkability requirement.
