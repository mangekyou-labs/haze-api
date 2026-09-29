# B22 — External invite-only unpaid x402-agent pilot execution tracker

> **Superseded on 2026-09-29.** Use the revised
> [A/B/C pilot map](../map.md) and its
> [issue drafts](../issue-drafts/README.md) for the active cohort, honorarium,
> setup target, qualification rules, and issue plan. This file is retained as
> historical context for the prior three-operator pilot proposal.

Type: task
Status: external pilot pending — this local tracker is broader than current GitHub issue #26
Blocked by: Pilot correctness and release verification (resolved); Invite-only unpaid pilot copy freeze (resolved)

## Scope reconciliation (2026-09-27)

GitHub issue [#26](https://github.com/mangekyou-labs/haze-api/issues/26) now
covers the **internal Base Sepolia integration trial**: one Codex sidecar
exchange and one separately registered `zk-prepaid` adapter exchange using
one locally held credential. Those calls do not count as external operator
activations. Track their independent results in
[`base-sepolia-internal-trial.md`](../../../evidence/base-sepolia-internal-trial.md).

This local ticket preserves the earlier, broader external pilot execution
scope: authenticated hosted access and three serialized operator activations.
Those criteria remain outstanding for the external pilot and B13 readout, but
they are not acceptance criteria for issue #26. Completing the internal trial
does not satisfy or count toward them.

## What to launch

Ship the invite-only, unpaid Base Sepolia pilot to three real coding-agent or
multi-agent operators while preserving the custom `zk-prepaid` protocol,
sidecar-local proving, self-hosted settlement, and the spend-plane privacy
boundary.

## Local status (2026-09-21)

Implemented and covered by the release matrix recorded in
[B22 launch-control evidence](../../../ai/testing/2026-09-18-feature-base-zk-credits.md#local-b22-launch-control-evidence-2026-09-21):

- the single service class is enforced server-side before any credit is
  reserved, with the approved model, limits, ceilings, and timeout;
- the kill switch and the $40/$200 micro-USD provider-spend caps are durable
  Postgres state, and cap exhaustion persists a paused launch;
- readiness covers Postgres, Base root freshness and lag, verifier assets,
  provider configuration, and launch state; and
- authenticated aggregate status reports bounded counters, spend headroom,
  claim counts, and Base lag with no joinable identifier.

## Hosted checkpoint (2026-09-23)

Production readiness, the fixed spend caps, one pause/resume cycle, and the
isolated staging Postgres cap-exhaustion control all passed. The separate
staging Render service was not given runtime credentials. The authorized
GitHub OAuth, NextAuth, gateway, and billing values were added to Vercel
production and the app redeployed at `https://zk-credits-web.vercel.app`.
Only the six runtime variable names are recorded in the deployment evidence;
their values remain private.

Browser checks confirmed the public pages render, the GitHub sign-in redirect
reaches GitHub without callback error, anonymous `/api/auth/session` returns
HTTP 200 with `null`, and anonymous `/dashboard` remains gated at `/sign-in`.
No human credentials were entered, so authenticated session and dashboard
access remain unverified. The requested final verification suite passed across
TypeScript, adapter, shared package, sidecar, and web. See [hosted evidence](../../../ai/testing/2026-09-18-feature-base-zk-credits.md#b22-hosted-launch-checkpoint-evidence-2026-09-23).

The launcher records slot A as aborted with Ctrl+C; slots B and C are pending.
There are no qualifying operator bundles or aggregate activation summary yet.
The three pinned packages are now published. Fresh `npm pack --json`
integrities matched npm's registry integrities for all versions, and a clean
sidecar `npm ci`, build, and test run (66 passing) verified registry dependency
resolution. This supersedes the earlier 404/401 check; do not republish these
consumed versions. These broader external-pilot criteria remain open in this
local tracker until authenticated hosted access is verified, all three
serialized real activations qualify, their redacted evidence passes privacy
scanning, and final hosted verification is complete. They do not hold issue
#26 open after its internal trial acceptance criteria are met.

## Launch automation (2026-09-21)

The launch is now driven rather than described, and the release-readiness gaps
that would have prevented a third activation were closed — see
[B22 launch-automation evidence](../../../ai/testing/2026-09-18-feature-base-zk-credits.md#local-b22-launch-automation-evidence-2026-09-21):

- `scripts/launch-pilot.sh` is the single entrypoint over a 26-step checkpointed
  plan, with `--check` and `--status` as read-only modes, no unattended
  confirmation flag, and no flag that deletes a resource. A non-idempotent call
  that times out is recorded as `unknown` and blocks a retry until it is
  reconciled against the provider.
- Activation evidence moved to schema version 2: three counter snapshots give a
  delta for every exchange counter, proving counter, and failure category, and
  qualification requires exactly one clean cold warm-up and exactly one clean
  counted exchange. Warm-up contamination, stale traffic, and concurrent
  activation traffic are each rejected with a named reason.
- The publish sequence covers all three packages in dependency order, including
  the sidecar's `file:` to exact-version rewrite between the two publish groups.
- Staging can narrow the spend caps to prove exhaustion
  (`PILOT_ENVIRONMENT=staging` plus the two override variables) and any
  deployment that is not staging refuses to start with them set.
- `npm run activation:rehearse` proves the founder orchestration without
  consuming an operator slot, and refuses while a window is open.

A valid activation bundle could not previously have been produced at all: both
the guardrail scan and the operator wizard rejected the evidence schema's own
`credentialStayedLocal` attestation as a secret-bearing field. Both now exempt
that one key, and the tests pin both directions.

## Acceptance criteria

- Deploy the resource server, sidecar, facilitator, isolated claim store, and
  corrected verifier path on Base Sepolia.
- Disable real payment, obsolete Stellar/evaluation routes, and unsupported
  x402 rails in the deployed configuration.
- Activate at least one coding-agent operator through the OpenAI-compatible
  sidecar and at least one x402-native agent that explicitly registers the
  project `zk-prepaid` adapter. The third participant may use either path.
- Each participant runs its own agent and credential; the team never handles
  a participant secret, backup password, decrypted export, proof, nullifier,
  or request signal.
- Every counted real call completes `zk-prepaid` negotiation and settlement,
  including the 402 challenge, local proof, `PAYMENT-SIGNATURE`, facilitator
  settlement, and `PAYMENT-RESPONSE`.
- Publish a short adapter/sidecar installation guide and provide
  founder-assisted onboarding without turning assistance into manual recovery.
- Enable provider-spend caps, a service kill switch, and privacy-safe health
  monitoring.
- Collect no prompts, responses, secrets, proofs, nullifiers, request
  signals, or payer/spend-plane joins.
- State clearly that the circuit is experimental and not independently
  audited.

## Evidence

Record participant type, activation time, onboarding duration, exchange
successes and failures, and privacy-safe operational aggregates for the
two-week readout. Do not turn this task into a paid-readiness or generic-x402
compatibility claim.

## Internal-trial launcher checkpoint (2026-09-27)

The separate GitHub issue 26 trial has its own gate and evidence record. The
targeted launcher added a read-only `--trial-gate` and a `--render-attribution`
checkpoint; its current plan contains 29 steps. The local preflight and fresh
gateway/admin gate passed, and Render Builder Code attribution reached `live`.
The stale `deploy:approve-usdc` success state was checked against Base Sepolia:
allowance was zero, so the previously authorized initial 20 test USDC
approval was applied and confirmed. No bundle was funded.

Issue 26 remains open. The local credential is still missing, and the installed
Codex profile sends streaming `/v1/responses` requests that the sidecar rejects;
the full Codex request context also exceeds the gateway's 16,000-byte service
class input bound. Do not treat the approval or gate pass as an exchange.
Internal trial results, stop conditions, and the fresh allowlisted gate report
are recorded in [the internal trial evidence](../../../evidence/base-sepolia-internal-trial.md).
