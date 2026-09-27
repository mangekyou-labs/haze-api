---
phase: testing
title: Stellar Launch Level 4 verification record
description: Fresh local tests and unresolved live acceptance checks
---

# Level 4 verification record

Recorded 2026-09-11 in the active worktree. Commands below are fresh local
evidence; they do not stand in for the live cohort or deployment gates.

## Passing local checks

| Area | Command | Result |
|---|---|---|
| Gateway types | `cd ts && npm run typecheck` | Pass |
| Gateway/unit/integration | `cd ts && npm test` | 82 passed, 2 intentional external skips (12 files) |
| Circuit proofs | `cd circuits && node scripts/test.js` | Pass; deposit, RLN nullifier, and slash proofs verified |
| Soroban contract | `cargo test --manifest-path zk-credits-contract/contracts/zk-credits-contract/Cargo.toml` | Blocked before compilation by installed Cargo 1.79 rejecting dependency `zeroize_derive`'s `edition2024` manifest |
| Web unit/privacy | `cd web && npm run test:unit` | 3 files / 3 tests passed |
| Web TypeScript | `cd web && npx tsc --noEmit` | Pass |
| Web production build | `cd web && npm run build` | Pass; 20 static pages generated |
| Full desktop/mobile browser suite | `cd web && npm run test:e2e` | 10 passed across both projects |
| VK conversion regression | `node --test scripts/vk-convert.test.js` | Pass |
| Synthetic monitor syntax | `node --check scripts/synthetic-monitor.mjs` | Pass |
| Diff whitespace | `git diff --check` | Pass |
| AI DevKit lifecycle lint | `npx ai-devkit@latest lint --feature feature-zk-api-credits` | All checks passed |

The browser tests mock external wallet, checkout, and evaluation APIs. They
cover the existing full flow plus consent, enrollment, mocked Freighter testnet
signing, checkout return, Explorer evidence display, six-field feedback,
analytics opt-in, horizontal overflow, wrong-network messaging,
rejected-signature retry, and missing-commitment recovery. The production
build emits expected local warnings when GitHub credentials are absent and
when multiple lockfiles are present.

## Required before release

- Re-run the Soroban contract suite with a toolchain that supports the dependency's `edition2024` manifest, plus CI confirmation.
- Postgres integration run against a real restricted database, including
  migration and duplicate webhook behavior.
- Three successful cold/warm synthetic runs for frontend, gateway, contract,
  and fee sponsor; one resolved Sentry test event; verified PostHog/survey
  events.
- Ten distinct consented participants with ten unique verified wallets, ten
  unique confirmed testnet deposits, and ten feedback records.
- `npm run evidence:export` succeeds and all public transaction links verify.
