# Private-credit pilot domain glossary

## Principal

The person or organization that funds API use and delegates authority to one
or more agents.

## Agent

An autonomous or human-directed software client acting with authority granted
by a principal. Multiple agents may share a principal without sharing a
credential.

## Sidecar

The operator-local proxy that holds the credential, generates spend proofs,
and presents the custom x402 payment. It is not the resource server or the
facilitator. Spend proofs are generated only in this process.
_Avoid_: remote prover, proving helper, browser prover

## Resource server

The service that accepts an authorized API request and supplies the requested
resource. It may observe request content and traffic metadata.

## Bundle

A prepaid collection of bounded service entitlements purchased by a principal
and represented by a private credential.

## Credit

One bounded service entitlement within a bundle. For the pilot, it is consumed
only by a successfully committed response from the purchased service class; it
does not mean an arbitrary API call. A cancelled claim consumes no credit.

## Service class

A versioned service offering that fixes the provider and model, accepted
request shape, token and byte limits, timeout, replay limit, routing policy,
and price ceilings. Changing one of those customer-visible boundaries requires
a new service-class version rather than silently changing an existing class.

## Credit asset

A scheme-local, versioned identifier for the credit consumed by a service
class. It names the bounded service entitlement; it is not the Base bond,
USDC, a bundle, or a credential.
_Avoid_: Payment token, bond asset

## Credential

Private authority to prove membership in a bundle and consume its unused
credits. It is distinct from the principal's account and payment identity.

## Slot

The index of one credit-consumption right inside a bundle's allowance. Any
unused slot below the allowance may be chosen; uniqueness is the nullifier,
not a globally increasing counter.

## Slot blinding

The private per-slot value derived from the credential secret, the slot, and
the deployment domain. It is the hidden slope in the spend share. One
transcript must not reveal it.
_Avoid_: a, ticket secret, RLN slope

## Nullifier

The public unique identifier of one slot spend, derived only from the slot
blinding. Reuse of the same nullifier with two different request signals is
the documented abuse evidence.

## Request signal

The public hash-to-field of one canonical request: method, resource URL, body
hash, accepted-requirements digest, nonce, and response key. It is the `x` in
the share equation.
_Avoid_: message hash, request hash

## Share

The public linear evaluation `secret + slot_blinding * request_signal`. One
share must not reveal the secret or the slot blinding; two shares with the
same nullifier and different request signals recover both.

## Deployment domain

The public field element that binds a proof to one contract deployment so a
proof cannot be replayed across deployments.

## Merkle root

A published root of the append-only membership tree. A spend proves a private
leaf is in some known root without naming the leaf.

## Spend authorization

Short-lived permission to reserve a claim. It is bound to a gateway-issued
time and to this HTTP request. It is not the same policy as slash evidence.

## Slash evidence

Two valid transcripts that share a nullifier and differ in request signal.
It remains usable after the spend-authorization window, through bundle expiry
plus the challenge period.

## Claim

An attempt to consume one or more credits for a particular request. A claim
exists only after the sidecar has produced a self-verified spend proof and
presented it for reservation. A claim can be reserved, committed, or
cancelled.

## Reservation

A temporary exclusive hold on the credit identified by a claim while the
resource server determines whether it can return a successful response.

## Commit

The terminal state in which a successful response makes the reserved credit
consumed.

## Cancellation

The release of a reservation when no chargeable successful response was
produced. Cancellation does not consume the credit.

## Proof failure

A spend proof that was not produced or did not self-verify. It is not a
claim, not a cancellation, and not slash evidence. The slot remains unused.
_Avoid_: cancelled claim, failed reservation

## Payer unlinkability

The resource server cannot ordinarily determine that valid claims made with
different credentials are funded by the same principal solely from the
payment proof.

## Credential unlinkability

The resource server cannot ordinarily correlate valid claims from one
credential solely from their payment proofs, except where the protocol's
documented abuse evidence intentionally reveals a relationship.

## Request privacy

Confidentiality of request content or traffic metadata from the gateway or
resource server. The pilot does not provide this property.

## Real call

A committed claim that originated from the partner's own agent loop. Exact
retries, cancellations, and founder-driven smoke requests are not real calls.

## Activated design partner

A paying pilot participant that has paid the live SKU, runs the sidecar on
its own machine, and has produced at least one real call, without the team
handling its secret.

## Two-agent deployment

One principal operating at least two agents with distinct credentials against
the same resource server.

## Renewal intent

A dated written commitment to repurchase the live SKU at its stated price.
It is not a verbal preference and not itself a second checkout.

## Manual recovery

Founder access to a credential secret, backup password, or decrypted export,
or issuance of a replacement credential because the partner could not use
its backup.

## Founder assistance

A human intervention by the team in a partner's installation or configuration
that is not manual recovery.

## Hot prove time

Wall time on the sidecar host from the moment the membership witness, request
signal, and gateway-issued timestamp are in hand through Groth16 proof
generation and local self-verify. It excludes challenge fetch, witness
synchronization, gateway HTTP, and provider time. Process-start WASM and
proving-key load is cold start, not hot prove time.

## Published proving SLO

The product-wide p95 cap on hot prove time. A partner's accepted proving
latency must not be looser than this cap.

## Accepted proving latency

The numeric p95 hot prove time a partner writes before its first paid claim.
It is measured on that partner's sidecar host and must not be looser than the
published proving SLO.

## Linkable session

An ordinary payer-identifying x402 session used as a paper alternative during
validation. It is not a product path.
_Avoid_: exact rail, supported session product

## Unpaid pilot participant

An invitee in the amended first cohort who receives founder-provisioned test
credits, runs its own agent and credential on Base Sepolia, and contributes
behavioral evidence without making a real payment. The team may assist with
installation but never handles the participant's secret.

## Adapter-enabled x402 agent

An x402-native agent that deliberately registers the project's versioned
`zk-prepaid` adapter and completes the custom challenge, local proof,
`PAYMENT-SIGNATURE`, facilitator settlement, and `PAYMENT-RESPONSE` exchange.
An unmodified generic x402 client is not an adapter-enabled x402 agent.

## Credible payment intent

An unpaid pilot participant's acceptance of a concrete paid-pilot price or a
dated next step to decide on that price. General enthusiasm, a preference for
privacy, or a willingness to keep testing is not credible payment intent.

These three terms apply only to the amended unpaid pilot. The existing
definitions of activated design partner and renewal intent remain unchanged
historical definitions for the paid pilot.

## Pilot invite

A founder-issued, single-use onboarding code bound to one GitHub account. It
defaults to seven days of validity, is stored only as a SHA-256 digest, and is
revoked by invite id rather than deleted. It is control-plane data: it never
carries a commitment, a funding capability, or any spend-plane identifier.
_Avoid_: token, access code, referral link

## Funding capability

A detached, single-use bearer credential minted when a pilot invite is
redeemed. It defaults to 30 minutes of validity, is stored only as a SHA-256
digest, and knows nothing about the GitHub account, invite, or session that
produced it: its only durable identifiers are the digest and, after the first
funding attempt, the commitment it is bound to. One capability binds to one
commitment; retries return the same authoritative result.
_Avoid_: API key, purchase, order, license

## Recovery capsule

The version-2 local export produced before funding. It encrypts only the
locally generated secret with a password (PBKDF2-AES-GCM) and is downloaded
and re-imported by the participant before any funding is attempted. The
service never receives the capsule, its password, or its plaintext.
_Avoid_: backup file, mnemonic, seed phrase

## Activated credential

The same encrypted recovery capsule wrapped with the gateway's authoritative
tier, expiry, deployment domain, and contract metadata after funding. The
participant downloads it and verifies it locally against the secret in the
capsule. Version-1 exports remain readable as legacy activated credentials.
_Avoid_: funded key, issued key, receipt

## Control plane

The GitHub-facing side of onboarding: invite issuance, redemption, and the
authenticated session that supplies the GitHub account id. It never stores a
commitment, a funding token, or a credential secret.

## Provisioning plane

The detached side of onboarding: funding capabilities and the Base Sepolia
funding transaction. It never stores a GitHub account id, an invite id, or any
other identifier that could join a commitment back to a person. The two planes
are separate database schemas with no foreign key and no durable join.

