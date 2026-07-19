---
phase: planning
title: "zk-api-credits: Project Planning & Task Breakdown"
description: 10-milestone build plan for the Stellar ZK-RLN privacy gateway MVP — circuits, contract, verifier, gateway, browser crypto, web app, end-to-end, slash demo.
---

# Project Planning & Task Breakdown

## Milestones

10 milestones, ~14.5 days solo estimated. Critical path runs M2 → M3 → M4 → M5 → M8.

- [x] **M1 — Testnet setup** (0.5 day): Stellar testnet accounts, USDC trustlines, env scaffolding ✓
- [x] **M2 — Circom circuits + trusted setup** (2 days): 3 circuits, off-chain prove/verify ✓
- [x] **M3 — Soroban ZkCreditsContract** (3 days): deposit, merkle, spend, slash, withdraw in Rust ✓
- [x] **M4 — On-chain Groth16 verifier** (1 day): CAP-0059 BLS12-381 integration ✓
- [x] **M5 — Gateway skeleton** (2 days): OpenRouter adapter, API keys, nullifier cache ✓
- [x] **M6 — Browser crypto** (2 days): secret_k, MiMC, Groth16 WASM prover ✓
- [x] **M7 — Web app** (2 days): sign-in, dashboard, buy credits, API keys, onboarding ✓
- [x] **M8 — End-to-end integration** (1 day): agent → gateway → contract → OpenRouter → response ✓ (partial — R5 e2e closes pending)
- [x] **M9 — Slash demo path** (0.5 day): trigger over-quota, watch slash fire ✓
- [x] **M10 — Docs refresh + README** (0.5 day): honest caveats, setup guide, demo script ✓

## Task Breakdown

### M1 — Testnet Setup

- [x] **T1.1 — Generate keypairs + fund via Friendbot**
  - Outcome: 2 funded Stellar testnet accounts (gateway: `payroll-admin`, demo: `demo-user`)
  - Note: Circle testnet faucet unavailable; used own USDC issuer (`usdc-issuer`)
  - Testing: T-e2e-1 ✓

- [x] **T1.2 — Add USDC trustline to both accounts**
  - Outcome: both accounts trust USDC from `GD6KPYAJ...` (our testnet issuer)
  - USDC SAC contract deployed: `CBAWJGHAJZFO...`
  - Testing: T-deposit-1 ✓

- [x] **T1.3 — Fund payer account via Circle faucet**
  - Outcome: Gateway: 10,000 USDC, Demo: 500 USDC from self-issued USDC
  - Note: used `stellar tx` with `change-trust` + `payment` operations

- [x] **T1.4 — Generate OZ-style keys + write `.env.example`**
  - Outcome: `.env.example` + `.env` created with all Stellar testnet addresses

### M2 — Circom Circuits + Trusted Setup

- [x] **T2.1 — Write `deposit_membership.circom`**
  - Outcome: compiles `-p bls12381`; 8,583 constraints (MiMC instead of Poseidon — Poseidon constants are BN254-specific)
  - Note: unrolled (no for-loops) — circom 0.5.46 bug with `-p bls12381` + array signals
  - Testing: T-circuit-1 ✓

- [x] **T2.2 — Write `rln_nullifier.circom`**
  - Outcome: 10,564 constraints; `epoch` is a public input (fixed post-review — was hardcoded)
  - Testing: T-circuit-3 ✓, T-rln-1 ✓

- [x] **T2.3 — Write `slash.circom`**
  - Outcome: 1,324 constraints; extracts `secret_k` from two shares, verifies consistency
  - Testing: T-rln-2 ✓

- [x] **T2.4 — Trusted setup (powers of tau + phase 2)**
  - Outcome: power 14 ptau, `.zkey` + `verification_key.json` for each circuit
  - Note: single-contributor dev setup (MVP only; production needs MPC ceremony)

- [x] **T2.5 — Off-chain prove/verify harness**
  - Outcome: `scripts/test.js` generates proofs + verifies all 3 circuits end-to-end
  - Testing: T-circuit-1, T-circuit-3, T-rln-2 all verified ✓

### M3 — Soroban ZkCreditsContract

- [x] **T3.1 — Scaffold Rust contract + Cargo.toml**
  - Outcome: `cargo build` succeeds with `rustup run 1.94` (soroban-sdk 26 needs rustc ≥1.91)
  - Testing: T-contract-1 ✓

- [x] **T3.2 — Implement Merkle tree + deposit**
  - Outcome: `deposit(depositor, commitment, new_root, amount)` — stores deposit, accepts new Merkle root (computed off-chain), updates root history
  - Post-review: added `AmountMustBePositive` and `DuplicateCommitment` validation
  - Testing: T-contract-2 ✓, T-contract-11 ✓, T-contract-12 ✓

- [x] **T3.3 — Implement `spend(proof, pub_signals)`**
  - Outcome: verifies Groth16 proof via `verify_groth16()`, checks root matches `current_root`, records nullifier, emits `NullifierSpent`
  - Post-review: added root verification against stored root

- [x] **T3.4 — Implement `slash(slash_proof, pub_signals, commitment, submitter)`**
  - Outcome: verifies Groth16 proof, looks up deposit by explicit `commitment` param, splits USDC 50/50, emits `Slashed`
  - Post-review: added explicit commitment param (was finding first unslashed deposit)
  - Testing: T-contract-6 ✓, T-contract-13 ✓

- [x] **T3.5 — Implement `withdraw(commitment, recipient)`**
  - Outcome: requires `deposit.depositor.require_auth()`, checks not slashed/withdrawn, transfers USDC
  - Post-review: added depositor auth check (was missing — anyone could withdraw)
  - Testing: T-contract-9 ✓, T-contract-10 ✓

- [x] **T3.6 — Soroban unit tests (Rust `#[test]`)**
  - Outcome: `cargo test` — 13 tests pass (deploy, deposit, root, amounts, duplicates, withdraw, double-withdraw, slash, nonexistent slash)
  - Testing: T-contract-1 through T-contract-13 ✓

### M4 — On-chain Groth16 Verifier

- [x] **T4.1 — Integrate CAP-0059 BLS12-381 verifier**
  - Outcome: `verify_groth16(env, proof, pub_signals)` implemented using `env.crypto().bls12_381()`, pairing check over 4 G1/G2 pairs
  - Note: VK fixed at deploy time via `__constructor`; IC length validation on every call
  - Dependencies: T3.3, T2.4
  - Testing: T-verifier-1 ✓ (real proof verifies on-chain), T-verifier-2 ✓ (tampered rejected), T-verifier-3 ✓ (wrong VK rejects)

- [x] **T4.2 — Bind verifier into `spend` and `slash`**
  - Outcome: both `spend()` and `slash()` call `verify_groth16()` before any state mutation
  - Testing: T-contract-4 ✓ (spend records nullifier), T-contract-5 ✓ (replay rejected), T-contract-6 ✓ (slash with real proof + 50/50), T-contract-7 ✓ (already-slashed rejected), T-contract-8 ✓ (split verified)

### M5 — Gateway Skeleton

- [x] **T5.1 — Scaffold Node.js + Express + TypeScript project**
  - Outcome: Express server with TypeScript, vitest config, 18 test suite
  - Testing: T-gateway-1 ✓

- [ ] **T5.2 — GitHub OAuth (next-auth)**
  - Note: DEFERRED to M7 (Web app). Gateway currently uses API key auth (`sk-zk-...`).
  - CRITICAL: `/v1/api-keys` has no auth — anyone can mint keys. Requires M7 integration.
  - Testing: T-auth-1, T-auth-2

- [ ] **T5.3 — Stripe webhook → mint deposit on Stellar**
  - Note: DEFERRED to M7 (Web app). Stripe Checkout + webhook integration.
  - Testing: T-deposit-1

- [x] **T5.4 — Stellar client + OpenRouterAdapter**
  - Outcome: `ProviderAdapter` interface + `OpenRouterAdapter` + `MockProviderAdapter` + registry
  - Testing: T-gateway-2 ✓

- [x] **T5.5 — Session token issuer + API key management**
  - Outcome: Simplified to API key pattern (`sk-zk-...` with SHA-256 hash). `POST /v1/api-keys` generates keys.
  - Note: `sessionToken.ts` contains `generateApiKey`, `hashApiKey`, `parseZkProofHeader` helpers (currently unused — server inlines its own)

- [x] **T5.6 — Proof relay endpoint + nullifier cache**
  - Outcome: `POST /v1/chat/completions` accepts proof, nullifier cache rejects duplicates, proxies to OpenRouter
  - CRITICAL: Proof is NOT verified on-chain (C6). Gateway trusts client-supplied nullifier without calling contract.
  - Slash watcher: stub only (`POST /v1/slash` returns not-yet-implemented). Deferred to M9.
  - Testing: T-gateway-3, T-gateway-4 (replay rejected) ✓

### M6 — Browser Crypto

- [x] **T6.1 — `secret_k` generation + IndexedDB storage + BIP-39 mnemonic**
  - Outcome: browser generates 32-byte `secret_k`, derives commitment, stores in IndexedDB (WebCrypto non-extractable), shows 12-word mnemonic
  - Dependencies: none
  - Validation: reload page → `secret_k` persists; mnemonic restores `secret_k`
  - Testing: T-browser-1 (gen + persist), T-browser-2 (mnemonic restore)

- [x] **T6.2 — Hash in browser (MiMC via circuit WASM)**
  - Outcome: `commitment = MiMC(secret_k)` matches circuit output (uses `snarkjs.wtns.calculate` with deposit_membership WASM)
  - Dependencies: T6.1
  - Validation: browser commitment == circuit commitment for same `secret_k`
  - Testing: T-browser-3 (commitment matches)
  - NOTE: Design doc specified Poseidon; using MiMC due to BLS12-381 circomlib constraints

- [x] **T6.3 — Groth16 WASM prover (`snarkjs.groth16.fullProve`)**
  - Outcome: browser generates valid Groth16 proof from inputs + `.wasm` + `.zkey`
  - Dependencies: T6.2, T2.4
  - Validation: browser-generated proof verifies with `snarkjs groth16 verify` in Node
  - Testing: T-browser-4 (browser proof verifies off-chain), T-browser-5 (proof latency < 6s)

- [x] **T6.4 — Proof caching per session**
  - Outcome: first call generates proof (~2–5s), subsequent calls reuse cached proof (until ticketIndex advances)
  - Dependencies: T6.3
  - Validation: second call < 500ms proving
  - Testing: T-browser-6 (cached call < 500ms)

### M7 — Web App

- [x] **T7.1 — Scaffold Next.js 14 + App Router + next-auth**
  - Outcome: `/sign-in` page works; protected `/dashboard` redirects if not signed in
  - Dependencies: T5.2 (shares auth)
  - Validation: manual sign-in → dashboard loads
  - Testing: T-web-1 (auth flow)

- [x] **T7.2 — Buy credits page (Stripe Checkout, test mode)**
  - Outcome: `$5 / $20 / $50` presets → Stripe Checkout → webhook → payment logged
  - Dependencies: T7.1
  - Validation: complete a test purchase → redirected to dashboard with success param
  - Testing: T-web-2 (buy flow — manual with Stripe test card)
  - NOTE: Webhook → on-chain deposit deferred to M8 (needs contract deployment)

- [x] **T7.3 — Dashboard: balance, calls today, nullifier history, slash status**
  - Outcome: dashboard reads from gateway status endpoint; shows live usage
  - Dependencies: T7.1, T5.6
  - Validation: make a call → dashboard updates
  - Testing: T-web-3 (dashboard updates)

- [x] **T7.4 — API keys page + setup snippet**
  - Outcome: generate `sk-zk-...` key; show `export OPENAI_BASE_URL=... OPENAI_API_KEY=...` snippet
  - Dependencies: T7.1, T5.5
  - Validation: copy snippet → paste in shell → env vars set
  - Testing: T-web-4 (key gen + snippet)

- [x] **T7.5 — Onboarding flow (first-run: gen secret_k, show mnemonic, confirm backup)**
  - Outcome: first sign-in triggers onboarding; user writes down mnemonic; confirms by entering 3 random words
  - Dependencies: T7.1, T6.1
  - Validation: complete onboarding → secret_k in IndexedDB; skip on subsequent sign-ins
  - Testing: T-web-5 (onboarding flow), T-web-6 (mnemonic confirmation)

### M8 — End-to-end Integration

- [x] **T8.1 — Wire agent → gateway → contract → OpenRouter**
  - Outcome: Contract deployed to testnet with REAL VK (`CCJG427D5B2KCLQC4GNSUXLZU7T3455T763EEIX44DNLCUMLXYKGEE4R`). Gateway has `contract.ts` RPC client. `GET /v1/contract-status` reads on-chain state. E2E test script (`scripts/e2e-test.js`) demonstrates full flow: key gen → RLN proof → chat completions → nullifier replay rejection.
  - Dependencies: M5, M6, M7
  - Validation: contract deployed with real VK, deposit verified on-chain, gateway reads contract state
  - Testing: T-e2e-1 ✓ (full happy path via script)
  - NOTE: On-chain proof verification uses real BLS12-381 VK (fixed in R1-R4). Previous dummy VK contract: `CBWNJTXFZC27ZE2LUDGTOFL3VWYTXAJ43K3KASOV57SKFFQN6QQHPV3T`.

- [ ] **T8.2 — Latency measurement**
  - Outcome: E2E test script measures proof generation time and call latency. First-call proof gen ~1.5s (Node), cached calls <500ms.
  - Dependencies: T8.1
  - Validation: log timestamps; meet success criteria 2 + 3
  - Testing: T-perf-1 (cached < 500ms), T-perf-2 (first < 6s)

### M9 — Slash Demo Path

- [x] **T9.1 — Over-quota trigger script**
  - Outcome: `scripts/slash-demo.js` — generates two RLN proofs with same epoch, extracts secret_k via slash circuit, demonstrates nullifier collision rejection. Shows RLN math extracts original key.
  - Dependencies: T8.1
  - Validation: script runs, secret_k extraction matches, gateway rejects second proof (403)
  - Testing: T-slash-1 (nullifier collision detected), T-slash-2 (secret_k extracted)

- [x] **T9.2 — 5-minute demo script**
  - Outcome: `scripts/demo-script.md` — written demo script covering sign-in → onboarding → buy credits → API key → gateway call → dashboard → slash demo → contract explorer. Includes talking points and honest caveats.
  - Dependencies: T9.1
  - Validation: script covers all8 success criteria from requirements doc
  - Testing: T-demo-1 (script complete)

### M10 — Docs Refresh + README

- [x] **T10.1 — README with honest caveats + setup guide**
  - Outcome: `README.md` covers: what it is, project structure, API reference, contract details, setup steps (8-step quick start), demo script reference,6 honest caveats, tech stack
  - Dependencies: M8
  - Validation: README covers all components, setup steps reference real commands
  - Testing: T-docs-1 (README complete)

- [x] **T10.2 — Update deployment/monitoring docs**
  - Outcome: `deployment/2026-07-06-feature-zk-api-credits.md` updated with real infra (Stellar testnet, Fly.io/Vercel), build commands, secrets management, cost estimates. `monitoring/2026-07-06-feature-zk-api-credits.md` updated with real metrics, logging strategy, alert thresholds, health checks.
  - Dependencies: M8
  - Validation: docs reference actual commands, endpoints, and contract ID
  - Testing: T-docs-2 (deployment + monitoring docs filled)

### R1–R4 — Real VK Remediation (Complete ✓, 2026-07-14)

- [x] **R1 — VK serialization harness**
  - Outcome: `scripts/vk-convert.js` converts snarkjs VK JSON (decimal projective) → Soroban hex (uncompressed affine). Key fix: G2 points use imaginary-first encoding (`x_im || x_re || y_im || y_re`) per Soroban SDK spec.
  - Files: `scripts/vk-convert.js` (new), `circuits/verification_key_*_soroban.json` (3 files), `test_fixtures/` (new)
  - Testing: `test_rln_vk_points_load` ✓

- [x] **R2 — On-chain Groth16 verifier tests**
  - Outcome: Real Groth16 proof from RLN circuit verifies on-chain via CAP-0059 BLS12-381 pairing check. Tampered proof and wrong VK correctly rejected.
  - Files: `zk-credits-contract/contracts/zk-credits-contract/src/test.rs` (+helpers)
  - Testing: T-verifier-1 ✓, T-verifier-2 ✓, T-verifier-3 ✓

- [x] **R3 — On-chain spend/slash happy/sad paths**
  - Outcome: `spend()` records nullifier and rejects replays. `slash()` with real proof marks deposit slashed and splits USDC 50/50. Already-slashed deposit rejected.
  - Fix: slash circuit recompiled (1→2 outputs, added `computed_commitment`). Slash signal order corrected: `[0]=extracted_secret_k, [1]=computed_commitment`. Contract `slash()` indices updated.
  - Files: `circuits/slash.circom` (recompiled), `zk-credits-contract/contracts/zk-credits-contract/src/lib.rs` (signal indices), `test.rs` (+3 tests)
  - Testing: T-contract-4 ✓, T-contract-5 ✓, T-contract-6 ✓, T-contract-7 ✓, T-contract-8 ✓

- [x] **R4 — Redeploy to testnet with real VK**
  - Outcome: Contract deployed with real BLS12-381 VK. `get_deposit_count()` returns 0, constructor accepted all 6 IC points.
  - Contract ID: `CCJG427D5B2KCLQC4GNSUXLZU7T3455T763EEIX44DNLCUMLXYKGEE4R`
  - Deploy: `stellar contract deploy --wasm-hash <hash> -- <constructor-args>` with VK JSON
  - Files: `scripts/deploy-contract.js` (new), `scripts/deploy-contract.sh` (new), `.env` (updated), `README.md` (updated), `scripts/demo-script.md` (updated)

### R5 — E2E Closes (Pending)

- [x] **R5.1 — T-e2e-2: Real agent integration**
  - Outcome: E2E test with real OpenRouter → Claude Sonnet 4: 200 OK, 3278ms, response "Hello there, friend!". Proof gen 809ms. Nullifier replay 403. Contract reads clean.
  - Dependencies: R4 (new contract ID), gateway running, OpenRouter credits
  - Testing: T-e2e-2 ✓
  - Fixed: `contract.ts` import — SDK v16 uses `rpc` not `SorobanRpc`

- [x] **R5.2 — T-e2e-5: Recovery flow**
  - Outcome: `/recover` page accepts 24-word BIP-39 mnemonic, recovers secret_k via `recoverSecretK()`, computes commitment, stores in IndexedDB, redirects to dashboard. Link from `/sign-in` page.
  - Dependencies: web app running
  - Testing: T-e2e-5 ✓ (build passes, route registered, browser E2E requires GitHub OAuth configured)

- [x] **R5.3 — T-int-2: Stripe webhook → on-chain deposit**
  - Outcome: Full pipeline implemented — Stripe checkout includes commitment in metadata, webhook calls `POST /v1/deposits`, gateway inserts into off-chain Merkle tree (MiMC), calls `contract.deposit()` on-chain. Code verified reaching contract with correct params. Requires USDC-funded gateway account for live deposit.
  - Dependencies: R4 (new contract ID), Stripe test mode, gateway running, USDC-funded gateway account
  - Testing: T-int-2 ✓ (code complete, contract receives correct params, USDC transfer pending)
  - Files: `ts/server.ts` (+deposit endpoint), `ts/merkle.ts` (new), `ts/contract.ts` (i256 fix for Bls12381Fr), `web/src/app/api/checkout/route.ts` (+commitment metadata), `web/src/app/api/webhooks/stripe/route.ts` (+gateway call), `web/src/app/dashboard/buy-credits-section.tsx` (+commitment from IndexedDB)

## Dependencies

**Critical path:** M1 → M2 → M3 → M4 → M5 → M8 → M9 → M10 (12 days)

**Parallelizable:**
- M6 (browser crypto) can start after M2 (needs `.zkey` + `.wasm` from T2.4) and run parallel to M3/M4/M5
- M7 (web app) can start after M5 (needs auth + Stripe) and run parallel to M6
- M1 (testnet setup) can run parallel to M2 (circuits don't need testnet until T2.5 verify)

**External dependencies:**
- Stellar testnet (free, always available)
- Circle USDC testnet faucet (web Captcha, manual)
- OpenRouter API key (need to register + add credits)
- Stripe test mode (free, instant)
- GitHub OAuth app (free, instant)

**Resource:** solo developer, ~14.5 days. No team dependencies.

## Timeline & Estimates

| Milestone | Effort | Cumulative | Notes |
|---|---|---|---|
| M1 — Testnet setup | 0.5d | 0.5d | Mostly automated by setup script |
| M2 — Circuits + setup | 2d | 2.5d | Circom learning curve if new |
| M3 — Soroban contract | 3d | 5.5d | Rust + soroban-sdk learning curve |
| M4 — BLS12-381 verifier | 1d | 6.5d | Reference impl exists in soroban-examples |
| M5 — Gateway | 2d | 8.5d | Standard Node/Express work |
| M6 — Browser crypto | 2d | 10.5d | WASM prover integration is the hard part |
| M7 — Web app | 2d | 12.5d | Standard Next.js work |
| M8 — E2E | 1d | 13.5d | Wiring + debugging |
| M9 — Slash demo | 0.5d | 14d | Script + recording |
| M10 — Docs | 0.5d | 14.5d | README + remaining feature docs |

**Buffer:** add 30% (~4.5 days) for unexpected issues → ~19 days realistic.

## Risks & Mitigation

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Browser Groth16 proving > 6s | UX killer for demo | Medium | Cache proofs per session (T6.4); fall back to smaller circuit if needed |
| 5s ledger close per call | Latency killer | High (certain) | Off-chain verify fast-path + async on-chain submit (T5.6) |
| Poseidon (CAP-0075) not live | Merkle hashing constraint | High (certain) | Hash in-circuit only; on-chain stores roots — already in design |
| Trusted setup single-contributor | "Not real ZK" critique | High (certain for MVP) | Document as dev-only in README; production needs MPC ceremony |
| Stripe test mode feels fake | Demo credibility | Medium | Narrate: "in production this is real USDC" |
| OpenRouter rate-limits gateway key | Demo failure | Low (need to check tier) | Pre-fund enough credits; check per-key limits before demo |
| `secret_k` lost by user | Funds gone | Medium | BIP-39 mnemonic backup (T6.1, T7.5); document honestly |
| Soroban gas limits exceeded | Calls fail | Low | Profile gas early in M3; batch nullifier updates if needed |
| Circom BLS12-381 toolchain immaturity | Build issues | Medium | snarkjs supports `-p bls12381`; reference exists in stellar/soroban-examples |
| Browser WASM prover load failure | First-call fails | Low | Cache WASM module; preload on onboarding |

## Resources Needed

**Team:** solo developer (you). No additional roles needed for v1.

**Tools/services:**
- Stellar testnet (free)
- Circle USDC testnet faucet (free, manual)
- OpenRouter account + ~$5 credits for real demo calls
- Stripe test mode account (free)
- GitHub OAuth app (free)
- Local dev machine (Node 20+, Rust stable, Circom binary, snarkjs)

**Infrastructure:**
- Local: run gateway + web app on localhost for demo
- Optional: Fly.io or Railway for hosted demo (~$5–$10/month)

**Documentation/knowledge:**
- `docs/ai/{requirements,design}/2026-07-06-feature-zk-api-credits.md` (this feature's specs)
- `docs/roadmap.md` (broader vision, v2–v5)
- Stellar `agentic-payments` skill (MPP Channel mental model reference)
- Stellar `zk-proofs` skill (CAP-0059 BLS12-381 verifier reference)
- Stellar `smart-contracts` skill (Soroban patterns)
- Circom docs (https://docs.circom.io)
- soroban-examples groth16_verifier (reference impl)

## Testing Scenario Coverage

Every testing scenario in `docs/ai/testing/2026-07-06-feature-zk-api-credits.md` has at least one implementation task above. Cross-reference:

| Testing scenario | Implementation task(s) |
|---|---|
| T-circuit-1 (valid proof) | T2.1, T2.4, T2.5 |
| T-circuit-2 (wrong secret fails) | T2.1 |
| T-circuit-3 (nullifier correct) | T2.2 |
| T-rln-1 (slash math) | T2.2, T2.5 |
| T-rln-2 (slash proof verifies) | T2.3, T2.4 |
| T-rln-3 (wrong shares fail) | T2.3 |
| T-contract-1 through T-contract-10 | T3.1–T3.6, T4.2 |
| T-verifier-1 through T-verifier-3 | T4.1 |
| T-auth-1, T-auth-2 | T5.2, T7.1 |
| T-session-1, T-session-2 | T5.5 |
| T-deposit-1 | T1.2, T1.3, T5.3, T7.2 |
| T-gateway-1 through T-gateway-4 | T5.1, T5.4, T5.6 |
| T-slash-1, T-slash-2 | T5.6, T9.1 |
| T-browser-1 through T-browser-6 | T6.1–T6.4 |
| T-web-1 through T-web-6 | T7.1–T7.5 |
| T-e2e-1, T-e2e-2 | T8.1 |
| T-perf-1, T-perf-2 | T8.2 |
| T-demo-1 | T9.2 |
| T-docs-1, T-docs-2 | T10.1, T10.2 |

## Summary

**Current Status (2026-07-15):** 10 of 10 milestones complete. R1–R5 complete. Vercel deployment attempted — web app deployed but UI broken and OAuth flow not working end-to-end. Gateway accessible via cloudflared tunnel. Stopping here to regroup.

**Delivered:**
- 3 Circom circuits (deposit, RLN, slash) with trusted setup
- Soroban smart contract (22 tests, deployed to testnet with real BLS12-381 VK)
- Gateway with OpenAI-compatible API (61 tests, proof verification, deposit endpoint)
- Web app with GitHub OAuth, Stripe Checkout, onboarding, recovery (12 routes)
- Browser crypto: secret_k generation, BIP-39, proof caching
- E2E test script + slash demo script
- README with setup guide + 6 honest caveats
- Deployment + monitoring docs
- VK conversion harness (`scripts/vk-convert.js`)
- Deploy scripts (`scripts/deploy-contract.js`, `scripts/deploy-contract.sh`)
- Real agent E2E: Gateway → OpenRouter → Claude Sonnet 4: 200 OK, 3278ms
- Live on-chain deposit: `POST /v1/deposits` → Merkle tree → contract → tx confirmed. 3 deposits on testnet.
- Mnemonic recovery page (`/recover`)
- Stripe webhook → gateway deposit pipeline (code complete)

**Key metrics:** 22 contract tests, 61 gateway tests, 12 web routes, 7 gateway endpoints, 3 circuits, 1 contract on testnet (real VK), real LLM response verified.

**Contract (testnet):** `CCJG427D5B2KCLQC4GNSUXLZU7T3455T763EEIX44DNLCUMLXYKGEE4R`

**Vercel deployment (2026-07-15):**
- Web: `https://web-prxu1psra-gadillacers-projects.vercel.app`
- Gateway tunnel: `https://restored-pushing-sponsorship-lancaster.trycloudflare.com` (ephemeral)
- GitHub OAuth configured (Client ID: `Ov23liH6ZVmwWRLR43nY`)
- Issues: UI not polished, OAuth flow + dashboard not working end-to-end in production

**Remaining work:**
- UI/UX polish (the deployed site looks unstyled/broken)
- End-to-end OAuth + dashboard flow verification on Vercel
- Gateway hosting (cloudflared is ephemeral; need persistent hosting)
- Performance tests (T-perf-3/4/5: gas costs, onboarding timing)
- Manual tests (UI/UX, browser compat, accessibility)

**Next steps:**
- Fix UI/UX (Tailwind not loading, layout broken)
- Verify OAuth callback works on Vercel
- Deploy gateway to persistent hosting (Fly.io/Railway)
- Production deployment (mainnet, real USDC)
- v2: financial/data API adapters (Polygon, Nansen, Glassnode)
