# Founder attempt settlement reconciliation — 2026-10-07

[Verify a useful live diagnosis and its own prepaid exchange](https://github.com/mangekyou-labs/haze-api/issues/57) remains open:
the existing attempt is now reconciled, but useful paid model delivery has not
been demonstrated.

## Existing attempt resolved

At the owner's explicit request, a separate owner-local diagnostic inspected
the hosted gateway's spend-plane claim. The Render service's configured database
was compared privately with the local operator configuration and matched.
The existing retired slot's nullifier was derived in memory from the OS-stored
credential using the shared implementation. A parameterized primary-key lookup
ran inside `BEGIN READ ONLY`; no migrations or claim-store cleanup ran.

Exactly one claim matched: generation 1, `cancelled`, one provider dispatch,
and no encrypted replay. Cancellation is definitive failure for this reservation;
it is not confirmed consumption or model delivery. The read-only inspection
left the journal bytes unchanged.

The existing `runtime.reconcile` interface then persisted a bound `failed`
observation for the same attempt, request digest and accepted terms. This was an
owner-authorized database observation, not a newly deployed public status API or
a provider-signed settlement receipt. The canonical credential runtime lease
was held during reconciliation. The authorizing factory was guarded to throw if
opened, and no facilitator operator token was used. The slot remains permanently
retired. The durable result is:

| Observation | Result |
| --- | --- |
| Unknown inference outcomes | 0 |
| Confirmed consumed credits | 0 |
| Locally retired slots | 1 |
| Existing inference outcome | Failed |

No payment payload, secret, nullifier, signal hash, reservation identifier, prompt,
or credential-to-claim mapping is included in this report. The earlier
[continuation](founder-live-continuation-2026-10-07.md) describes the state before
this reconciliation and is now historical.

## Provider capacity and remaining live gate

Read-only OpenRouter checks using the hosted gateway's configured provider key
returned HTTP 200 for key and account-credit metadata. The configured model was
listed. Account credits minus usage were negative (approximately −$0.057), even
though the key's own spending limit had remaining capacity. These are separate
limits. OpenRouter documents insufficient account credits as HTTP 402; see its
[error reference](https://openrouter.ai/docs/api/reference/errors-and-debugging).

The negative balance is a current provider-capacity obstacle and a plausible
explanation for the original cancelled dispatch. The inspected Render logs did
not establish that dispatch's exact upstream status, so its original failure
cause is not proven. No generation request was made to test the balance.

The gateway readiness endpoint also returned `ready: false`, with `baseRpc:
behind_head`; database, root synchronization, verifier assets and provider
configuration checks passed. Configuration readiness does not establish funded
provider capacity.

The owner subsequently replaced the local provider key and explicitly authorized
a generation request despite its reported zero account balance. One direct
OpenRouter request to the configured model returned HTTP 200 and the requested
`OK` response, with 13 tokens and a reported cost of $0.00000343. The zero balance
therefore did not establish that this replacement key could not generate. The
replacement differs from the hosted gateway's key. This diagnostic verifies
local provider delivery only: it bypasses the prepaid gateway and does not
establish the investigator's payment or settlement acceptance.

Continue after provider capacity and gateway readiness are restored. Preserve
the failed task and retired slot; repeating its hash recovers the prior report.
Use a separate eligible failed transaction for a new bounded task, after read-only
evidence preflight. That invocation must independently demonstrate a useful cited
diagnosis, validated prepaid settlement and model delivery. Separately verify
bundle funding on Base Sepolia. No new funding, deployment, package publication,
paid exact trace purchase or recording was performed. Recording remains gated.

## Validation

The existing focused reconciliation tests passed all 10 cases, including bound
failure, permanent retirement, mismatched observations and durable-write failure.
These tests validate the accounting interface; the database observation above
is the live outcome evidence. Sidecar typechecking passed. The unified suite
passed 144 controller/live checks, 18 injected sidecar checks and 35 service-class
checks; its prepaid integration remains SKIP and live purchased trace DISABLED.
Independent Standards review identified two documentation corrections, applied
before committing; Spec review found no defects. Neither review counts the
remaining live gates as complete.
