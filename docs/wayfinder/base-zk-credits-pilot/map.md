# Wayfinder map: Base ZK Credits founder and external pilot

Status: revised cohort — map and ticket updates published to GitHub
Created: 2026-09-20
Amended: 2026-09-29
Scope: simplify first use, run a founder x402 demo, and validate two external operators over 14 UTC days

## Destination

Make first use practical for Web2 developers: the founder prepares an invite,
Codex receives one instruction, and the target is five minutes of human action
through the first counted call. Downloads, installs, proof generation, and
provider response wait are measured separately from active human time.

The revised cohort is three serialized slots:

| Slot | Operator | Path | Counts as |
| --- | --- | --- | --- |
| A | External Codex developer | Codex through the local sidecar | Technical activation and market validation |
| B | Founder | Founder x402 agent with the project adapter | Technical activation only |
| C | External x402 operator | Their own agent with the project adapter | Technical activation and market validation |

Pay each external operator a fixed **$25 research honorarium for a 30-minute
session**, whether setup succeeds or fails. Record product willingness to pay
separately. The honorarium never counts as product revenue or payment intent.

Slot A's qualifying activation starts the 14-day UTC validation window. Run
fresh slot B after A qualifies, then C. Continue only if **both A and C** make a
real call on another calendar day and show credible payment intent before the
window ends. B is a technical signal and does not count toward either market
threshold. A longer than five-minute setup is a friction finding, not a reason
to reject a valid protocol exchange.

## User stories

### Pilot stories

#### Codex developer's first call

As an external developer who has not used zk-credits, I receive repository
access and a prepared invite, give Codex one setup instruction, complete only
GitHub sign-in, passwordless recovery-file download and reimport, consent, and my own task, then make
one real call. Codex checks `gh` authentication, installs the pinned release,
verifies the packaged hash-pinned proving bundle, and runs local
setup. I can tell what the provider sees and what the project records.

#### x402 operator's own agent loop

As an x402 operator, I register the versioned request-aware `zk-prepaid`
adapter in my own agent, retain my credential and proof generation locally,
and make a real task call through the same supported challenge and settlement
flow. The founder can run the same adapter path with a small task-running
starter agent.

#### Historical paid-pilot stories

The original paid stories remain the later production destination, not
acceptance criteria for this research cohort:

1. As a multi-agent or split-key coding-agent operator, I can pay the live SKU,
   install the sidecar locally, and make real calls whose payment proofs do not
   identify me or my other credentials.
2. As that operator, I can retry an exact committed request and receive its
   stored replay without spending a second credit.
3. As a reporter, I can submit two valid conflicting transcripts and slash
   the bond 50/50 without a live 402.
4. As the map owner, I can stop continuation toward production if any
   destination line is missed, without qualitative override.

## Product and privacy contract

- The paid user stories above remain historical context. This cohort is
  invite-only and uses founder-provisioned Base Sepolia credits.
- The project has a narrow Codex Responses bridge on the local sidecar. It
  translates the supported Codex text/function-tool request shape into the
  existing fixed Chat Completions service class and converts the committed
  result back to Responses events. It is not a generic Responses gateway.
- For valid spends, the payment proof is designed for payer and credential
  unlinkability. The model provider still receives the request. Do not claim
  prompt confidentiality, provider blindness, network anonymity, or broad
  user anonymity.
- The circuit is experimental and not independently audited. Generic,
  unmodified x402 agents are unsupported; an agent must deliberately register
  the project `zk-prepaid` adapter.
- Both onboarding paths use the same authenticated local aggregate snapshots
  and redacted activation evidence. Evidence contains no prompts, responses,
  credentials, proofs, nullifiers, request signals, or identity-to-spend join.
- Every counted call requires one discarded warm-up and one counted custom
  `zk-prepaid` exchange with local proof and self-check,
  `PAYMENT-SIGNATURE`, facilitator settlement, `PAYMENT-RESPONSE`, and a
  two-claim aggregate gateway delta.

## Existing work and source issues

- [Pilot map #25](https://github.com/mangekyou-labs/haze-api/issues/25) now
  contains this destination, stories, boundaries, and ticket plan.
- [B8 x402 and sidecar integration #11](https://github.com/mangekyou-labs/haze-api/issues/11)
  is the integration source for the request-aware adapter and first-call path.
- [B9 onboarding #12](https://github.com/mangekyou-labs/haze-api/issues/12)
  is the source for invite redemption, credential recovery, and local setup.
- [B23 serialized activations #27](https://github.com/mangekyou-labs/haze-api/issues/27)
  now defines A/B/C, the serialized qualification sequence, and slot evidence.
- [B13 readout #16](https://github.com/mangekyou-labs/haze-api/issues/16)
  now defines the 14-day UTC window and external-only market criteria.
- The original paid-pilot destination, thresholds, and decision files remain
  historical context. The 2026-09-28 internal Base Sepolia trial remains an
  uncounted technical rehearsal; see
  [internal trial evidence](../../evidence/base-sepolia-internal-trial.md).

The existing code already supports request-aware `zk-prepaid` payload creation
through the local proof engine and a bounded Codex Responses bridge on the
loopback sidecar. Generic Responses gateway support is outside scope.

## Ticket plan

The nine new tickets and two amendments are published in GitHub; local body
snapshots are in the issue-drafts directory. Each body links to its applicable
story and the relevant B9 onboarding #12 and/or B8 integration #11 source.
New tickets and B23 #27 are children of #25; the blocking edges are recorded
below.

| # | Ticket | Blocked by | Label |
| --- | --- | --- | --- |
| 1 — [#29](https://github.com/mangekyou-labs/haze-api/issues/29) | Codex first use | — | `ready-for-agent` |
| 2 — [#30](https://github.com/mangekyou-labs/haze-api/issues/30) | x402 agent first use | — | `ready-for-agent` |
| 3 — [#31](https://github.com/mangekyou-labs/haze-api/issues/31) | Founder-aware evidence | — | `ready-for-agent` |
| 4 — [#32](https://github.com/mangekyou-labs/haze-api/issues/32) | Release and launch preparation | #29, #30, #31 | closed |
| 5 — [#33](https://github.com/mangekyou-labs/haze-api/issues/33) | Founder demo kit and wizard | #30, #31 | `ready-for-agent` |
| 6 — [#34](https://github.com/mangekyou-labs/haze-api/issues/34) | Recruit A and C | — | `ready-for-human` |
| 7 — [#35](https://github.com/mangekyou-labs/haze-api/issues/35) | Prepare founder grant demo | #33 | `ready-for-human` |
| 8 — [#36](https://github.com/mangekyou-labs/haze-api/issues/36) | Authorize release and hosted pilot | #32, #35 | `ready-for-human` |
| 9 — [#27](https://github.com/mangekyou-labs/haze-api/issues/27) | B23 serialized activations | #34, #36 | `ready-for-human` |
| 10 — [#37](https://github.com/mangekyou-labs/haze-api/issues/37) | External follow-up | A checkpoint in #27 | `ready-for-human` |
| 11 — [#16](https://github.com/mangekyou-labs/haze-api/issues/16) | B13 readout | #27, #37, completed 14-day window | `ready-for-human` |

## Grant target correction (2026-09-30)

The founder's funding target is a **$5,000 Base Builder Grant**. Prepare
materials through
[Run the uncounted founder demo and prepare truthful funding materials](https://github.com/mangekyou-labs/haze-api/issues/35).
The [founder demo guide](../../onboarding/base-zk-credits-founder-demo.md#safe-recording-and-funding-fit)
holds the application link and dated round-status check. Confirm the current
Builder Grant round and prototype eligibility before submission; the target
amount is not a verified award. Ecosystem Fund investment and Base Batches
are outside this effort's funding scope.

The demo runs before external launch and is **uncounted**. Slot B is a fresh,
separately measured x402 run after A qualifies; it is not the grant demo.

## Runway and decisions

- Founder launch wizard keeps its secret, hosted-service, deployment, cap,
  readiness, and release checks.
- Operator wizard is limited to consent and local recovery, agent-led setup,
  one throwaway warm-up, one own-agent call, and redacted evidence review.
- Install the pinned release with its packaged proving bundle. The human signs
  in, saves and reimports the passwordless recovery capsule, gives consent, and
  chooses the task. Activated credentials enter OS secure storage. Base Sepolia
  uses the launch RPC baked into the reviewed package by default; local overrides
  remain available when needed.
- Prepare and review a version-matched package candidate, then verify clean
  registry installs before invitations. Publishing and hosted launch remain
  behind the founder authorization ticket.
- Measure active human setup time and assistance. Keep model/provider wait and
  unattended machine work separate.
- Store external market interview evidence separately from product activation
  evidence; do not add participant identity to the spend plane or join the two
  datasets.

## Out of scope

- Mainnet, paid product checkout, paid production traffic, or an independent
  cryptographer review as a prerequisite to this experimental testnet cohort.
- Generic x402 compatibility, standard `exact` payment, public facilitators,
  Bazaar, MCP, Anthropic requests, or a generic Responses gateway endpoint.
- Provider blindness or request confidentiality. The model provider receives
  the request as part of inference.
- Treating the $25 research honorarium as revenue or willingness to pay.

## Decisions so far

- [x402 operator first use: own agent and request-aware adapter](https://github.com/mangekyou-labs/haze-api/issues/30): passwordless OS-store launch, fresh package install, real Base Sepolia exchange, authenticated aggregate metrics, and generic-client rejection validated. See [technical evidence](../../evidence/issue-30-x402-passwordless-validation.md).

- [Founder x402 demo kit and safe recording wizard](https://github.com/mangekyou-labs/haze-api/issues/33): reviewed-candidate walkthrough and bounded internal records keep the demo separate from fresh post-A slot B; official investment-route check is linked in the ticket resolution.

## Delegated Codex acceptance (2026-09-30)

The owner authorized a delegated agent operator to complete issue 29 technical
acceptance while the participant is unavailable. Human consent interviews,
self-chosen human tasks and active-human setup timing are not gates for that
implementation ticket. Record these as unmeasured, not successful. Independent
A/C adoption, payment intent and the 14-day cohort remain in their pilot tickets;
this delegated run does not start that window.

Issue 29's website-to-Codex technical journey is validated. Passwordless recovery,
OS-store restart, packaged proving artifacts, witness/root checks and committed
Codex requests passed. Prepared 0.2.10 also passed using the baked launch RPC;
fresh-state credential reuse required four claim-conflict recoveries. See
[technical evidence](../../evidence/issue-29-live-browser-onboarding.md) and
[owner publication handoff](../../releases/zk-credits-0.2.10.md). Publication is
separate from implementation completion and remains with the owner.

Release and launch preparation: [reviewed published candidate verification](../../evidence/issue-32-release-verification.md) records immutable 0.2.10/0.1.0 pins, fresh registry checks, current hosted readiness and caps, the resolved proof-test regression, and the isolated clean/pushed review preflight. Founder authorization remains in the separate authorization ticket.
