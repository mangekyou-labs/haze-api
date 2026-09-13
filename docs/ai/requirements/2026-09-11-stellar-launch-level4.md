---
phase: requirements
title: Stellar Launch — Level 4 evaluation requirements
description: Consent-based Stellar testnet evaluation layered onto the launch-era product
---

# Stellar Launch — Level 4 evaluation requirements

Date: 2026-09-11  
Feature slug: `stellar-launch`  
Baseline: `1c17e14`  
Status: local implementation verified; hosted restore and synthetic verification complete; hosted product/evidence gates pending

## Problem and objective

The Stellar Launch product has a working launch-era onboarding, indexed-ticket
gateway, durable deposit/billing path, sidecar, and fee-sponsor service. Level
4 needs a measurable evaluation flow around that product without replacing
those behaviors or linking evaluation records to private API activity.

The objective is a consented Stellar Testnet cohort flow: an authenticated
participant enrolls, proves one Freighter wallet with SEP-53, completes an
explicit $1 Stripe test checkout backed by an existing browser-held
commitment, receives a confirmed testnet deposit, submits fixed feedback, and
can later be represented in a redacted ten-person evidence export.

## Scope

### In scope

- Stable HMAC participant identity derived in the web service from the
  authenticated GitHub subject, with public code `L4-<12 hex>`.
- Exact consent version `level4-2026-09-11` and a restricted evaluation data
  store with memory and Postgres adapters.
- Migration `0009_evaluation.sql` after migrations `0001`–`0008`, using the
  gateway's existing injected Pool and migration lifecycle.
- Ten-minute one-time wallet challenges, five challenges per rolling fifteen
  minutes, canonical SEP-53 verification, Testnet-only enforcement, and
  unique wallet/deposit/session ownership.
- Authenticated internal gateway evaluation routes:
  `/v1/evaluation/enroll`, `/status`, `/challenge`, `/wallet-proof`,
  `/feedback`, `/deposit`, `/checkout` (GET/POST), and `/checkout/status`.
- Consent-gated $1 Stripe test checkout, evaluation participant/receipt
  metadata, retryable webhook processing, and linking to the existing staged
  durable deposit path.
- Dashboard consent, wallet proof, checkout status, feedback, progress, safe
  explorer links, opt-in allowlisted PostHog, logout reset, and recursive
  Sentry scrubbing in web, gateway, and fee sponsor.
- Synthetic CI checks, lifecycle documents, regenerated package lockfiles,
  local verification, and fresh deployed evidence when external gates exist.

### Out of scope

- Mainnet assets, production charges, or a new contract/circuit protocol.
- Replacing `/v1/deposits`, indexed-ticket allocation, launch billing, sidecar,
  fee sponsorship, or the existing web onboarding/playground.
- Storing GitHub subjects, raw prompts, API keys, commitments, ZK proofs,
  mnemonics, cookies, or authorization data in evaluation records or telemetry.
- Claiming deployment, a ten-person cohort, screenshots, or a demonstration
  without direct current evidence.

## Functional requirements

1. **Identity and consent.** The web derives a full lowercase 64-hex HMAC ID
   using `EVALUATION_HMAC_SECRET`; that secret stays in the web service. The
   gateway accepts the derived ID only over `GATEWAY_SECRET` plus
   `x-evaluation-participant-id`. Enrollment is stable for the same ID and
   exact consent version, and a changed version is rejected.
2. **Persistence and retention.** Evaluation tables are isolated under the
   `evaluation` schema. Raw wallet address/signature material is retained for
   90 days, then nulled by scheduled purge while `wallet_fingerprint` (SHA-256,
   unique 64-hex) and safe aggregate completion data remain. Same-wallet
   re-verify after purge is idempotent and does not restore raw proof columns.
   Public status keys `wallet.verified` on `wallet_verified_at`. Migrations
   are idempotent and run twice safely.
3. **Wallet proof.** Challenges contain a server-generated canonical SEP-53
   message, expire after ten minutes, are single-use, and are rate limited to
   five creations per fifteen minutes. The Postgres adapter counts that window
   inside a participant-row lock (`SELECT … FOR UPDATE`) so concurrent
   creations cannot exceed the limit. Proofs must be canonical 64-byte
   signatures for a valid G address on Stellar Testnet. Wallets cannot be
   shared or replaced.
4. **Deposit and feedback.** A deposit link requires a verified wallet and a
   valid unique 64-hex transaction hash. Feedback requires wallet verification
   and a confirmed deposit; rating, booleans, bounded text, and quote consent
   are validated. Public status never includes raw proof material.
5. **Checkout and billing.** Evaluation checkout is exactly $1 (`amount_cents
   = 100`) in Stripe test mode (`sk_test_`) and cannot attach participant
   metadata until enrollment and a valid browser-held commitment are present.
   Checkout ownership and idempotency are durable. `confirmed` receipts are
   monotonic and cannot be downgraded. Processed webhook duplicates are
   acknowledged. Failed or unprocessed events retry through `claimCheckout`.
   Concurrent retries never insert a second membership leaf. If the process
   dies after Stellar accepts the deposit and before the receipt stores the
   hash, the original hash cannot be rebuilt without a chain reconciler; that
   window is documented, not papered over. Browser POSTs to
   `/api/evaluation/checkout`, `/checkout/status`, and `/deposit` return 405.
6. **Evidence.** Export refuses fewer than ten complete records or duplicate
   wallets/transactions. Completeness for export still requires a raw wallet
   address, so post-purge records do not export. It emits only public
   participant codes, redacted wallets, transaction hashes/links, completion
   times, and aggregate feedback.
7. **Telemetry.** PostHog is opt-in only with a closed coarse event/property
   allowlist and logout reset. Sentry scrubbing recursively removes sensitive
   nested fields in all three services before send.
8. **Compatibility.** Existing launch onboarding, API keys, proof-bound calls,
   ticket allocation, durable membership tree, billing, withdrawal, sidecar,
   and fee-sponsor behavior remain covered by their existing tests.

## Acceptance evidence

Local acceptance requires fresh lint, TypeScript checks, unit/integration tests,
web tests/E2E/build, circuit tests, sidecar and fee-sponsor tests, Rust tests
where the installed toolchain permits, and `git diff --check`. Release
acceptance additionally requires a migrated restricted database, deployed
gateway/fee sponsor/web, three cold/warm synthetic passes, scrubbed Sentry and
consented PostHog evidence, one retried $1 checkout, an explorer-confirmed
deposit, ten distinct consenting people with unique wallets/deposits/hashes,
fresh screenshots, redacted export, and a 4–6 minute unlisted demonstration.

External credentials or participants may leave the release evidence section
pending, but they cannot be represented as completed by local tests.
