> **Archived worktree:** preserved for reference; active development is in `feature-base-zk-credits`.

# zk-api-credits

Anonymous RLN-rate-limited API credits for coding agents on Stellar.

> Level 4 status (September 11, 2026): the consent-gated evaluation layer,
> isolated persistence schema, wallet-proof flow, checkout linking,
> observability controls, synthetic monitor, responsive UI, and browser tests
> are implemented. The ten-person live cohort, service redeployments, and
> public submission evidence remain operational gates. See
> [`docs/evidence/level4/README.md`](docs/evidence/level4/README.md).

## What It Is

A privacy gateway between coding agents (Claude Code, Codex, OpenCode, Cline) and LLM APIs (OpenRouter, 400+ models). Developers buy anonymous credits with a card; agents call LLMs via ZK-RLN proofs; over-quota calls slash deposits on-chain.

**The gateway cannot link a call to a deposit.** ZK enforced.

## How It Works

1. Developer signs in with GitHub, then either buys a normal credit tier or
   explicitly enrolls in the optional `$1` Stripe test-mode evaluation
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
# - EVALUATION_HMAC_SECRET (a separate high-entropy evaluation identity key)
# - DATABASE_URL (required by the deployed evaluation service; local tests use memory)
# - EVALUATION_STORE=memory (optional local/smoke-test override; never use for a cohort)
# - NEXT_PUBLIC_POSTHOG_KEY / NEXT_PUBLIC_POSTHOG_HOST (optional, opt-in only)
# - SENTRY_DSN / SENTRY_AUTH_TOKEN (optional error monitoring)
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

# Browser E2E suite
(cd web && npm run test:e2e)
```

### 8. Run Slash Demo

```bash
node scripts/slash-demo.js
```

## Agent Tooling

Interactive browser work uses the Playwright CLI rather than a Playwright MCP server. From the project root, start the local app and use commands such as:

```bash
playwright-cli open http://localhost:3000
playwright-cli snapshot
playwright-cli click "text=Get Started"
playwright-cli screenshot
```

Vercel operations use the Vercel CLI from the web app directory:

```bash
cd web
vercel ls
vercel deploy
vercel inspect <deployment-url-or-id>
vercel logs <deployment-url-or-id>
```

Both CLIs must be installed and available on `PATH`. The Playwright test suite remains a separate automated runner invoked through `npm run test:e2e`.

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
│   ├── evaluation.ts      Isolated consent/wallet/feedback domain
│   ├── evaluation-postgres.ts  Evaluation-only Postgres adapter
│   ├── evidence-export.ts Redacted ten-participant evidence exporter
│   ├── crypto.ts          Browser crypto (secret_k, BIP-39)
│   ├── prover.ts          Groth16 proof generation + caching
│   ├── providerAdapter.ts Pluggable upstream (OpenRouter)
│   └── storage.ts         IndexedDB abstraction
├── web/                   Web app (Next.js 16 + App Router)
│   └── src/
│       ├── app/
│       │   ├── api/       Checkout, webhook, keys, status, evaluation routes
│       │   ├── dashboard/ Dashboard with status, keys, buy credits
│       │   ├── onboarding/secret_k generation + mnemonic backup
│       │   └── sign-in/   GitHub OAuth
│       └── lib/
│           ├── crypto.ts  Browser witness calculator
│           └── stellar.ts Soroban contract read client
└── scripts/
    ├── setup-testnet.sh   Testnet account setup
    ├── e2e-test.js        End-to-end test script
    ├── slash-demo.js      RLN slash demonstration
    └── demo-script.md    5-minute demo walkthrough
```

## Level 4 evaluation interfaces

The evaluation is deliberately separate from anonymous private API use. It
stores consent, a restricted raw SEP-53 wallet proof, one confirmed testnet
deposit, and fixed feedback fields. It never joins those records to prompts,
request bodies, API keys, mnemonics, commitments, proofs, or private-call
content. Public evidence exposes only an `L4-…` code, a redacted wallet, the
full testnet transaction hash/link, completion time, and aggregate feedback.

Browser-facing routes:

| Route | Method | Purpose |
|---|---|---|
| `/api/evaluation/enroll` | POST | Record explicit consent and return the public participant code |
| `/api/evaluation/status` | GET | Return the current participant's safe checklist state |
| `/api/evaluation/challenge` | POST | Issue a one-time ten-minute signing challenge |
| `/api/evaluation/wallet-proof` | POST | Verify a Freighter Stellar testnet signature |
| `/api/evaluation/feedback` | POST | Store the six fixed feedback fields |
| `/api/evaluation/analytics` | POST | Return the opaque analytics ID only after opt-in |
| `/api/checkout/receipt` | GET | Return an authenticated, ownership-checked receipt |

Internal gateway variants require both `GATEWAY_SECRET` and the full HMAC
participant ID. Run the migration and exporter from `ts/`:

```bash
npm run db:migrate
npm run evidence:export
```

The exporter refuses to produce a submission artifact until ten distinct
participants have consent, valid wallet proofs, unique wallets, unique
confirmed deposits, and feedback. Raw signatures and identity mappings never
enter the generated Markdown/JSON.

## API Reference

### Gateway Endpoints

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/health` | GET | None | Health check |
| `/v1/chat/completions` | POST | API key | OpenAI-compatible chat (ZK proof required) |
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

**Testnet:** `CBDGHYF5CQM527IM3GVDDWXLDB4XNPA5BT4KXFVCSJZTQIOFZGOIHAIT`

Functions:
- `deposit(depositor, commitment, new_root, amount)` — Register commitment + transfer USDC
- `spend(proof, pub_signals)` — Verify RLN proof + record nullifier
- `slash(slash_proof, pub_signals, commitment, submitter)` — Extract secret_k + split USDC
- `withdraw(commitment, recipient)` — Withdraw unused credits

## Honest Caveats

1. **Custodial v1:** Gateway holds USDC; user holds `secret_k`. Gateway cannot spend without user's proof (contract enforces), but if gateway disappears, user needs independent withdrawal path.
2. **Testnet only:** No real money. USDC is testnet faucet. Trusted setup is single-contributor dev-only.
3. **Single gateway:** Cross-gateway unlinkability is v2. v1 has one gateway — it can't link cryptographically, but could log timing patterns.
4. **Browser proving:** ~1.5s first call per session, cached after. Acceptable for demo, needs optimization for production.
5. **Network identity:** v1 hides payment identity, not IP. Tor/client-side relay is v2.
6. **On-chain VK:** Deployment inputs use generated real BLS12-381 VK points in `circuits/verification_key_*_soroban.json`; testnet deployment still requires funded credentials and the deployed contract configuration.
7. **Evaluation evidence:** Ten real humans, live service health, configured PostHog/Sentry evidence, current screenshots, and the unlisted demo recording are release gates; local automated tests do not substitute for them.

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
| Hash | MiMC (in-circuit), SHA-256 HMAC (evaluation pseudonyms), Keccak256 (archived Solidity) |

## License

MIT
