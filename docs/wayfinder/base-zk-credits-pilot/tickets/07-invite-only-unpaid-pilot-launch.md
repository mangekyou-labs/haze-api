# B22 — Invite-only unpaid x402-agent pilot launch

Type: task
Status: active — locally implemented, hosted activation outstanding
Blocked by: Pilot correctness and release verification (resolved); Invite-only unpaid pilot copy freeze (resolved)

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

Still outstanding, and requiring authority this worktree does not hold:
hosted Render/Vercel deploy, the once-on-production pause/resume, staging cap
exhaustion, the three pinned npm publishes, and three operator-owned
activations. The issue stays open until the third qualifying activation.

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
