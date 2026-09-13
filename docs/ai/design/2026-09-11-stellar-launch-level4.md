---
phase: design
title: Stellar Launch — Level 4 evaluation design
description: Additive evaluation architecture for the existing launch product
---

# Stellar Launch — Level 4 evaluation design

Date: 2026-09-11  
Feature slug: `stellar-launch`  
Baseline: `1c17e14`  
Status: approved; locally implemented; hosted restore and synthetic verification complete; hosted product/evidence gates pending

## Architecture decision

Use an additive evaluation adapter/router. The target branch's launch gateway
remains authoritative for indexed tickets, staged durable deposits, billing,
withdrawals, sidecar contracts, and fee sponsorship. Evaluation owns only
consent, pseudonymous participant records, wallet proof, feedback, checkout
receipts, retention, and redacted evidence.

The full approved design is recorded in
[`docs/superpowers/specs/2026-09-11-stellar-launch-level4-design.md`](../../superpowers/specs/2026-09-11-stellar-launch-level4-design.md).

## Persistence

`EvaluationStore` has memory and Postgres implementations with one shared
domain contract. Production startup creates one Pool, runs the existing
ordered migration runner, reconstructs launch state as before, and injects a
Postgres evaluation adapter. Tests explicitly inject memory or a disposable
SQL pool. The new `evaluation` schema is never joined to gateway request data.

The evaluation migration creates participants, wallet challenges, and checkout
receipts with unique constraints and retention/completion indexes. Wallet
ownership uses a SHA-256 `wallet_fingerprint` (unique 64-hex) so raw address
and signature columns can be nulled after 90 days without allowing reuse.
Checkout processing uses durable ownership, a five-minute claim lease, and a
monotonic `markCheckout` that cannot downgrade `confirmed`. If
`submitDeposit` returns and `markCheckout(confirmed, txHash)` persists, a
retry repairs participant linkage without submitting again. If the process
dies after Stellar accepts the deposit and before the receipt stores the
hash, membership-tree reconstruction prevents a second leaf for the same
commitment, but the original transaction hash cannot be rebuilt without a
chain reconciler. This milestone documents that window; it does not add a
reconciler.

## Gateway boundary

Evaluation routes are mounted beneath the existing readiness-gated `/v1` app.
The shared middleware checks `Authorization: Bearer GATEWAY_SECRET`, validates
the 64-hex participant header, and maps domain errors to safe statuses. Route
responses expose public code, redacted wallet, transaction hash, explorer URL,
and progress only.

The evaluation checkout webhook calls the existing `submitDeposit` path. It
does not insert directly into the Merkle tree or create a parallel deposit
implementation. The current serialized pending-leaf and durable reservation/
activation sequence remains intact.

## Web boundary

Server-only web helpers authenticate the NextAuth session, derive the HMAC,
and proxy allowlisted fields to the gateway. Browser code never receives either
secret. The dashboard adds a separate evaluation card and retains the current
onboarding, API-key, usage, playground, and purchase components.

The evaluation Stripe session is created only after the current participant is
enrolled, Stripe is in test mode (`sk_test_`), and the request contains a
valid browser-held commitment. The session is exactly 100 cents. Stripe
metadata contains only the opaque participant ID/code, tier, amount, and
commitment needed by the existing deposit path. No subject, wallet, signature,
prompt, proof, or API key is attached.

Browser POSTs to `/api/evaluation/checkout`, `/api/evaluation/checkout/status`,
and `/api/evaluation/deposit` return 405. Checkout and deposit mutation stay
on the authenticated Stripe webhook and gateway claim path. Public status
keys `wallet.verified` on `wallet_verified_at`, so completion can remain true
after raw proof purge with `addressRedacted: null`. Evidence export still
requires a raw wallet address, so post-purge records do not export.

## Observability and operations

PostHog starts opted out with autocapture, pageviews, session recording, and
surveys disabled. Only named coarse properties are accepted; opt-in is reset
on logout. Sentry uses the same recursive sensitive-field scrubber in web,
gateway, and fee sponsor with default PII/local variables/breadcrumbs off.

The scheduled synthetic workflow reads `LEVEL4_FRONTEND_URL`,
`LEVEL4_GATEWAY_URL`, and `LEVEL4_FEE_SPONSOR_URL`, and probes frontend,
gateway health/contract status, and fee-sponsor health with bounded retries.

## Verification and rollout

Implementation proceeds Red/Green/Refactor per behavior. Disposable Postgres
tests run migrations twice and concurrent receipt/deposit cases. The release
sequence is migration, gateway/fee sponsor, web, three synthetic passes,
scrubbed telemetry, one retried checkout, ten-person cohort/evidence, then
final lifecycle reconciliation and review.
