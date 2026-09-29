Title: B23 — Serialize A, founder B, and external C activations

Map stories: [Codex developer's first call](https://github.com/mangekyou-labs/haze-api/issues/25#codex-developers-first-call) and [x402 operator's own agent loop](https://github.com/mangekyou-labs/haze-api/issues/25#x402-operators-own-agent-loop)  
Sources: [B9 onboarding #12](https://github.com/mangekyou-labs/haze-api/issues/12), [B8 integration #11](https://github.com/mangekyou-labs/haze-api/issues/11)  
Blocked by: [#34](https://github.com/mangekyou-labs/haze-api/issues/34), [#36](https://github.com/mangekyou-labs/haze-api/issues/36)  
Owner: founder; human-only

## Deliverable

Run A (external Codex), then a fresh founder B x402 run, then C (external
x402). Keep private evidence and checkpoints separate for each slot. The
internal founder demo occurs before launch and does not substitute for B.

Each slot has exactly one discarded warm-up and one counted own-agent custom
`zk-prepaid` exchange. Require local proof and self-check,
`PAYMENT-SIGNATURE`, facilitator settlement, `PAYMENT-RESPONSE`, and a two-claim
aggregate gateway delta. A's qualifying call starts the 14-day UTC window.

Pay A and C each $25 for a 30-minute usability session regardless of result.
Record active human setup time and assistance; a result above five minutes is
a friction finding, not a reason to reject a protocol-valid exchange. The
honorarium is excluded from revenue and payment-intent evidence.

## Acceptance

- A and C are distinct opt-in external operators; B is the founder and counts
  only as a technical activation.
- All three evidence bundles qualify against the pinned release and contain
  only allowed redacted evidence.
- For continuation, both A and C must make a real call on another calendar
  day and show credible product payment intent. Count neither the $25
  honorarium nor founder B toward these criteria.
- No prompts, responses, credentials, proofs, nullifiers, request signals, or
  identity-to-spend joins enter retained evidence.
