---
phase: implementation
title: Implementation Guide
description: Technical implementation notes, patterns, and code guidelines
---

# Implementation Guide

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

## Security Notes
**What security measures are in place?**

- **Secret Management:** `GATEWAY_SECRET_KEY` is used for contract interactions; `GATEWAY_SECRET` for internal API auth.
- **ZK Integrity:** All proofs are verified off-chain before forwarding to OpenRouter.
- **Custodial Limitation:** v1 withdrawal requires gateway auth; user withdrawal via ZK proof is deferred to M8.
