# B22 — Invite-only unpaid x402-agent pilot launch

Type: task
Status: active
Blocked by: Pilot correctness and release verification; Invite-only unpaid pilot copy freeze

## What to launch

Ship the invite-only, unpaid Base Sepolia pilot to three real coding-agent or
multi-agent operators while preserving the custom `zk-prepaid` protocol,
sidecar-local proving, self-hosted settlement, and the spend-plane privacy
boundary.

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
