---
phase: planning
title: Stellar Launch — Level 4 production milestone
description: Delivery plan and acceptance gates for the consent-based Stellar testnet evaluation
---

# Stellar Launch — Level 4

Date: 2026-09-11  
Scope: Stellar testnet and Stripe test mode only. No mainnet assets or real
charges are introduced.

## Current status

The application and local verification work are implemented. The milestone is
not yet releasable because external evidence cannot be generated inside a
local worktree: the live Render gateway/fee-sponsor health checks, persistent
Postgres deployment, configured PostHog/Sentry evidence, ten real participants,
current screenshots, and the unlisted demo recording remain open.

## Delivered code gates

- Isolated `evaluation` Postgres schema and memory adapter with 90-day raw-proof retention.
- HMAC-SHA256 participant identity derived from the authenticated GitHub subject; public `L4-…` code only.
- SEP-53 challenge/proof verification, testnet/network checks, replay protection, rate limits, and unique-wallet enforcement.
- `$1` test-mode checkout return URL, consent-gated Stripe metadata, ownership-checked receipts, webhook idempotency, and deposit linking.
- Opt-in PostHog with a strict coarse-property allow-list and logout reset.
- Sentry configuration and recursive private-field scrubbing for web and gateway; fee-sponsor rollout remains deployment configuration.
- Loading/error/not-found boundaries, cancellation timeouts, retry controls, accessible live regions, focusable labels, responsive cards, and reduced-motion CSS.
- Redacted evidence exporter that refuses fewer than ten complete participants.
- Desktop/mobile Playwright coverage for the mocked evaluation lifecycle and wallet recovery states.
- Synthetic monitor and scheduled/manual GitHub workflow with a 90-second timeout and bounded retries.

## Acceptance gates

1. Apply the idempotent migration with a restricted production database.
2. Configure secrets and deploy web, gateway, and fee sponsor without exposing raw proof or identity mappings.
3. Pass three cold/warm synthetic checks and verify one Sentry test event plus opt-in PostHog/survey events.
4. Guide ten distinct humans through consent, Freighter testnet signing, `$1` Stripe test checkout, one unique confirmed deposit, the MVP API/private-call flow, and feedback.
5. Run `npm run evidence:export`; verify ten unique redacted records and every published transaction on Stellar Explorer.
6. Capture current desktop/mobile screenshots and a 4–6 minute unlisted demo with no mnemonic, secret, proof, API key, raw signature, or personal account data.
7. Complete final review, publish the branch/review request, and update [`docs/evidence/level4/README.md`](../../evidence/level4/README.md).

## Explicit non-goals

The protocol, circuit, sidecar, and contract design remain unchanged unless a
release-blocking test defect appears. Free Render cold starts are documented
and mitigated with wake/retry UX; no uptime SLA is claimed.
