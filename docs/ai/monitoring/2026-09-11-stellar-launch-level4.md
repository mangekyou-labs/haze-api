---
phase: monitoring
title: Stellar Launch Level 4 monitoring
description: Privacy-preserving analytics, Sentry, synthetic checks, and alert response
---

# Level 4 monitoring

## Analytics

PostHog is initialized opted out. Only an explicit evaluation checkbox enables
it. Events cover onboarding, wallet, checkout, deposit, private-call outcome,
and survey lifecycle. Properties are limited to coarse duration, breakpoint,
release, error code, status, outcome, and fixed feedback values. Logout calls
both opt-out and reset. Prompts, bodies, identities, wallets, signatures,
proofs, commitments, mnemonics, cookies, authorization data, and API keys are
not sent.

## Sentry

Web, gateway, and fee-sponsor configuration disables default PII, replay,
local-variable capture, and sensitive request data. The before-send scrubber
recursively removes known private keys and request headers/bodies. Releases
and environments are tagged from deployment configuration. The cohort run must
trigger one harmless test event, confirm it appears scrubbed, and resolve it.

## Synthetic checks

`node scripts/synthetic-monitor.mjs` performs frontend, gateway `/health`,
gateway `/v1/contract-status`, and fee-sponsor `/health` checks with a
90-second timeout, two retries, and bounded backoff. The GitHub workflow runs
every 15 minutes and supports manual dispatch. Missing fee-sponsor configuration
is a skipped local check but fails the release workflow when
`REQUIRE_FEE_SPONSOR=true`.

## Alert response

Treat gateway, contract, or fee-sponsor failure as a cohort blocker. Display
“service is waking up” and a retry action for expected free-host cold starts;
do not claim an SLA. Investigate Sentry error codes and endpoint durations
without copying private payloads into tickets or screenshots.
