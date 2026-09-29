Title: Founder-aware A/B/C roles and external-only market evidence

Map stories: [Codex developer's first call](https://github.com/mangekyou-labs/haze-api/issues/25#codex-developers-first-call) and [x402 operator's own agent loop](https://github.com/mangekyou-labs/haze-api/issues/25#x402-operators-own-agent-loop)  
Sources: [B9 onboarding #12](https://github.com/mangekyou-labs/haze-api/issues/12), [B8 integration #11](https://github.com/mangekyou-labs/haze-api/issues/11)

## Deliverable

Enforce the revised roles: A is an external Codex sidecar user, B is the
founder's x402 adapter run, and C is an external x402 adapter user. B qualifies
as a technical activation but is excluded from all market-validation counts.
Only A and C are external participants.

Keep the existing authenticated local aggregate snapshots and fixed-shape
redacted evidence, changing the slot mapping without adding participant
identity or a spend-plane join. Record active human setup time and assistance
separately from machine/provider wait. A qualifying A call starts the 14-day
UTC window. Follow-up and credible payment intent apply to both A and C.

## Acceptance

- Evidence validation accepts only A/C as sidecar/adapter respectively and B
  as the founder's adapter run.
- Gateway aggregates and evidence retain no prompts, responses, credentials,
  proofs, nullifiers, request signals, or identity-to-spend joins.
- Unit and migration checks cover all three assignments and preserve
  preexisting records without rewriting their historical slot meaning.
