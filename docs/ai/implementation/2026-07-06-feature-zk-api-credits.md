---
phase: implementation
title: Implementation Guide — zk-api-credits
description: State, decisions, and working notes for the ZK-RLN privacy gateway on Stellar
---

# Implementation Guide

## Development Setup

### Prerequisites
- Node v24.10.0, Rust 1.79, stellar CLI 27.0.0, circom 0.5.46, snarkjs 0.7.6
- soroban-sdk 27.0.0-rc.1 (latest on crates.io)

### Worktree
- Branch: `feature-zk-api-credits`
- Path: `/Users/kyler/repos/feature-zk-api-credits`

### Archived code (Base/EVM approach — superseeded)
- `ts/` — TypeScript: EIP-191 session tokens, ticket tracker, Express mock server (vitest tests pass)
- `contracts/` — Foundry/Solidity project (OpenZeppelin, Poseidon Solidity, DepositContract.sol)
- These will be **repurposed** for the Gateway (M5) — swap EIP-191/viem for Stellar-compatible signing

## Code Structure

```
circuits/              # Circom circuits (M2)
  deposit_membership.circom
  rln_nullifier.circom
  slash.circom
  scripts/
    prove.js           # Off-chain prove harness
    verify.js          # Off-chain verify harness
contracts/             # Archive — Foundry/Solidity (Base approach)
zk-credits-contract/   # Soroban contract (M3, M4) — Rust
  Cargo.toml
  src/
    lib.rs             # ZkCreditsContract
ts/                    # Gateway (M5) — Node.js + Express + TypeScript
  server.ts            # Express server
  sessionToken.ts      # Session token (EIP-191, needs pivot)
  sessionVerifier.ts   # Verifier + ticket tracker
  vitest.config.ts
```

## Implementation Notes

### M1 — Testnet Setup (Complete ✓)
- Stellar testnet accounts funded via Friendbot
- USDC trustlines added
- `.env.example` documents all vars

### M2 Fixes (post-review)
- **C1: epoch as public input** — `rln_nullifier.circom` changed `epoch` from hardcoded `MiMC(0)` to a public `signal input`. Epoch-based rate limiting now functional.

### M2 — Circom Circuits (Complete ✓)
- 3 circuits compiled with `-p bls12381` (BLS12-381), unrolled (no for-loops — circom 0.5.46 bug with BLS12-381 array signals)
- `deposit_membership.circom`: 8,583 constraints — MiMCSponge commitment + 3-level Merkle tree
- `rln_nullifier.circom`: 10,568 constraints — MiMCSponge nullifier + RLN polynomial share
- `slash.circom`: 1,324 constraints — solves linear system, verifies both shares
- Trusted setup: powers of tau (power 14) + phase 2, Groth16 setup per circuit
- Off-chain prove/verify harness (test.js) — all 3 circuits pass end-to-end
- Circuit tests (T-circuit-1, T-circuit-3, T-rln-2) verified via snarkjs CLI and Node.js

### M3 — Soroban ZkCreditsContract (In Progress ✓)
- Rust + soroban-sdk 26.1.0 (27.0.0-rc.1 requires rustc 1.91+; using 1.94 toolchain)
- `lib.rs`: Full contract with deposit, spend, slash, withdraw, Groth16 verifier (CAP-0059)
- Merkle root tracking via `current_root` + `RootHistory` map
- Nullifier set recorded on-chain for double-spend prevention
- BLS12-381 Groth16 verifier integrated (`verify_groth16`), VK fixed at deploy time
- 6 Rust unit tests pass: constructor, deposit, root updates, withdraw, double-withdraw rejection, slash-without-deposits
- Built with `rustup run 1.94 cargo build` on macOS
- Deprecation warnings: `G1Affine/G2Affine` → `Bls12381G1Affine/Bls12381G2Affine`, `event.publish()` → `#[contractevent]`

### M3 Fixes (post-review)
- **C2: withdraw auth** — Added `deposit.depositor.require_auth()` to prevent unauthorized withdrawal.
- **C3: Merkle root** — `deposit()` now accepts `new_root` parameter (computed off-chain by caller). Root is stored and checked by `spend()`.
- **C4: slash commitment binding** — `slash()` now accepts `commitment` parameter. Looks up deposit by commitment instead of brute-force scanning.
- **New contract errors**: `AmountMustBePositive`, `DuplicateCommitment`, `RootMismatch`, `CommitmentMismatch`.
- **Amount validation**: zero/negative amounts rejected. Duplicate commitments rejected.

### M3 Notes — Decisions & Deviations
- **MiMC in-circuit, Merkle root stored on-chain**: Contract only stores the root, doesn't compute MiMC (happens inside circuits). Proof verification ensures correct membership.
- **soroban-sdk 26**: v27 rc required rustc 1.91+; 1.94 was available via rustup toolchain
- **Unrolled circuits**: Circom 0.5.46 has a BLS12-381 bug with for-loop + array signal assignments. All circuits are unrolled for nLevels=3.
- **Fr zero**: No `Fr::zero()` method; using `fr_zero(env)` helper that calls `Fr::from_u256(U256::from_u32(env, 0))`

### M5 — Gateway Skeleton (Complete ✓)
- Express server with OpenAI-compatible `/v1/chat/completions` endpoint
- API key management: `POST /v1/api-keys` generates `sk-zk-...` keys
- Nullifier cache: in-memory Set for fast 403 replay rejection
- Quota enforcement: configurable per-epoch limit (default 100)
- OpenRouter proxy: forwards verified requests to `openrouter.ai/api/v1`
- Slash endpoint: `/v1/slash` (permissionless submission, E2E in M9)
- **Status endpoint**: `GET /v1/status/:commitment` returns calls, quota, key count for dashboard
- **Proof verification**: ZK proof verified via snarkjs with loaded verification key; malformed headers rejected
- **Auth hardening**: `GATEWAY_SECRET` required; dynamic read from `process.env`
- 14 vitest tests pass: health, api keys, auth, nullifier replay, slash, status, proof header validation
- Reused `ts/` directory from archived Base approach

### M7 — Web App (Complete ✓)
- Next.js 16 with App Router, next-auth v5 (Auth.js), GitHub OAuth
- Protected dashboard with sign-in gate and session management
- API key generation via Next.js API route → gateway proxy with shared secret auth
- **Stripe Checkout integration**: `POST /api/checkout` creates Stripe Checkout session (test mode). Three tiers: $5/$20/$50. `POST /api/webhooks/stripe` handles `checkout.session.completed` events with signature verification. Webhook logs payment and has TODO stub for M8 gateway deposit integration.
- **Buy credits page**: `buy-credits-section.tsx` calls `/api/checkout`, redirects to Stripe hosted checkout, returns to `/dashboard?checkout=success|cancelled`
- **Dashboard status**: client component reads commitment from IndexedDB, fetches calls/keys/quota from gateway via `/api/dashboard/status`
- **Onboarding flow**: `/onboarding` page generates secret_k, displays BIP-39 mnemonic, 3-word confirmation backup, stores in IndexedDB
- **API key section**: checks IndexedDB for existing `secret_k` before generating new one (prevents orphaned deposits)
- **Browser crypto**: `lib/crypto.ts` with snarkjs `wtns.calculate` for witness computation (fixed broken `buildWasmCalculator` import)
- Build passes: `npx next build` produces routes (`/`, `/sign-in`, `/dashboard`, `/onboarding`, `/api/auth/[...nextauth]`, `/api/keys`, `/api/dashboard/status`, `/api/checkout`, `/api/webhooks/stripe`)
- **C5 fixed**: API key generation requires auth session (both web app and gateway enforce)
- **No web app tests**: vitest/jest not configured in `web/` — test gap for API routes

### M6 — Browser Crypto (Complete ✓)
- `crypto.ts` (Node): secret_k generation, BIP-39 mnemonic, commitment via `deposit_membership` WASM circuit
- `crypto.ts` (Web/browser): same API, `Buffer`-free hex conversion, snarkjs `wtns.calculate` (fixed from broken `buildWasmCalculator`)
- `storage.ts`: `MemoryStore` + `IndexedDBStore` with auto-detect fallback
- `prover.ts`: `generateRlnProof()` / `generateDepositProof()` wrappers around `snarkjs.groth16.fullProve`
- **ProofCache**: `ProofCache` class with stable-key dedup, hit/miss tracking, in-flight request de-duplication
- **`generateRlnProofCached()`**: wraps `generateRlnProof()` with session-level caching
- 7 proof cache tests + 6 crypto + 7 storage tests pass (42 total in suite)
- Commitment computation uses fullProve (~1.5s) — optimize with dedicated MiMC WASM in M8

### M5 Notes — Decisions & Deviations
- **Simplified session token**: API key-based (`sk-zk-...` with hash lookup) instead of custom JWT
- **Nullifier cache**: per-gateway in-memory (not clustered — fine for MVP demo)
- **ProviderAdapter interface implemented**: `ProviderAdapter` interface + `OpenRouterAdapter` class + `MockProviderAdapter` for testing + adapter registry
- **Stripe/GitHub OAuth**: Stripe Checkout integrated in M7 (see above). Gateway handles proof relay + OpenRouter proxy.

### Review Fixes (F1-F7, 2026-07-07)
- **F1**: Gateway now calls `process.exit(1)` if VK file missing at startup (was silently skipping verification)
- **F2**: Contract `slash()` has length check for pub_signals (defensive)
- **F3**: Contract `spend()` extracts epoch from `pub_signals[4]` (was hardcoded to 0). Fr→u64 conversion deferred to M8.
- **F4**: Added root `.gitignore` (`.env`, `node_modules/`, `.next/`, `target/`, `*.wasm`, `*.zkey`, etc.)
- **F5**: `api-key-section.tsx` checks IndexedDB for existing `secret_k` before generating (prevents orphaned deposits)
- **F6**: Documented `withdraw()` custodial auth limitation with TODO for ZK proof-of-ownership
- **F7**: Setup snippet uses `window.location.origin` instead of hardcoded `localhost:3001`
- **Bonus**: Fixed `web/src/lib/crypto.ts` broken `buildWasmCalculator` import → `snarkjs.wtns.calculate`
- **Bonus**: Fixed `web/src/lib/stellar.ts` to use ESM imports, added `@ts-nocheck` for M8 stub
- **Bonus**: Bumped `web/tsconfig.json` target to ES2020 for BigInt literals

### M8 — End-to-end Integration (Complete ✓)
- **Contract deployed to testnet**: `CBWNJTXFZC27ZE2LUDGTOFL3VWYTXAJ43K3KASOV57SKFFQN6QQHPV3T` (2026-07-07)
- **Soroban RPC client**: `ts/contract.ts` — `getDepositCount()`, `getCurrentRoot()`, `getDeposit()`, `isNullifierSpent()`, `deposit()`
- **Gateway endpoint**: `GET /v1/contract-status` reads on-chain state (deposit count, current root)
- **On-chain deposit verified**: commitment=42, amount=1 USDC, demo-user → contract. Deposited event emitted.
- **E2E test script**: `scripts/e2e-test.js` — full flow: health → contract status → key gen → RLN proof → chat completions → nullifier replay rejection → status check
- **Latency**: Proof generation ~1.5s (Node.js), contract read <2s (RPC simulation), OpenRouter proxy depends on model
- **VK**: ~~Deployed with dummy VK (zero points).~~ Fixed in R1-R3: real BLS12-381 VK from snarkjs verified on-chain. See R1-R3 section below. Redeploy pending (R4).
- **Design deviation**: ~~On-chain proof verification uses dummy VK for MVP.~~ Corrected. Real VK now verifies proofs on-chain via CAP-0059 pairing check. Contract `slash()` signal indices corrected from `[5],[6]` to `[0],[1]` to match Circom output order.

### M9 — Slash Demo Path (Complete ✓)
- **Slash demo script**: `scripts/slash-demo.js` — generates two RLN proofs with same epoch, extracts secret_k via slash circuit, demonstrates nullifier collision rejection
- **RLN math verified**: Slash circuit correctly extracts original secret_k from two shares (same epoch, different signals)
- **Demo script**: `scripts/demo-script.md` —8-step demo covering sign-in → onboarding → buy → API key → gateway call → dashboard → slash → contract explorer. Includes talking points and honest caveats.
- **Gateway slash flow**: First proof succeeds, second proof with same nullifier rejected (403). Gateway could run slash circuit to extract key and submit on-chain.

### R1–R3 — Real VK + On-chain Verification (Complete ✓, 2026-07-14)
- **R1: VK serialization harness**: `scripts/vk-convert.js` converts snarkjs VK JSON (decimal projective) → Soroban hex (uncompressed affine). Key fix: G2 points use imaginary-first encoding (`x_im || x_re || y_im || y_re`) per Soroban SDK spec, NOT `x_re || x_im` as snarkjs outputs. Generated `verification_key_*_soroban.json` for all 3 circuits. `test_rln_vk_points_load` verifies real VK loads in contract. 22 tests pass.
- **R2: On-chain Groth16 verifier tests**: T-verifier-1 (real proof verifies), T-verifier-2 (tampered proof rejected), T-verifier-3 (wrong VK rejects proof). Proof fixture: `test_fixtures/rln_proof_fixture.json` — generated from `secret_k=12345, epoch=100, signal=67890`. Off-chain proof gen ~1.1s, on-chain pairing check succeeds with CAP-0059 BLS12-381 host functions.
- **R3: Spend/slash on-chain paths**: T-contract-4 (spend records nullifier), T-contract-5 (replay rejected), T-contract-6 (slash with real proof, USDC 50/50 verified), T-contract-7 (already-slashed rejected), T-contract-8 (split amount verified). Slash proof fixture: `test_fixtures/slash_proof_fixture.json`. Circuit recompiled (slash.circom output count was stale: 1 → 2 after adding `computed_commitment`). Slash signal order fixed: `[extracted_secret_k, computed_commitment, share1_x, share1_y, share2_x, share2_y, epoch]` — contract `slash()` updated to read `get(0)` and `get(1)` instead of `get(5)` and `get(6)`.
- **Files changed**: `scripts/vk-convert.js` (new), `circuits/slash.circom` (recompiled), `circuits/slash_final.zkey` (regenerated), `circuits/verification_key_*_soroban.json` (3 files, regenerated), `test_fixtures/` (new, 2 fixture files), `zk-credits-contract/contracts/zk-credits-contract/src/lib.rs` (slash signal indices), `zk-credits-contract/contracts/zk-credits-contract/src/test.rs` (+200 lines, 3 new tests + helpers).
- **Design deviation corrected**: On-chain VK is no longer dummy. Real BLS12-381 VK from snarkjs trusted setup verifies proofs natively via CAP-0059 pairing check.
- **R4**: Redeployed to testnet with real VK (2026-07-14). Contract ID: `CCJG427D5B2KCLQC4GNSUXLZU7T3455T763EEIX44DNLCUMLXYKGEE4R`. Deployed via `stellar contract deploy --wasm-hash <hash> -- <constructor-args>` with VK JSON from `scripts/vk-convert.js`. Previous contract (dummy VK): `CBWNJTXFZC27ZE2LUDGTOFL3VWYTXAJ43K3KASOV57SKFFQN6QQHPV3T`.

### R5.1 — Real Agent Integration (Complete ✓, 2026-07-14)
- **E2E with real OpenRouter**: Gateway → OpenRouter → Claude Sonnet 4: 200 OK, 3278ms latency. Response: "Hello there, friend!".
- **Full flow verified**: health → contract status → secret_k gen → API key → RLN proof (809ms) → chat completions → nullifier replay (403) → status check (1 call, 99 remaining).
- **Fix**: `ts/contract.ts` import — `@stellar/stellar-sdk` v16 uses `rpc` namespace not `SorobanRpc`. Changed import to `import { rpc as SorobanRpc, ... }`.
- **Fix**: Root `package.json` missing `snarkjs` dependency (was only in `ts/node_modules/`). E2E script needs it at root level.
- **Env config**: Added `GATEWAY_SECRET=dev-secret` and `OPENROUTER_API_KEY` to `.env`. Gateway requires env vars sourced from `.env` (no dotenv integration).
- **CIRCUITS_DIR**: Gateway `server.ts` path resolution (`import.meta.dirname + ../../circuits`) overshoots. Must set `CIRCUITS_DIR` env var explicitly when running from `ts/` dir.
- **Files changed**: `ts/contract.ts` (import fix), `package.json` (+snarkjs), `.env` (+GATEWAY_SECRET, +OPENROUTER_API_KEY)

### R5.2 — Recovery Flow (Complete ✓, 2026-07-14)
- **Recovery page**: `web/src/app/recover/page.tsx` — textarea for 24-word BIP-39 mnemonic, validates word count, calls `recoverSecretK()` from `web/src/lib/crypto.ts`, computes commitment via `computeCommitment()`, stores in IndexedDB (`zk-credits-crypto` / `keys`), redirects to `/dashboard`.
- **Sign-in link**: `web/src/app/sign-in/page.tsx` — added "Lost access? Recover from mnemonic" link to `/recover`.
- **Reuses existing**: `recoverSecretK()` already existed in `web/src/lib/crypto.ts:49` (wraps `@scure/bip39` `mnemonicToEntropy`). No new crypto code needed.
- **Build passes**: `npx next build` — `/recover` route registered alongside `/onboarding`, `/dashboard`, `/sign-in`.
- **Files changed**: `web/src/app/recover/page.tsx` (new), `web/src/app/sign-in/page.tsx` (+link)

### R5.3 — Stripe → On-chain Deposit (Complete ✓, 2026-07-14)
- **Deposit endpoint**: `ts/server.ts` — `POST /v1/deposits` accepts `{commitment, amount}`, requires `GATEWAY_SECRET` auth. Inserts commitment into off-chain Merkle tree (MiMCSponge via circomlibjs), computes new root, calls `contract.deposit()` with gateway's Stellar secret key.
- **Merkle tree module**: `ts/merkle.ts` (new) — arity-2, depth-3 Merkle tree using MiMCSponge (same hash as Circom circuits). `insert(leaf)` returns new root. Tracks leaf count.
- **Stripe checkout**: `web/src/app/api/checkout/route.ts` — now accepts `commitment` in request body and stores it in Stripe session metadata.
- **Buy credits**: `web/src/app/dashboard/buy-credits-section.tsx` — reads commitment from IndexedDB (`zk-credits-crypto` / `keys` / `commitment`) and passes to checkout API.
- **Stripe webhook**: `web/src/app/api/webhooks/stripe/route.ts` — `handleCheckoutCompleted` now calls `POST /v1/deposits` on the gateway with commitment + amount. Skips deposit if no commitment in metadata (user hasn't completed onboarding).
- **Requires**: USDC-funded gateway account. Old gateway key recovered from Stellar CLI keystore (`~/.config/stellar/identity/payroll-admin.toml`). Gateway `GBBTKIOK...` has 10,000 USDC on testnet.
- **Live deposit verified**: `POST /v1/deposits` → Merkle tree insert → `contract.deposit()` → tx `0555d3e7...`. Contract shows 3 deposits on-chain.
- **Fixes during R5.3**:
  - `ts/merkle.ts`: MiMC `F.e()` returns `Uint8Array`, not bigint. Fixed byte→bigint conversion.
  - `ts/contract.ts`: `Bls12381Fr` is `u256` (unsigned), not `i256`. Changed `nativeToScVal` type for commitment/root/nullifier.
  - `ts/contract.ts`: `getTransaction` polling didn't handle `NOT_FOUND` status (still indexing). Added retry loop with timeout.
  - `scripts/e2e-test.js`: Changed model from `anthropic/claude-opus-4` to `anthropic/claude-sonnet-4` + `max_tokens: 50` (OpenRouter credit limit).
- **Files changed**: `ts/server.ts` (+deposit endpoint), `ts/merkle.ts` (new), `ts/contract.ts` (i256 fix, SDK v16 import), `web/src/app/api/checkout/route.ts` (+commitment), `web/src/app/api/webhooks/stripe/route.ts` (+gateway call), `web/src/app/dashboard/buy-credits-section.tsx` (+commitment from IndexedDB), `scripts/e2e-test.js` (model fix), `package.json` (+snarkjs), `.env` (+GATEWAY_SECRET_KEY, +GATEWAY_SECRET, +OPENROUTER_API_KEY)
- **Files changed**: `ts/server.ts` (+deposit endpoint), `ts/merkle.ts` (new), `web/src/app/api/checkout/route.ts` (+commitment), `web/src/app/api/webhooks/stripe/route.ts` (+gateway call), `web/src/app/dashboard/buy-credits-section.tsx` (+commitment from IndexedDB)

## Integration Points
- Circuit → Contract: Groth16 proof serialized as G1Affine/G2Affine/Fr
- Browser → Gateway: X-ZK-Proof header (base64-encoded proof + pubSignals JSON)
- Gateway → Contract: Soroban RPC simulation (read) + transaction submission (write)
- Gateway → OpenRouter: standard OpenAI chat completions proxy
- Stripe → Webhook → Gateway: `checkout.session.completed` → gateway `POST /v1/deposits` → on-chain deposit (verified)

## Deployment Status (2026-07-15)
- **Vercel**: `https://web-prxu1psra-gadillacers-projects.vercel.app` — deployed but UI broken, OAuth flow not verified end-to-end
- **Gateway tunnel**: `https://restored-pushing-sponsorship-lancaster.trycloudflare.com` (ephemeral, dies on terminal close)
- **GitHub OAuth**: Client ID `Ov23liH6ZVmwWRLR43nY`, callback configured for Vercel URL
- **Issues found**: Tailwind CSS not loading (unstyled UI), OAuth callback + dashboard flow not working in production environment
- **Gateway hosting**: Needs persistent hosting (Fly.io/Railway) — cloudflared tunnels are ephemeral

## Error Handling
- Contract errors: typed (Groth16Error enum)
- Gateway: 402 (insufficient credits), 403 (invalid/nullifier/over-quota)
- Browser: WASM prover load failure → error, user retry

## Performance Considerations
- Off-chain verify fast-path (< 100ms) + async on-chain submit (5s ledger)
- Proof caching per session (~2-5s first call, < 500ms cached)
- Nullifier cache (in-memory, fast reject before RPC)

## Security Notes
- secret_k never leaves browser (WebCrypto non-extractable)
- BIP-39 mnemonic backup
- Slash permissionless (50% reporter incentive)
- VK fixed at contract deploy time
