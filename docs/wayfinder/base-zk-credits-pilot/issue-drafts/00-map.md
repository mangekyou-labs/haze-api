Title: Base ZK Credits pilot: founder x402 demo and two external operators

## Destination

Make first use practical for Web2 developers: a founder-prepared invite, one
instruction to give Codex, and a target of five minutes of human action
through the first counted call.

The cohort has three serialized slots: **A: external Codex developer; B:
founder x402 agent; C: external x402 agent**. B counts as a technical
activation only. A and C alone count toward market validation. Pay each
external participant $25 for a 30-minute usability session regardless of
setup success; measure product willingness to pay separately. This research
payment is not product revenue or payment intent.

A qualifying A activation starts a 14-day UTC window. Continuation requires
both external participants to make a real call on another calendar day and
show credible payment intent.

## Pilot stories

### Codex developer's first call

After the founder grants repository access and prepares an invite, Codex
checks local `gh` authentication, installs the pinned release, downloads and
verifies the private hash-pinned proving bundle, and runs setup. The human
handles GitHub sign-in, local recovery password, consent, and their own task.

### x402 operator's own agent loop

The operator registers the request-aware `zk-prepaid` adapter in their own
agent and makes a real task call. The founder has a small task-running starter
agent for the same path.

The original paid user stories remain in the local domain map as historical
context.

## Existing interface and boundaries

The local sidecar already contains a bounded Codex Responses bridge that maps
supported text and function-tool requests into the fixed Chat Completions
service class. It is not a generic Responses gateway. The request-aware
`zk-prepaid` adapter uses the existing local proof engine. Both client paths
produce the same authenticated local aggregate snapshots and redacted evidence.

For valid spends, preserve payer and credential unlinkability. The model
provider still receives each request. The circuit remains experimental and
unaudited; generic unmodified x402 agents are unsupported. Evidence must not
contain prompts, responses, credentials, proofs, nullifiers, request signals,
or identity-to-spend joins.

## Completed foundation and deferred work

The closed [B6 claim-store and facilitator issue #9](https://github.com/mangekyou-labs/haze-api/issues/9),
[B8 integration issue #11](https://github.com/mangekyou-labs/haze-api/issues/11),
[B9 onboarding issue #12](https://github.com/mangekyou-labs/haze-api/issues/12),
[B11 correctness issue #14](https://github.com/mangekyou-labs/haze-api/issues/14),
[B21 copy issue #24](https://github.com/mangekyou-labs/haze-api/issues/24), and
[B22 internal rehearsal #26](https://github.com/mangekyou-labs/haze-api/issues/26)
remain the implementation foundation. B22 is an uncounted internal exchange,
not external activation evidence. The closed diagnostic issue [#28](https://github.com/mangekyou-labs/haze-api/issues/28)
also remains linked for its historical investigation.

Stripe, paid-traffic review, independent cryptographer review, and benchmark
issues remain deferred until after this behavioral readout.

## Children and dependencies

1. [#29](https://github.com/mangekyou-labs/haze-api/issues/29) Codex first use — no blocker.
2. [#30](https://github.com/mangekyou-labs/haze-api/issues/30) x402 agent first use — no blocker.
3. [#31](https://github.com/mangekyou-labs/haze-api/issues/31) Founder-aware evidence — no blocker.
4. [#32](https://github.com/mangekyou-labs/haze-api/issues/32) Release and launch preparation — blocked by [#29](https://github.com/mangekyou-labs/haze-api/issues/29), [#30](https://github.com/mangekyou-labs/haze-api/issues/30), and [#31](https://github.com/mangekyou-labs/haze-api/issues/31).
5. [#33](https://github.com/mangekyou-labs/haze-api/issues/33) Founder demo kit and wizard — blocked by [#30](https://github.com/mangekyou-labs/haze-api/issues/30) and [#31](https://github.com/mangekyou-labs/haze-api/issues/31).
6. [#34](https://github.com/mangekyou-labs/haze-api/issues/34) Recruit A and C — no blocker; human-only.
7. [#35](https://github.com/mangekyou-labs/haze-api/issues/35) Prepare founder grant demo — blocked by [#33](https://github.com/mangekyou-labs/haze-api/issues/33); human-only.
8. [#36](https://github.com/mangekyou-labs/haze-api/issues/36) Authorize release and hosted pilot — blocked by [#32](https://github.com/mangekyou-labs/haze-api/issues/32) and [#35](https://github.com/mangekyou-labs/haze-api/issues/35); human-only.
9. [#27](https://github.com/mangekyou-labs/haze-api/issues/27) B23 serialized activations — blocked by [#34](https://github.com/mangekyou-labs/haze-api/issues/34) and [#36](https://github.com/mangekyou-labs/haze-api/issues/36); human-only.
10. [#37](https://github.com/mangekyou-labs/haze-api/issues/37) External follow-up — blocked by the A checkpoint in [#27](https://github.com/mangekyou-labs/haze-api/issues/27); human-only.
11. [#16](https://github.com/mangekyou-labs/haze-api/issues/16) B13 readout — blocked by [#27](https://github.com/mangekyou-labs/haze-api/issues/27), [#37](https://github.com/mangekyou-labs/haze-api/issues/37), and the completed 14-day UTC window.

Each ticket links to its applicable story above and the relevant B9 onboarding
#12 and/or B8 integration #11 source. The local domain map preserves the
original paid stories as historical context.
