---
phase: design
title: Stellar Launch — Level 4 evaluation design
description: Additive evaluation architecture for the existing launch product
---

# Stellar Launch — Level 4 evaluation design

Date: 2026-09-13
Feature slug: `stellar-launch`  
Baseline: `1c17e14`  
Status: approved; wallet-optional scope approved; local behavior update in progress; hosted restore and synthetic verification complete; hosted product/evidence gates pending

## Architecture decision

Use an additive evaluation adapter/router. The target branch's launch gateway
remains authoritative for indexed tickets, staged durable deposits, billing,
withdrawals, sidecar contracts, and fee sponsorship. Evaluation owns only
consent, pseudonymous participant records, optional wallet proof, feedback,
checkout receipts, retention, and redacted evidence. The primary Level 4
participant path is walletless; the gateway-funded staged deposit remains the
Stellar integration under evaluation.

The approved wallet-optional scope-change design is recorded in
[`docs/superpowers/specs/2026-09-13-stellar-launch-web2-evaluation-design.md`](../../superpowers/specs/2026-09-13-stellar-launch-web2-evaluation-design.md).
The 2026-09-11 design remains a historical record of the original additive
implementation and is superseded where it describes wallet-gated completion.

## Persistence

`EvaluationStore` has memory and Postgres implementations with one shared
domain contract. Production startup creates one Pool, runs the existing
ordered migration runner, reconstructs launch state as before, and injects a
Postgres evaluation adapter. Tests explicitly inject memory or a disposable
SQL pool. The new `evaluation` schema is never joined to gateway request data.

The evaluation migration creates participants, wallet challenges, and checkout
receipts with unique constraints and retention/completion indexes. Optional
wallet ownership uses a SHA-256 `wallet_fingerprint` (unique 64-hex) so raw
address and signature columns can be nulled after 90 days without allowing
reuse. Checkout processing uses durable ownership, a five-minute claim lease,
and a monotonic `markCheckout` that cannot downgrade `confirmed`. Wallet proof
is not part of the completion predicate or evidence gate. If
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
responses expose public code, optional redacted wallet status, transaction
hash, explorer URL, and progress only.

The evaluation checkout webhook calls the existing `submitDeposit` path. It
does not insert directly into the Merkle tree or create a parallel deposit
implementation. The current serialized pending-leaf and durable reservation/
activation sequence remains intact, and the gateway funds the evaluation
testnet deposit so a participant does not need a wallet.

## Web boundary

Server-only web helpers authenticate the NextAuth session, derive the HMAC,
and proxy allowlisted fields to the gateway. Browser code never receives either
secret. The dashboard adds a separate evaluation card and retains the current
onboarding, API-key, usage, playground, and purchase components. The primary
evaluation card does not expose a required Freighter step or wallet install
prompt; optional wallet proof remains an internal/future capability.

The evaluation Stripe session is created only after the current participant is
enrolled, Stripe is in test mode (`sk_test_`), and the request contains a
valid browser-held commitment. Wallet verification is not checked. The
session is exactly 100 cents. Stripe
metadata contains only the opaque participant ID/code, tier, amount, and
commitment needed by the existing deposit path. No subject, wallet, signature,
prompt, proof, or API key is attached.

Browser POSTs to `/api/evaluation/checkout`, `/api/evaluation/checkout/status`,
and `/api/evaluation/deposit` return 405. Checkout and deposit mutation stay
on the authenticated Stripe webhook and gateway claim path. Optional public
wallet status may remain present for compatibility, but completion requires
only a confirmed deposit and feedback. Evidence export does not require a raw
wallet address, so walletless and post-purge participants remain eligible.

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
tests run migrations twice and concurrent receipt/deposit cases, including
walletless completion. The release sequence is migration, gateway/fee sponsor,
web, three synthetic passes, scrubbed telemetry, one retried checkout,
ten-person cohort/evidence, then final lifecycle reconciliation and review.
