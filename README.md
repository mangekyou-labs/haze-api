# zk-api-credits

Anonymous RLN-rate-limited API credits for coding agents on Stellar.

## What It Is

A privacy gateway between base-URL-configurable coding agents and LLM APIs (OpenRouter, 400+ models). Developers buy anonymous credits with a card; a local sidecar adds a ZK-RLN proof to each LLM request; ticket forks slash deposits on-chain.

**The gateway cannot link a call to a deposit.** ZK enforced.

## How It Works

1. Developer signs in with GitHub, buys $5 credits via Stripe
2. Browser generates `secret_k` + commitment, stores key in IndexedDB
3. Gateway mints on-chain USDC deposit referencing the commitment
4. Agent calls `OPENAI_BASE_URL` with a ZK proof in the header
5. Gateway verifies proof (off-chain), forwards to OpenRouter, returns response
6. Over-quota: nullifier collision → RLN math extracts `secret_k` → slash on-chain

## Quick Start

### Prerequisites

- Node.js 20+
- Rust 1.94+ (`rustup toolchain install 1.94`)
- Stellar CLI 27+ (`cargo install stellar-cli`)
- Circom 0.5.46+

### 1. Clone & Install

```bash
git clone <repo>
cd feature-zk-api-credits

# Gateway
cd ts && npm install && cd ..

# Web app
cd web && npm install && cd ..

# Circuits
cd circuits && npm install && cd ..
```

### 2. Environment

```bash
cp .env.example .env
# Edit .env with your keys:
# - STELLAR_SECRET_KEY (gateway account)
# - OPENROUTER_API_KEY
# - GATEWAY_SECRET (shared between web app and gateway)
# - STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
# - GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
```

### 3. Build Circuits

```bash
cd circuits
# Compile circuits (requires circom on PATH)
circom deposit_membership.circom --r1cs --wasm -p bls12381
circom rln_nullifier.circom --r1cs --wasm -p bls12381
circom slash.circom --r1cs --wasm -p bls12381

# Trusted setup (single-contributor, dev-only)
node scripts/setup.js
cd ..
```

### 4. Build & Deploy Contract

```bash
cd zk-credits-contract
RUSTUP_TOOLCHAIN=1.94 stellar contract build

# Deploy to testnet
RUSTUP_TOOLCHAIN=1.94 stellar contract deploy \
  --wasm target/wasm32v1-none/release/zk_credits_contract.wasm \
  --source-account <your-stellar-key> \
  --network testnet \
  --network-passphrase "Test SDF Network ; September 2015" \
  --rpc-url https://soroban-testnet.stellar.org \
  -- \
  --admin <admin-address> \
  --treasury <treasury-address> \
  --vk-file-path <path-to-vk-json> \
  --usdc-contract <usdc-sac-id>
cd ..
```

### 5. Start Gateway

```bash
cd ts
npm run dev
# Gateway runs on http://localhost:3001
```

### 6. Start Web App

```bash
cd web
npm run dev
# Web app runs on http://localhost:3000
```

### 7. Run E2E Test

```bash
node scripts/e2e-test.js
```

### 8. Run Slash Demo

```bash
node scripts/slash-demo.js
```

## Use ZK Credits with Codex CLI

The first-party sidecar keeps `secret_k`, the recovery phrase, the Merkle
witness, ticket index, and loopback bearer on the developer machine. Render
receives only the shared compatibility bearer and a fresh body-bound ZK proof.
It supports both Chat Completions and the Responses API. Codex CLI uses the
Responses endpoint through an isolated `zk-credits` provider profile.

The companion requires Node.js 20 or newer. Install it globally, then run the
one-time Codex setup:

```bash
npm install --global zk-credits
zk-credits setup codex
```

Contributors can instead install it from this checkout:

```bash
cd packages/zk-credits-sidecar
npm ci
npm run build
npm link
```

Setup prompts for the funded identity's 24-word recovery phrase on a
non-echoing terminal if the identity is not already in the operating-system
credential store. It writes only an isolated, owner-only Codex profile; the
random loopback bearer is supplied by a command and is never stored in TOML.

Daily use is one command:

```bash
zk-credits codex
# Any normal Codex arguments also work, for example:
zk-credits codex exec "summarize this repository"
```

The command reuses or starts the sidecar in the background, waits until it is
ready, and then launches `codex --profile zk-credits`. Diagnose local setup
without starting anything with `zk-credits status`.

This flow is live-validated with Codex CLI 0.147.0: a normal `codex exec`
request generated its proof locally, passed the hosted Render verifier, and
returned an upstream model response without exposing the identity or loopback
bearer.

For another OpenAI-compatible client, the lower-level flow remains available:

```bash
zk-credits serve
eval "$(zk-credits env)"
# OPENAI_BASE_URL=http://127.0.0.1:3210/v1
# OPENAI_API_KEY=<random-loopback-token>
```

`ZK_CREDITS_MNEMONIC` is for a headless process only and is not persisted by
that path. The package verifies its pinned WASM, proving key, and
verification-key SHA-256 manifest before it proves; it never downloads proving
assets at runtime. The sidecar binds only `127.0.0.1`. Codex integration uses
its supported custom model-provider configuration; it does not install a
plugin, intercept TLS, or modify the user's default Codex profile.

## Project Structure

```
├── circuits/              Circom circuits (deposit, RLN, slash)
│   ├── deposit_membership.circom
│   ├── rln_nullifier.circom
│   ├── slash.circom
│   └── scripts/           Test & setup scripts
├── contracts/             Archived Solidity (superseded by Soroban)
├── zk-credits-contract/   Soroban smart contract (Rust)
│   └── contracts/zk-credits-contract/src/lib.rs
├── ts/                    Gateway (Node.js + Express + TypeScript)
│   ├── server.ts          OpenAI-compatible API gateway
│   ├── contract.ts        Soroban RPC client
│   ├── crypto.ts          Browser crypto (secret_k, BIP-39)
│   ├── prover.ts          Groth16 proof generation + caching
│   ├── providerAdapter.ts Pluggable upstream (OpenRouter)
│   └── storage.ts         IndexedDB abstraction
├── web/                   Web app (Next.js 16 + App Router)
│   └── src/
│       ├── app/
│       │   ├── api/       Checkout, webhook, keys, status routes
│       │   ├── dashboard/ Dashboard with status, keys, buy credits
│       │   ├── onboarding/secret_k generation + mnemonic backup
│       │   └── sign-in/   GitHub OAuth
│       └── lib/
│           ├── crypto.ts  Browser witness calculator
│           └── stellar.ts Contract read stub (M8)
├── packages/zk-credits-sidecar/
│   ├── circuits/          Pinned RLN resources and SHA-256 manifest
│   └── src/               Loopback transport, keychain identity, ticket ledger
└── scripts/
    ├── setup-testnet.sh   Testnet account setup
    ├── e2e-test.js        End-to-end test script
    ├── slash-demo.js      RLN slash demonstration
    └── demo-script.md    5-minute demo walkthrough
```

## API Reference

### Gateway Endpoints

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/health` | GET | None | Health check |
| `/v1/chat/completions` | POST | API key | OpenAI-compatible chat (ZK proof required) |
| `/v1/responses` | POST | API key | OpenAI-compatible Responses API (ZK proof required) |
| `/v1/membership-tree` | GET | None | Public parameter-free `{ root, leaves, layers }` snapshot |
| `/v1/api-keys` | POST | Gateway secret | Generate API key |
| `/v1/status/:commitment` | GET | None | User stats (calls, quota, keys) |
| `/v1/contract-status` | GET | None | On-chain contract state |
| `/v1/slash` | POST | None | Submit slash proof (stub) |

### Web App Routes

| Route | Description |
|---|---|
| `/` | Landing page |
| `/sign-in` | GitHub OAuth |
| `/dashboard` | Protected dashboard (status, keys, buy credits) |
| `/onboarding` | First-run: generate secret_k, mnemonic backup |
| `/api/checkout` | Stripe Checkout session creation |
| `/api/webhooks/stripe` | Stripe webhook handler |
| `/api/keys` | API key generation (proxies to gateway) |
| `/api/dashboard/status` | Dashboard status (proxies to gateway) |

## Contract

**Existing testnet deployment (legacy artifact set; not launch acceptance):** `CCJG427D5B2KCLQC4GNSUXLZU7T3455T763EEIX44DNLCUMLXYKGEE4R`

The launch contract must be redeployed after the fresh BLS12-381 ceremony so
its dedicated verification keys match the current circuits.

Functions:
- `deposit(depositor, commitment, new_root, amount)` — Register commitment + transfer USDC
- `spend(proof, pub_signals)` — Verify RLN proof + record nullifier
- `slash(slash_proof, pub_signals, commitment, submitter)` — Verify a nine-signal fork/removal proof, revoke membership, and split USDC
- `withdraw(withdrawal_proof, pub_signals, commitment, recipient)` — Verify a three-signal browser-secret removal proof, revoke membership, and withdraw unused credits

## Honest Caveats

1. **Custodial testnet flow:** Gateway co-signs the fee-sponsored withdrawal, so a disappearing gateway can still block withdrawal. It cannot unilaterally withdraw after the launch redeploy: the contract also requires the browser-secret membership-removal proof.
2. **Testnet only:** No real money. USDC is testnet faucet. Trusted setup is single-contributor dev-only.
3. **Single gateway:** Cross-gateway unlinkability is v2. v1 has one gateway — it can't link cryptographically, but could log timing patterns.
4. **Browser proving:** ~1.5s first call per session, cached after. Acceptable for demo, needs optimization for production.
5. **Network identity:** v1 hides payment identity, not IP. Tor/client-side relay is v2.
6. **On-chain VK:** Contract deployed with dummy VK. Gateway verifies off-chain with real VK. Full on-chain verification needs BLS12-381 point serialization.
7. **Client compatibility:** Codex CLI is supported through its custom Responses model-provider profile. Other clients must support a custom OpenAI-compatible base URL.

## Tech Stack

| Component | Technology |
|---|---|
| Circuits | Circom + snarkjs (`-p bls12381`) |
| Contract | Rust + soroban-sdk 26 |
| Chain | Stellar testnet (CAP-0059 BLS12-381) |
| Gateway | Node.js + Express + TypeScript |
| Web App | Next.js 16 + App Router + next-auth |
| Auth | GitHub OAuth |
| Payments | Stripe (test mode) |
| LLM | OpenRouter (400+ models) |
| Hash | MiMC (in-circuit), Keccak256 (archived Solidity) |

## License

MIT
