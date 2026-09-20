# Decision: separate the invite control plane from detached funding provisioning

Status: decided  
Decision date: 2026-09-20

## Decision

Invite-only onboarding is split into two planes with no durable join:

- `control_plane.pilot_invites` holds the founder-issued invite: a SHA-256
  digest of the single-use code, the invited GitHub account id, expiry,
  redemption state, and revocation state. It never holds a commitment, a
  funding capability, or any spend-plane value.
- `pilot_provisioning.funding_capabilities` holds the detached capability
  minted on redemption: a SHA-256 digest of the token, the capability expiry,
  funding state, the commitment bound on the first funding attempt, and the
  funding transaction result. It never holds a GitHub account id, an invite
  id, or any other cross-plane identifier.

The two planes are separate PostgreSQL schemas owned by separate modules
(`ts/pilot-invites.ts` and `ts/pilot-funding.ts`) that do not import each
other. Redemption crosses the boundary through a capability issuer that takes
no arguments, so the provisioning plane is never told which GitHub account,
invite, or session produced a capability. Funding crosses back only as the
authoritative result the participant already holds.

Codes and tokens carry 256 bits of randomness and exist in plaintext only in
the founder's terminal and the participant's browser. Each is displayed once:
a lost code is revoked and reissued, never recovered. Invites default to seven
days; capabilities default to 30 minutes.

Funded commitments remain publicly recoverable by commitment alone
(`GET /v1/pilot/bundles/:commitment`), which is what makes local recovery
possible without a control-plane join.

## Why

The unpaid pilot promises payer and credential unlinkability for ordinary
valid spends. A single onboarding table containing both the GitHub account and
the commitment would be a durable payer-to-spend join sitting in the
application database, and it would also hand the service the ability to
reconstruct which funded credential belongs to which person. Splitting the
planes keeps the promise structural rather than procedural: even a full
disclosure of the provisioning schema cannot attribute a commitment, and even
a full disclosure of the control plane cannot spend or fund anything.

Storing only digests means a database disclosure cannot redeem a live invite
or fund with a leaked capability.

## Consequences

- Operational recovery of an invite requires reissuing it; the plaintext code
  cannot be re-derived.
- Provisioning a capability requires two writes in two schemas with no
  transaction across them. A redemption that mints a capability and then fails
  before the response is delivered leaves an unusable capability that expires
  in 30 minutes; that is the acceptable failure direction.
- Analytics and support cannot answer "which participant funded commitment X"
  from the service database. Attribution happens through the participant's
  own report.
- The public recovery lookup reveals immutable funding metadata to anyone who
  already knows a commitment; the commitment itself remains the secret that
  gates it.
- Version-1 paid exports stay readable by the sidecar and the recovery flow
  during the pilot, so the split does not invalidate existing backups.
