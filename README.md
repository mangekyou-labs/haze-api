# zk-api-credits

Anonymous RLN-rate-limited API credits for coding agents on Stellar.

## Public Deployments

- **Web Application:** https://feature-zk-api-credits-gadillacers-projects.vercel.app
- **Gateway API:** https://zk-credits-gateway.onrender.com
- **Soroban Testnet Contract:** `CBDGHYF5CQM527IM3GVDDWXLDB4XNPA5BT4KXFVCSJZTQIOFZGOIHAIT`

## What It Is

A privacy gateway between base-URL-configurable coding agents and LLM APIs (OpenRouter, 400+ models). Developers buy anonymous credits with testnet USDC; a local sidecar adds a ZK-RLN proof to each LLM request; ticket forks slash deposits on-chain.

**The gateway cannot link a call to a deposit.** ZK enforced.

## How It Works

1. Developer signs in with GitHub on the web app, generates a private browser secret (`secret_k`) backed up by a 24-word recovery phrase, and funds Starter ($1.00 for 100 tickets) with testnet USDC/card
2. Browser stores `secret_k` + commitment locally (never sent to any server)
3. Gateway mints on-chain USDC deposit referencing the commitment into the Merkle tree
4. Developer imports the 24-word recovery phrase into their local agent environment via `zk-credits import-mnemonic` (stored in OS keychain)
5. Agent calls LLMs through the local loopback sidecar with client-side ZK-RLN proofs (100 private tickets `0..99` per deposit)
6. Gateway verifies proof (off-chain), forwards to OpenRouter, returns response
7. Over-quota: nullifier collision → RLN math extracts `secret_k` → slash on-chain

## Quick Start (Coding Agents)

Get started in 2 minutes without building from source:

### 1. Web App Setup
1. Open https://feature-zk-api-credits-gadillacers-projects.vercel.app
2. **Sign in with GitHub** to access the dashboard.
3. Click **Generate Identity & Key** and write down your **24-word recovery phrase**.
4. In **Buy Credits**, purchase the Starter package ($1.00 for 100 private tickets).

### 2. Install CLI & Import Identity
```bash
npm install --global zk-credits
zk-credits import-mnemonic
# Enter your 24-word phrase when prompted (saved securely to OS keychain)
```

### 3. Run with your Coding Agent

#### Cline CLI
```bash
zk-credits cline "summarize this repository"
```

#### Claude Code CLI
```bash
zk-credits claude -p "summarize this repository"
```

#### Codex CLI & Codex SDK
```bash
zk-credits setup codex
zk-credits codex "summarize this repository"
```

---

## Developers: Building from Source

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

## Use ZK Credits with Coding Agents

The first-party sidecar keeps `secret_k`, the recovery phrase, the Merkle
witness, ticket index, and loopback bearer on the developer machine. Render
receives only the shared compatibility bearer and a fresh body-bound ZK proof.
It supports Chat Completions, Responses, and Anthropic Messages endpoints.

The published `zk-credits@0.1.2` release on npm provides full zero-configuration support for **Cline**, **Claude Code**, and **Codex**:

```bash
npm install --global zk-credits
```

### 1. Cline CLI

```bash
zk-credits cline "summarize this repository"
# Any normal Cline arguments also work:
zk-credits cline --json "audit this package"
```

Launches Cline with an isolated `openai-compatible` provider profile pointing to
the loopback sidecar (`http://127.0.0.1:3210/v1`) without modifying `~/.cline`.
Live-validated with Cline CLI 3.0.51.

### 2. Codex CLI and Codex SDK

Interactive CLI launcher:

```bash
zk-credits setup codex
zk-credits codex "summarize this repository"
```

TypeScript SDK (`@openai/codex-sdk`):

```ts
import { Codex } from '@openai/codex-sdk';
import { buildCodexSdkOptions, buildCodexThreadOptions } from 'zk-credits/codex';

const codex = new Codex(buildCodexSdkOptions({ loopbackBaseUrl: 'http://127.0.0.1:3210', token, codexHome }));
const thread = codex.startThread(buildCodexThreadOptions({ model: 'openai/gpt-4o-mini' }));
const result = await thread.run('Reply with: [CODEX-SDK-LIVE]');
```

Live-validated with `@openai/codex-sdk` and Codex CLI 0.150.1.

### 3. Claude Code CLI

```bash
zk-credits claude -p "summarize this repository"
# Any standard Claude Code arguments also work:
zk-credits claude --output-format json --max-turns 1 "audit this package"
```

Launches Claude Code with an isolated `CLAUDE_CONFIG_DIR` (`~/.zk-credits/claude`)
and `ANTHROPIC_BASE_URL=http://127.0.0.1:3210`, routing Anthropic Messages requests
through the sidecar's proof-bound Chat Completions gateway adapter.
Live-validated with Claude Code CLI 2.1.144.

### 4. Other OpenAI-Compatible Clients

```bash
zk-credits serve
eval "$(zk-credits env)"
# OPENAI_BASE_URL=http://127.0.0.1:3210/v1
# OPENAI_API_KEY=<random-loopback-token>
```
`ZK_CREDITS_MNEMONIC` is for a headless process only and is not persisted by
that path. The package verifies its pinned WASM, proving key, and
verification-key SHA-256 manifest before it proves; it never downloads proving
assets at runtime. The sidecar binds only `127.0.0.1`. The coding-agent
integrations use supported custom provider configuration; they do not install
a plugin, intercept TLS, or replace the user's default agent profile.

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

**Launch testnet deployment:** `CBDGHYF5CQM527IM3GVDDWXLDB4XNPA5BT4KXFVCSJZTQIOFZGOIHAIT`

Functions:
- `deposit(depositor, commitment, new_root, amount)` — Register commitment + transfer USDC
- `spend(proof, pub_signals)` — Verify RLN proof + record nullifier
- `slash(slash_proof, pub_signals, commitment, submitter)` — Verify a nine-signal fork/removal proof, revoke membership, and split USDC
- `withdraw(withdrawal_proof, pub_signals, commitment, recipient)` — Verify a three-signal browser-secret removal proof, revoke membership, and withdraw unused credits

## Honest Caveats

1. **Testnet only:** No real money. USDC is testnet faucet.
2. **100-ticket specialization:** The Starter package is specialized to exactly 100 private ticket indices (`0..99`) per deposit.
3. **Variable-cost refunds deferred:** Fixed ticket price per call; variable-cost refunds for smaller model responses are deferred to v2.
4. **Single-contributor trusted setup:** Groth16 BLS12-381 ceremony is single-contributor dev-only.
5. **Custodial gateway-mediated withdrawal:** Gateway co-signs the fee-sponsored withdrawal. The gateway can block by disappearing, but the gateway cannot unilaterally redirect funds because the contract requires the browser-secret membership-removal proof.
6. **Async per-call on-chain audit:** The gateway verifies ZK proofs off-chain for zero-latency forwarding, then asynchronously submits proofs to Soroban `spend()` for durable on-chain audit.
7. **Single gateway timing:** v1 has one gateway — it cannot link calls cryptographically to deposits, but a single gateway operator could observe request timing patterns.
8. **Browser proving latency:** Proving in the browser adds latency (~1.5s first call per session, cached after).
9. **Network identity / IP not hidden:** v1 hides payment and deposit identity, not network IP. Tor/client-side relay is v2.
10. **Client compatibility:** First-party zero-configuration companions are live-validated for `zk-credits cline` (Cline CLI), Codex SDK / `zk-credits codex`, and `zk-credits claude` (Claude Code print-mode). Other clients must accept a custom OpenAI-compatible base URL.
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
