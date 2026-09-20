---
phase: design
title: Invite-Only Unpaid Onboarding
description: Approved design for B9 invite-only, unpaid Base Sepolia onboarding: split planes, detached funding capability, and the two-stage version-2 export.
---

# Invite-Only Unpaid Onboarding

Date: 2026-09-20  
Feature slug: `base-zk-credits`  
Branch: `feature-base-zk-credits`  
Status: implemented 2026-09-20 for [B9 — Invite-only unpaid onboarding](https://github.com/mangekyou-labs/haze-api/issues/12).  
Decision record: [Separate the invite control plane from detached funding provisioning](../../wayfinder/base-zk-credits-pilot/decisions/003-detached-funding-provisioning.md).

## Scope

This note records the design of the invite-only, unpaid onboarding path that
replaces paid checkout in the pilot runtime. It covers the data model, the
endpoints, the browser state machine, the two-stage version-2 export, and the
paid surfaces that were removed. Canonical vocabulary is in the
[pilot domain glossary](../../wayfinder/base-zk-credits-pilot/CONTEXT.md).

## Data model

Two schemas, deliberately unjoinable (migration `0015_pilot_invites.sql`):

| Schema | Table | Holds | Never holds |
| --- | --- | --- | --- |
| `control_plane` | `pilot_invites` | code digest, GitHub account id, expiry, redemption state, revocation state | commitment, funding token, credential material |
| `pilot_provisioning` | `funding_capabilities` | capability digest, capability expiry, funding state, bound commitment, funding result, authoritative expiry | GitHub account id, invite id, session id, credential material |

Codes and capabilities are 32 random bytes encoded base64url (256 bits) and
persisted only as SHA-256 hex digests. Invites default to seven days;
capabilities default to 30 minutes and carry a two-minute attempt lease so a
second process cannot double-fund a commitment.

A funded row is constrained to
`commitment IS NOT NULL AND bundle_expiry IS NOT NULL AND transaction_hash IS NOT NULL AND funded_at IS NOT NULL`,
and `commitment` is unique, so one commitment funds exactly once.

## Interfaces

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `POST /api/invites/redeem` (web) | GitHub session | Redeem `{ code }`; the GitHub id comes from the session only. Returns the one-time funding token. |
| `POST /v1/pilot/invites/redeem` (gateway) | internal service token | Control-plane redemption; called only by the web route. |
| `POST /v1/pilot/funding` (gateway) | none (sessionless) | `{ fundingToken, commitment }` → network, chain id, contract, deployment domain, tier 0, authoritative expiry, transaction hash. |
| `POST /api/pilot/funding` (web) | none (sessionless relay) | Same-origin relay for the browser. Reads no session and attaches no identity. |
| `GET /v1/pilot/bundles/:commitment` (gateway) | none | Public recovery lookup of immutable funding metadata. |
| `GET /api/network-status` (web) | none | Sanitized Base Sepolia health, contract address, generated time, explorer link. |

The browser keeps talking to its own origin (no gateway CORS change, no public
gateway URL in the bundle); the relay adds nothing to the funding request and
is deliberately sessionless so the control plane never participates in
funding.

## Two-stage version-2 export

1. **Recovery capsule** (before funding): the browser generates the secret
   locally, computes the commitment, and encrypts only `{ version: 2, secret }`
   with PBKDF2-AES-GCM (310,000 iterations, 16-byte salt, 12-byte IV). The
   participant downloads it and must re-import it successfully — the capsule
   must decrypt back to the same commitment — before funding is unlocked.
2. **Activated credential** (after funding): the browser wraps the *unchanged*
   capsule with the gateway's authoritative tier, expiry, deployment domain,
   network, contract, and transaction hash, downloads it, and verifies it
   locally against the secret in the capsule. Nothing is re-encrypted and no
   new secret is invented.

Version-1 exports (full-credential ciphertext) remain readable by the web
recovery flow and by the sidecar, which dispatches on the export version.

## Browser state machine

`invite → capsule → backup → funding → active`, with the funding token in
session storage and erased on the first successful funding. Funding is
idempotent: retries return the same result, reuse with another commitment
fails, and a failed sponsorship attempt stays retryable for the same
commitment. The dashboard never displays the commitment, the secret, remaining
credits, or per-credential usage.

## Removed paid surfaces

Frontend routes `POST /api/checkout`, `GET /api/orders/:orderId`,
`POST /api/webhooks/stripe`, and `GET/POST /api/wallet/link`, and gateway
routes `POST /v1/billing/orders`, `GET /v1/billing/orders/:orderId`,
`POST /v1/billing/stripe-event`, and `POST /v1/accounts/wallet-link` are
deleted. Stripe dependencies (`stripe`, `@stripe/react-stripe-js`,
`@stripe/stripe-js`) leave the web package, and the Stripe refund adapter
leaves the sponsor module. Base event synchronization for proof roots stays
and is no longer coupled to paid-order reconciliation; the legacy billing
modules remain in the tree unreferenced for history.

## Privacy boundary

- Funding receives no GitHub identity, session, or cookie; a supplied identity
  field is ignored and never echoed.
- Invite storage receives no commitment and no funding token.
- The service never receives the secret, the backup password, the plaintext
  capsule, proofs, nullifiers, request signals, or per-credential usage.
- Response and log scans in `ts/pilot-routes.test.ts` and
  `web/e2e/pilot-onboarding.spec.ts` assert these properties.

## Verification

Unit suites cover hashing, expiry, revocation, single-redemption under
concurrency, capability isolation, idempotent and concurrent funding, invalid
commitments, and retry after sponsorship failure. Browser suites cover the
full onboarding flow, backup gating, funding retries, version-1 compatibility,
wrong passwords, tampering, and local verification of the activated
credential.
