---
phase: implementation
title: Stellar Launch Level 4 implementation
description: Implementation map for evaluation, evidence, checkout, analytics, and observability
---

# Level 4 implementation

## Evaluation boundary

`ts/evaluation.ts` is the domain boundary. It exposes consent, status,
challenge, wallet proof, feedback, checkout receipt, deposit linking, export,
and retention operations without importing private API-call, prompt, ZK proof,
commitment, mnemonic, or request-content state. `ts/evaluation-postgres.ts`
implements the same boundary over the isolated `evaluation` schema;
`ts/evaluation-store-factory.ts` selects Postgres when configured and memory
storage for tests/local development.

`deriveParticipantIdentity()` uses HMAC-SHA256 with
`EVALUATION_HMAC_SECRET`. The full 64-hex value is an internal lookup key; the
browser and public exporter receive only `L4-${first 12 hex characters}`.
Raw wallet address/signature fields are restricted records and are nulled at
the retention deadline while pseudonymous completion evidence remains safe to
aggregate.

## Wallet proof

Challenges are one-time, ten-minute records. The server reconstructs the
canonical message and rejects client substitutions, expiry, replay, wrong
network, malformed `G…` addresses, malformed 64-byte signatures, duplicate
wallets, and attempts to replace an already verified wallet. Verification uses
the final [SEP-53 specification](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md).

## Checkout and deposit

The evaluation tier is a Stripe test-mode `$1` session. The return URL carries
`{CHECKOUT_SESSION_ID}`. Participant metadata is added only after an enrolled
participant is authenticated. The webhook validates test mode and ownership,
records a checkout receipt idempotently, and calls the gateway deposit path
with an idempotency key. Concurrent retries share in-flight work and durable
confirmed receipts prevent duplicate deposit submissions.

## Privacy and operations

- `web/src/lib/analytics.ts` initializes PostHog opted out, disables automatic
  capture/pageviews/session recording/surveys, and sends only allow-listed
  coarse events after explicit opt-in.
- `web/src/lib/sentry-scrub.ts` and `ts/observability.ts` remove known private
  fields recursively and disable default PII/replay/local-variable capture.
- `scripts/synthetic-monitor.mjs` checks only endpoint labels/status/duration;
  `.github/workflows/synthetic-level4.yml` runs it on schedule and manually.
- The evaluation UI communicates cold starts as a waking service, exposes
  retry actions, and preserves keyboard/focus/reduced-motion behavior.
