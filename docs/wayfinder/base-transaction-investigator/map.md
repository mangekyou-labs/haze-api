# Base transaction investigator: useful x402 workflow and concise developer README

Canonical map: [Base transaction investigator: useful x402 workflow and concise developer README](https://github.com/mangekyou-labs/haze-api/issues/39).

## Destination

Define an implementation-ready Base transaction investigator: it diagnoses a failed transaction, purchases execution evidence through standard x402 when needed, uses the existing private prepaid LLM API, and returns a report grounded in that evidence. Define a concise developer README that gets a developer to a useful first task with minimal reading.

## Notes

- Recording priority on 2026-10-07: preserve the simpler coding-agent grant demo and public sandbox onboarding in [Run the uncounted founder demo and prepare truthful funding materials](https://github.com/mangekyou-labs/haze-api/issues/35). The investigator remains an optional follow-up; its live paid diagnosis passed on 2026-10-08 and is not a prerequisite for the coding recording.

- Planning is resolved. Reviewed offline implementation is integrated locally; the founder command and separate live/recording gates are tracked below. Deployment and publication remain separate.
- Owner selected paid execution data plus prepaid inference on 2026-10-07. The current prompt-and-answer starter is a transport demonstration, not this investigator.
- Preserve the existing `zk-prepaid` inference boundary. Standard `exact` USDC payments for execution data are a separate proposed integration. Track the two budgets separately; an inference credit is not a USDC amount.
- Investigation coverage, payment rehearsal, and provisional provider selection are governed by [Choose the transaction diagnosis and evidence contract](https://github.com/mangekyou-labs/haze-api/issues/42#issuecomment-6032969772). Provider live-delivery verification remains an acceptance gate.
- The README should be roughly 60–90 lines: purpose, prerequisites, working quick start, useful example, essential compatibility/privacy limits, and links to deeper docs. Omit A/B/C testing, compensation, recruitment, and activation procedures. Describe available features separately from this proposed workflow.
- Each session reads the context map and relevant glossary. Use grilling and domain-modeling for human decisions, research for primary-source investigations, and prototype for the README/task walkthrough.
- Related historical effort: [Base ZK Credits pilot: founder x402 demo and two external operators](https://github.com/mangekyou-labs/haze-api/issues/25). Its recruitment and validation process is not part of this developer-facing effort.
- Canonical artifact: this GitHub issue. Child issues and native blocking relationships define the frontier. Research assets live on separate `research/` branches, with pointers in their resolution comments.

## Decisions so far

<!-- Closed decision tickets are indexed here; their resolution comments hold the detail. -->

- [Find a useful x402 execution-data source for Base transactions](https://github.com/mangekyou-labs/haze-api/issues/40#issuecomment-6031701893): Alchemy quotes a trace request but delivery is unverified; no verified Base Sepolia payment provider was established.

- [Establish the dual-payment and inference integration constraints](https://github.com/mangekyou-labs/haze-api/issues/41#issuecomment-6031683427): Reuse tool-capable prepaid inference; add separate exact-payment authorization, task budgets, and scheme-specific recovery.

- [Choose purchase limits and recovery for the investigator](https://github.com/mangekyou-labs/haze-api/issues/43#issuecomment-6032973358): Adopt simulated purchases, separate bounded purchase/inference allocations, allowlisted destinations, conservative recovery, and owner-local partial-report accounting.

- [Choose the transaction diagnosis and evidence contract](https://github.com/mangekyou-labs/haze-api/issues/42#issuecomment-6032969772): Bounded failed-EVM investigation on Base mainnet/Sepolia, evidence-linked diagnoses and labelled hypotheses; fixture/simulated-payment rehearsal with live delivery still gated.

- [Choose a concise README and first-investigation walkthrough](https://github.com/mangekyou-labs/haze-api/issues/44#issuecomment-6033071923): Accepted an 83-line current-use-first README and linked simulated investigation walkthrough, with evidence-linked reports and separate purchase/inference accounting.

- [Choose the implementation boundary and runnable acceptance checks](https://github.com/mangekyou-labs/haze-api/issues/45#issuecomment-6033203433): Accepted the guarded sequential runtime, validated bounded evidence, conservative restart journal, and offline acceptance suite with a separate live-delivery gate.

## Founder live follow-up

- [Package one founder-facing live investigator command](https://github.com/mangekyou-labs/haze-api/issues/56#issuecomment-6040500073): packaged and validated locally; [validation](founder-live-validation-2026-10-07.md).
- [Verify a useful live diagnosis and its own prepaid exchange](https://github.com/mangekyou-labs/haze-api/issues/57): complete. Two installed live investigations returned cited reports and each confirmed its own prepaid model response. [Validation and recovery evidence](founder-live-validation-2026-10-08.md) includes separate funding verification and reviewed build identity. Recording remains separate.
- [Add the verified investigator segment to the founder recording guide](https://github.com/mangekyou-labs/haze-api/issues/58): recording guide updated to the verified live evidence, with timing and narration; recording boxes remain unchecked.

## Not yet specified

No remaining in-scope planning decisions or fog. All child tickets are resolved; implementation and live-delivery verification follow the accepted handoff.

## Out of scope

- Implementing the investigator or replacing the README during charting.
- Recruitment, A/B/C validation, compensation, and grant materials.
- Mainnet payment launch, trading, automatic remediation transactions, a general agent marketplace, and selling investigation reports.
- Claims that standard wallet payments are unlinkable, that request content is private from providers, or that unmodified generic x402 clients support `zk-prepaid`.
