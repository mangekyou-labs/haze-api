# Wayfinder map: invite-only unpaid x402-agent pilot on Base Sepolia

Status: strategy amended — hand off to implementation
Created: 2026-09-20
Amended: 2026-09-20
Scope: unpaid pilot launch and two-week market validation; paid production work is deferred

## Destination

Ship an invite-only, unpaid, experimental Base Sepolia pilot to three real
coding-agent or multi-agent operators, including adapter-enabled x402 agents,
then make an explicit market-validation decision after two weeks.

The launch must preserve the custom x402 v2 `zk-prepaid` scheme and existing
wire format, sidecar-local hash-pinned proving and self-verification, the
self-hosted facilitator and isolated claim store, and the narrow promise of
payer/credential unlinkability for ordinary valid spends. Every counted real
call must complete the actual challenge, local proof, `PAYMENT-SIGNATURE`,
facilitator settlement, and `PAYMENT-RESPONSE` exchange.

The first cohort is three **unpaid pilot participants**:

- at least one coding-agent operator using the OpenAI-compatible sidecar;
- at least one **adapter-enabled x402 agent** deliberately registering the
  project `zk-prepaid` adapter; and
- a third participant using either supported path.

Start the two-week clock when the first participant is activated. Continue
only if at least two participants return with a real call on another calendar
day and at least two show **credible payment intent**. Otherwise record an
explicit iterate-or-stop decision and the dominant failure: demand,
onboarding, x402 compatibility, proving latency, reliability, or pricing.

## Notes

This is an amendment to the resolved paid-pilot decision record. The original
paid destination, continuation thresholds, and resolved decision files remain
historical context; this amendment changes the first cohort and validation
loop without weakening the technical correctness boundary.

Every session working this map should use `wayfinder`, `domain-modeling`, and
the repository's implementation and verification guidance. Use the [pilot
domain glossary](CONTEXT.md) consistently in tickets and lifecycle documents.

Preserve these product and protocol boundaries:

- custom x402 v2 `zk-prepaid`, `/v1/chat/completions`, scheme-based acceptance
  selection, `/supported`, `PAYMENT-SIGNATURE`, and `PAYMENT-RESPONSE`;
- project sidecar/SDK and agents that deliberately register the project
  adapter, not generic unmodified x402 agents;
- local, hash-pinned proving and self-verification inside the operator's
  sidecar;
- a self-hosted facilitator and isolated claim store;
- no generic x402 wallet claim, generic-agent claim, public facilitator,
  Bazaar, MCP, or standard `exact` rail claim; and
- no prompts, responses, secrets, proofs, nullifiers, request signals, or
  payer/spend-plane joins in pilot telemetry.

The independent cryptographer review is a paid-traffic gate, not an unpaid
pilot prerequisite. Cryptographic correctness remains mandatory: corrected
artifacts, pinned hashes, a real Solidity verifier and adapter on Base
Sepolia, timestamp-bound authorization tests, negative cases, and
two-transcript recovery must pass before inviting participants.

Read the existing evidence and lifecycle documents before changing protocol
or release behavior:

- [Circuit and proving-system research](../../research/zk-api-credits-circuit-and-proving-system.md)
- [x402 and Base ecosystem research](../../research/x402-base-ecosystem-fit.md)
- [Product validation and scale research](../../research/product-validation-and-scale.md)
- [Current requirements](../../ai/requirements/2026-09-18-feature-base-zk-credits.md)
- [Current design](../../ai/design/2026-09-18-feature-base-zk-credits.md)
- [Current testing plan](../../ai/testing/2026-09-18-feature-base-zk-credits.md)
- [Current implementation plan](../../ai/planning/2026-09-18-feature-base-zk-credits.md)

Security facts remain intentionally local. The root compiled artifacts are
still negative Circom 0.5 fixtures with the rejected share equation; the new
Circom 2 compile is not yet a shippable verifier path; historical timestamps
must not bypass expiry; and no generated Solidity verifier and adapter have
been proven end to end. These are pilot correctness blockers. Do not activate
participants or call the circuit privacy-preserving until they are closed.

## Strategy amendment

The original map selected a paid design-partner pilot. The fast-shipping route
now makes the first cohort unpaid and invite-only:

- founder-provisioned test credits replace real checkout; GitHub sign-in,
  credential backup, and Base Sepolia status remain in onboarding;
- Stripe lifecycle work, refunds, disputes, paid checkout, independent
  cryptographer review, and formal benchmarks remain open but are labeled
  `deferred:post-validation` and detached from this active map;
- the pilot validates behavior in two weeks rather than waiting for twelve
  interviews, 1,000-call thresholds, two-agent deployment thresholds, or
  renewal thresholds;
- the validation ledger records onboarding time, client type, adapter
  failures, proving latency, proof failures, founder assistance, repeated
  usage, objections, returns, and credible payment intent; and
- the product copy must say invite-only, unpaid, experimental, Base Sepolia,
  and limited to custom-adapter x402 agents. It must not claim generic x402
  compatibility, production readiness, or audited privacy.

## Decisions so far

The links below are the resolved paid-pilot decision files and tickets. They
are preserved as historical context; this amendment supersedes only their
paid cohort and market-validation thresholds.

- [Name the pilot destination and validation boundary](decisions/001-pilot-destination.md): the historical paid Base Sepolia design-partner destination and its payer/credential unlinkability boundary.
- [Choose the first production proving-system direction](decisions/002-proving-system-direction.md): retain Circom 2 plus BN254 Groth16 for v1 and defer ceremony until artifacts are frozen.
- [Define the pilot credit unit and economic safety envelope](tickets/01-credit-unit-and-economics.md): the bounded service-class and success-only claim semantics retained for the unpaid pilot's test credits.
- [Choose the pilot x402 interoperability posture](tickets/02-x402-interoperability.md): custom `zk-prepaid` requiring the project adapter; `amount`/`asset` name the credit asset, not the bond.
- [Freeze the pilot proof and authorization boundary](tickets/03-proof-and-authorization-boundary.md): hidden slot-blinding shares, six-signal ABI, gateway-issued `issuedAt`, and the correctness evidence retained; the independent review is deferred for this cohort.
- [Define pilot activation and continuation evidence](tickets/04-validation-evidence.md): the historical paid-partner funnel and thresholds retained for later comparison, not an unpaid-pilot gate.
- [Choose the pilot prover topology and operational SLOs](tickets/06-prover-topology-and-slos.md): sidecar-only Groth16 prove+self-verify, hash-pinned local keys, and no remote, browser, or helper path.
- [Review the reconciled pilot design and implementation plan](tickets/05-reconcile-pilot-docs.md): the approved lifecycle set and negative-fixture rule remain the implementation baseline.
- [Separate the invite control plane from detached funding provisioning](decisions/003-detached-funding-provisioning.md): single-use hashed invites bound to a GitHub account in `control_plane`, detached 30-minute funding capabilities bound to one commitment in `pilot_provisioning`, no foreign key and no durable join, and a two-stage version-2 export where the recovery capsule is re-imported before funding and only then wrapped with the gateway's authoritative activation metadata.
- [Freeze the active pilot copy to the truthful unpaid contract](https://github.com/mangekyou-labs/haze-api/issues/24): invite-only, unpaid, experimental, Base Sepolia; the project sidecar or an x402-native agent registering the custom `zk-prepaid` adapter only; founder-provisioned test credits; the pilot telemetry and provider-observation boundary; and no commerce terms on any active surface.

## Active execution frontier

The active GitHub child issues are:

- [B6 — Isolated claim store, facilitator, gateway reservation lifecycle](https://github.com/mangekyou-labs/haze-api/issues/9) — closed and unchanged.
- [B8 — Sidecar proving and OpenAI-compatible request path](https://github.com/mangekyou-labs/haze-api/issues/11) — adds the adapter-enabled x402-agent exchange.
- [B9 — Invite-only unpaid onboarding](https://github.com/mangekyou-labs/haze-api/issues/12) — implemented 2026-09-20: invite/capability planes, founder CLI, detached funding endpoints, five-step web onboarding, two-stage export, and the removal of checkout, orders, Stripe webhooks, and wallet linking from the pilot runtime.
- [B11 — Pilot correctness and release verification](https://github.com/mangekyou-labs/haze-api/issues/14) — resolved 2026-09-21 at `b5ad4c0`: the verifier (`0xC66CC4866f945Ce39c207729CF136fd03d58207E`) and the adapter (`0xD3FED81c5Aa3D1c976448cAaDAa66832E7F5BCDD`) are deployed and BaseScan-verified on Base Sepolia, and the fixture transcript verifies onchain — see [Base Sepolia B11 evidence](../../ai/testing/2026-09-18-feature-base-zk-credits.md#base-sepolia-b11-evidence-2026-09-21). The independent review and paid traffic remain B12.
- [B21 — Invite-only unpaid pilot copy freeze](https://github.com/mangekyou-labs/haze-api/issues/24) — resolved 2026-09-21: root README, installation guides, landing metadata and page, footer, sign-in, onboarding, dashboard, and recovery are frozen to the invite-only unpaid pilot contract, with a copy-contract test and landing Playwright spec enforcing it — see [B21 copy-freeze evidence](../../ai/testing/2026-09-18-feature-base-zk-credits.md#local-b21-evidence-2026-09-21). B22's copy dependency is clear.
- [B22 — Invite-only unpaid x402-agent pilot launch](https://github.com/mangekyou-labs/haze-api/issues/26) — blocked only by B11 and B21.
- [B13 — Two-week x402-agent market-validation readout](https://github.com/mangekyou-labs/haze-api/issues/16) — blocked only by B22.

## Not yet specified

Post-validation pricing, paid conversion, independent review, formal
benchmarks, and any mainnet or ceremony decision depend on the two-week
readout. Do not split those questions into active tickets before the pilot
produces evidence.

## Deferred post-validation

These remain open for later work and do not block the unpaid pilot:

- Stripe sponsorship, refunds, disputes, and paid checkout ([B7](https://github.com/mangekyou-labs/haze-api/issues/10)).
- Full Stellar/evaluation archival ([B10](https://github.com/mangekyou-labs/haze-api/issues/13)).
- Independent cryptographer review and paid-traffic approval ([B12](https://github.com/mangekyou-labs/haze-api/issues/15)).
- Formal [B14 unit-economics](https://github.com/mangekyou-labs/haze-api/issues/17),
  [B15 load](https://github.com/mangekyou-labs/haze-api/issues/18),
  [B16 proof-latency](https://github.com/mangekyou-labs/haze-api/issues/19),
  [B17 storage-growth](https://github.com/mangekyou-labs/haze-api/issues/20),
  [B18 claim-store](https://github.com/mangekyou-labs/haze-api/issues/21),
  [B19 event-cursor/slash-revocation](https://github.com/mangekyou-labs/haze-api/issues/22),
  and [B20 slashing-path](https://github.com/mangekyou-labs/haze-api/issues/23)
  benchmarks.

## Out of scope

- Base mainnet deployment and production ceremony execution.
- Generic x402 compatibility, public facilitators, Bazaar, MCP,
  `/v1/responses`, Anthropic translation, and a standard `exact` rail.
- Prompt confidentiality, provider blindness, network anonymity, or broad
  claims of user anonymity.
- Paid traffic or production readiness before a later paid-traffic gate.
- Arbitrary providers, arbitrary models, variable-cost refund accounting, and
  unbounded token usage.
