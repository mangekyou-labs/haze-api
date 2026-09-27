---
phase: implementation
title: Implementation Guide
description: Technical implementation notes, patterns, and code guidelines
---

# Implementation Guide

> **M6 reconciliation (2026-09-11):** This file documents the earlier core
> implementation. Level 4 additions are recorded in
> [`docs/ai/implementation/2026-09-11-stellar-launch-level4.md`](../../ai/implementation/2026-09-11-stellar-launch-level4.md).
> Historical version/count claims are retained as context only.

## Development Setup
**How do we get started?**

- Prerequisites and dependencies: Rust 1.94+, Node.js 20+, Circom 0.5.46+.
- Environment setup: See root README.md for full setup steps.
- Configuration: `.env` file required for Gateway and Web App.

## Code Structure
**How is the code organized?**

- `zk-credits-contract/`: Soroban smart contract (Rust) handling deposits, verification, and slashing.
- `circuits/`: Circom circuits for BLS12-381 (deposit_membership, rln_nullifier, slash).
- `ts/`: Node.js/Express gateway implementing off-chain verification and OpenRouter proxy.
- `web/`: Next.js App Router application for user onboarding and payments.

## Implementation Notes
**Key technical details to remember:**

### Core Features
- **Contract Logic (`lib.rs`):** Uses `soroban-sdk` `bls12_381` types for native Groth16 verification.
- **Gateway Verification (`server.ts`):** Loads `verification_key_rln.json` at startup and uses `snarkjs` for proof verification.
- **Client Crypto (`web/src/lib/crypto.ts`):** `secret_k` is generated in-browser using `crypto.getRandomValues` and never leaves the device (IndexedDB only).
- **Merkle Tree (`merkle.ts`):** Off-chain MiMCSponge implementation matching the Circom circuit logic.

### Phase 5 Hardening
- **Stellar reads (`web/src/lib/stellar.ts`):** Uses `@stellar/stellar-sdk` RPC simulation and `get_deposit` with a typed u256 commitment; missing chain configuration keeps local development on the simulated path.
- **Slash monitoring (`ts/slashWatcher.ts`):** Polls Soroban contract events with cursors, deduplicates event IDs, and reports repeated successful `NullifierSpent` events to an operator callback. It does not submit a slash proof automatically.
- **Verification keys (`scripts/vk-convert.js`):** Converts the BLS12-381 snarkjs key into Soroban affine-point hex and is covered by a fixture test. `scripts/deploy-contract.js` consumes the generated real VK files.
- **Dashboard status:** When `ZK_CONTRACT_ID` and `GATEWAY_ADDRESS` are configured, the status route reads the deposit amount and state from the contract; otherwise it returns the safe zero/dev response.
- **Recovery/browser coverage:** `/recover` restores browser key material from a validated 24-word phrase, with Playwright coverage for the recovered dashboard flow.
- **OpenRouter coverage:** `ts/server.test.ts` contains an opt-in proof-backed upstream test enabled with `RUN_OPENROUTER_E2E=1` and `OPENROUTER_API_KEY`.

### Phase 6 Level 4 evaluation layer

- **Isolation:** `ts/evaluation.ts` defines a standalone consent, challenge,
  wallet, deposit, feedback, and retention domain. The Postgres adapter writes
  only to the `evaluation` schema and has no foreign key to private API, ZK,
  prompt, commitment, mnemonic, or request tables.
- **Identity:** `EVALUATION_HMAC_SECRET` derives a stable 64-hex participant
  identity from the authenticated GitHub subject; only the shortened `L4-…`
  code is rendered or exported publicly.
- **Wallet proof:** one-time ten-minute challenges use the final SEP-53
  canonical prefix, UTF-8 message, SHA-256 digest, and Ed25519 verification.
  Testnet-only addresses, replay protection, rate limits, wallet uniqueness,
  and raw-proof retention/deletion are enforced server-side.
- **Payments:** evaluation checkout is a `$1` Stripe test-mode session with
  `{CHECKOUT_SESSION_ID}` return routing. Participant metadata is attached only
  after consent; webhook retries and duplicate deposit callbacks are idempotent.
- **Privacy/observability:** PostHog starts opted out with explicit coarse
  allow-listing; Sentry defaults to no PII/replay/local variables and scrubs
  private fields. `scripts/synthetic-monitor.mjs` checks the web app, gateway,
  contract endpoint, and configured fee sponsor with bounded retries.
- **Evidence:** `ts/evidence-export.ts` refuses fewer than ten complete
  participants and emits only redacted Markdown/JSON.

### Patterns & Best Practices
- **TDD:** Contract tests (`test.rs`) verify deposit, spend, slash, and withdraw logic.
- **Verification Key Management:** VK is fixed at deploy time for the contract, loaded from file for the gateway.
- **Replay Protection:** Gateway maintains an in-memory `nullifierCache` to prevent double-spending within an epoch.

## Integration Points
**How do pieces connect?**

- **Stripe -> Gateway:** Webhook handler (`web/src/app/api/webhooks/stripe/route.ts`) calls `POST /v1/deposits` on the gateway.
- **Gateway -> Contract:** `ts/contract.ts` handles transaction submission to Stellar Testnet.
- **Web App -> Gateway:** Dashboard proxies requests for API keys and status via `web/src/lib/stellar.ts`.

## Error Handling
**How do we handle failures?**

- Contract errors are defined as `ContractError` enums.
- Gateway returns standard HTTP error codes (401, 402, 403, 500).
- Web App handles user-facing errors with toast notifications and console logging.
- Dev deposit route (`/api/dev/deposit`) gracefully falls back to simulated deposits when the gateway is unreachable or `GATEWAY_SECRET_KEY` is not set.

## Dev Mode (Local Testing Without External Services)
**How to test without GitHub OAuth or Stripe?**

When `GITHUB_CLIENT_ID` is not set, the web app automatically enters dev mode:
- **Auth:** next-auth uses a `Credentials` provider that auto-signs in as `dev@test.local` (user ID `dev-user-123`). No GitHub OAuth app needed.
- **Payments:** The dashboard detects `localhost` and routes "Buy Credits" to `/api/dev/deposit` instead of Stripe Checkout. This calls the gateway's `/v1/deposits` endpoint directly, or simulates the deposit if the gateway lacks `GATEWAY_SECRET_KEY`.
- **Sign-in page:** Shows a green "Dev Sign In (no OAuth)" button instead of "Sign in with GitHub".

### Dev-mode files
- `web/src/auth.ts` — conditional Credentials provider, exports `isDevMode`
- `web/src/app/sign-in/page.tsx` — dev vs production sign-in buttons
- `web/src/app/api/dev/deposit/route.ts` — deposit bypass with simulated fallback
- `web/src/app/dashboard/buy-credits-section.tsx` — dev mode detection and UI

### E2E testing
- `web/e2e/full-flow.spec.ts` — Playwright tests covering the full journey and recovery from a valid phrase.
- `web/playwright.config.ts` — starts an isolated gateway and web app on ports 3101/3100 by default, avoiding unrelated local servers.
- Run the automated suite: `cd web && npm run test:e2e`
- Run with the Playwright test UI: `cd web && npm run test:e2e:ui`
- Use `playwright-cli` for interactive browser inspection and screenshots; it replaces the Playwright MCP integration.

### Deployment tooling
- Use the Vercel CLI from `web/` for deployment and inspection: `vercel deploy`, `vercel ls`, `vercel inspect <deployment>`, and `vercel logs <deployment>`.
- Vercel MCP and Playwright MCP are not project dependencies or required runtime services.

## Security Notes
**What security measures are in place?**

- **Secret Management:** `GATEWAY_SECRET_KEY` is used for contract interactions; `GATEWAY_SECRET` for internal API auth.
- **ZK Integrity:** All proofs are verified off-chain before forwarding to OpenRouter.
- **On-chain integrity:** Soroban deployment inputs use generated real BLS12-381 verification-key points; conversion and real-proof contract tests protect the serialization boundary.
- **Custodial Limitation:** v1 withdrawal requires gateway auth; user withdrawal via ZK proof is deferred to M8.
