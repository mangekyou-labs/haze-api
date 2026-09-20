---
phase: testing
title: Base private API credits testing strategy
description: Scenario catalog for the paid Base Sepolia private-credit pilot
---

# Base private API credits testing strategy

Date: 2026-09-20  
Feature slug: `base-zk-credits`  
Status: approved 2026-09-20 on
[Review the reconciled pilot design and implementation plan](../../wayfinder/base-zk-credits-pilot/tickets/05-reconcile-pilot-docs.md).

The circuit, the shared crypto package (planning B2/B3), and the bond
contract (B4) are rewritten locally. The gateway and replay code still
implement a 10 MiB replay cap and a future-only timestamp check, and the
root `circuits/private_credit_spend.{r1cs,wasm,sym}` Circom 0.5 artifacts
still carry the rejected equation at 48 public / 0 private. Those artifacts
are negative fixtures until rewritten. Do not treat their existing tests as
paid-traffic evidence.

Every scenario below maps to at least one planning task. Streaming, generic
x402 wallets, a public facilitator, Bazaar, MCP, `/v1/responses`, Anthropic
translation, an `exact` rail, Base mainnet, and a production ceremony are
not acceptance suites.

## Evidence policy

Implement with a failing test, then the minimum green change. Before any
paid-traffic claim, run a fresh local matrix: `npx ai-devkit@latest lint
--feature base-zk-credits`, package typecheck and tests, Foundry, circuit
compile plus R1CS inspection, web build, and `git diff --check`. A local
pass does not substitute for independent review, a real Sepolia verifier,
Stripe, OpenRouter, or partner dry-run evidence.

Inspect captured logs and persisted rows in privacy scenarios. Fail the
suite if plaintext prompts, responses, secrets, proofs, wallet or account
identifiers, remaining-credit data, nullifiers, or request signals appear
in production logs, spend-plane rows, dashboard views, or weekly sidecar
exports.

A proof failure (prove miss, 10s abort, hash mismatch, or failed
self-verify) must leave no claim row, consume no slot, and must not be
counted as a cancellation.

## Local B2/B3/B4 evidence (2026-09-20)

Run from the `feature-base-zk-credits` worktree. This is local evidence for
the rewritten statement only; it does not close planning B12.

| Scenarios | Command | Result |
| --- | --- | --- |
| S1 | `npm test` in `packages/zk-credits-shared` | 23 passed, 8 skipped (`src/base.test.ts`: 8 passed) |
| S10 | `NODE_ENV=test npx vitest run zk-prepaid-gateway.test.ts` in `ts` | 7 passed |
| B2 caller regression | `npm test` in `packages/zk-credits-sidecar` | 46 passed, 16 files |
| S2, S3, S5 | `CIRCOM=$HOME/.local/bin/circom npm test` in `circuits` | compiled with circom 2.2.2; `public inputs: 0`, `private inputs: 48`, `public outputs: 6`; witness checks passed. S2: slots 0 and 249 satisfy. S3: altered root, altered path, altered tier, altered expiry, slot ≥ 250, slot ≥ 256, `timestamp >= expiry`, zero secret, zero request signal, and a malformed field encoding are all rejected. S5: two-transcript recovery, one-transcript non-recovery |
| S4 | `r1csfile.readR1cs(file, { loadConstraints: false, loadMap: false })` | new build `{ nOutputs: 6, nPubInputs: 0, nPrvInputs: 48 }`; root fixture `{ nOutputs: 6, nPubInputs: 48, nPrvInputs: 0 }` |
| S6, S7 | `FOUNDRY_OFFLINE=true forge test` in `contracts` | 28 passed (26 unit + 2 invariants); invariants ran 256 sequences and ~128,000 calls each with 0 reverts |
| S34 lint | `npx ai-devkit@latest lint --feature base-zk-credits` | all checks passed |

The B4 suites were written first and failed before the contract change, on
the three-tier table (`5000 != 250`, `5000000 != 20000000`, and tier 1/2
still fundable) and on `InvalidProof` for every restored-algebra slash.
After the change, S6 covers the single funded tier, depth-20 append-only
roots with historical retention, release at expiry plus seven days,
permissionless release, terminal exclusivity, USDC accounting, verifier
context failures, and the two fuzz properties. S7 covers two-transcript
recovery of slot blinding then secret, the `Poseidon(slotBlinding) ==
nullifier` and `Poseidon(secret) == commitment` bindings, equal signals,
zero signals, a zero recovered slot blinding, out-of-range field elements,
and the absence of any 300s spend window: evidence six hours old still
slashes. The local S31 overlap is the 50/50 split, the rejected second
slash, and release-versus-slash exclusivity; the full S31 path against the
gateway stays with B20.

Two reading notes. Expected-unsatisfying witnesses print `ERROR: 4 Error in
template PrivateCreditSpend_218`; the circuit suite still exits zero and that
line is not a test failure. The `ts` suite must run with `NODE_ENV=test`,
because the gateway denies billing routes when the ambient `NODE_ENV` is
`production`.

S1–S5 are verified at the source and witness level only, and S3 is partial.
Three S3 clauses are not local: zero slot blinding is constrained in-circuit
but not witness-testable (`Poseidon` has no usable zero preimage), so B2
carries the API-level rejection instead; matching deployment domain is a
contract check in B4, not an in-circuit one; and verifier-adapter consumption
of reordered public signals is B12. S6 and S7 are Foundry evidence against a
mocked `ISpendVerifier` and keccak Poseidon stand-ins, so they do not show
that a real generated proof verifies, that a real Poseidon deployment agrees
with the circuit, or that anything has happened onchain. S23 is not closed:
there is still no independent review, no generated proof verified by a real
Solidity verifier and adapter on Base Sepolia, and no paid-traffic gate.

## Local B5 evidence (2026-09-20)

| Scenarios | Command | Result |
| --- | --- | --- |
| S8–S11 | `npm test` in `packages/x402-zk-prepaid` | 8 passed; covers fixed credit wire fields, Base64 envelopes, identifying/unknown-field rejection, mixed-accept selection, cache keys and stale challenges, empty transaction/omitted payer, real core registration and `/supported`, phase injection rejection, and escrow orchestration |
| S8–S11 | `npm run build` in `packages/x402-zk-prepaid` | passed with `@x402/core` v2.26 types |
| S8–S11 | `npm run typecheck` in `ts` | passed |
| S9–S10 | `NODE_ENV=test npx vitest run zk-prepaid-gateway.test.ts` in `ts` | 7 passed |
| S8–S10 | `NODE_ENV=test npx vitest run src/base-sidecar.test.ts src/sidecar.test.ts` in `packages/zk-credits-sidecar` | 7 passed |
| S34 | `npx ai-devkit@latest lint --feature base-zk-credits`; `npx ai-devkit@latest lint`; `git diff --check` | all passed |

These are local adapter and consumer regressions only. Durable reservation
state, gateway status mapping, proof freshness enforcement, and live
facilitator-route migration remain B6; generated proofs, Solidity verification,
deployment, and paid traffic remain B12.

## Scenario catalog

| ID | Scenario | Planning tasks |
| --- | --- | --- |
| S1 | Deterministic Poseidon vectors, BN254 field/range checks, length-prefixed request canonicalization, encrypted credential round trip, wrong-password and tamper failures | B2 |
| S2 | Valid spend for any unused slot in `[0, 250)` under restored algebra and ABI `[root, timestamp, domain, requestSignal, nullifier, share]` | B3, B12 |
| S3 | Circuit rejects altered root, path, tier, expiry, slot, timestamp, domain, signal, nullifier, share; zero secret; zero slot blinding; zero request signal; slot ≥ 250; `timestamp >= expiry`; reordered public signals; malformed field encodings | B3, B12 |
| S4 | Compiled R1CS is 6 public / 48 private; `main` does not also mark challenge values public; verifiers consume `fullProve` `publicSignals` as-is | B3, B12 |
| S5 | One-transcript share does not recover secret or slot blinding; two transcripts same nullifier different signals recover slot blinding then secret | B3, B4, B12, B20 |
| S6 | Foundry: sponsor `fundBundle`, depth-20 roots, known historical roots, single funded tier allowance 250, expiry views, release after expiry+7d, replay protection, terminal exclusivity, USDC accounting, 50/50 slash, verifier failures, fuzz, invariants | B4, B20 |
| S7 | On-chain slash uses restored recovery: `(share1-share2)/(x1-x2)` is slot blinding; `secret = share1 - a * x1`; require `Poseidon(a) == nullifier` and `Poseidon(secret) == commitment`; no live 402 or 300s window | B4, B12, B20 |
| S8 | x402 v2 Base64 envelopes, `amount: "1"`, `asset: "coding-deepseek-v4-flash-v1"`, scheme-based acceptance selection, real `@x402/core` registration, `/supported` negotiation, omitted `payer`, `transaction: ""`, reject identifying payload fields | B5 |
| S9 | Gateway-issued `extra.issuedAt` unix seconds; public timestamp equals it; reject outside `[now-300s, now+5s]`; cached 402 dies when `issuedAt` leaves the window; client-chosen timestamp is rejected | B5, B6 |
| S10 | Request signal binds method, absolute URL, body hash, RFC 8785 requirements digest, nonce, and response key; same nullifier+signal coalesces; different signal is conflict fail-closed | B5, B6 |
| S11 | Resource server does not call `/verify` on the paid path; first `/settle` reserves; second commits; `settleOnCancel` only before a commit attempt; client cannot inject phase | B5, B6 |
| S12 | Reserve before dispatch; commit only after a fully buffered, structurally valid provider 2xx within 1 MiB; local validation, non-2xx, timeout, oversized body, and pre-commit failure cancel and consume no credit | B6, B8 |
| S13 | Streaming request or `stream: true` is rejected before reserve; settlement and replay never diverge | B6, B8 |
| S14 | Exact retry of a committed claim returns the 24h encrypted replay without a second slot or provider dispatch; that ciphertext is not slash evidence | B6, B8 |
| S15 | At most two upstream dispatches per nullifier; after two failures the claim stays cancelled until an explicit operator reset; no model fallback | B6 |
| S16 | A prove miss, 10s abort, hash-pinned artifact mismatch, or failed local self-verify is a proof failure: no claim row, slot unused, sidecar metric only | B8, B16 |
| S17 | Sidecar computes its own Merkle path from public tree data; gateway never serves a path for a named leaf or commitment; control plane never serves WASM/zkey at runtime | B8, B16 |
| S18 | Duplicate Stripe webhooks, opaque order metadata, failed sponsorship, chargeback, refund retry, and durable job idempotency | B7 |
| S19 | Web: credential backup gate before Checkout, Base Sepolia links, no wallet purchase, no remaining-credit or usage history, live SKU $20+$20 / 250 credits only | B9, B21 |
| S20 | Optional SIWE is not a purchase or request prerequisite; GitHub OAuth remains primary | B9 |
| S21 | Privacy: spend-plane rows, logs, dashboard, weekly sidecar export contain no prompts, responses, secrets, proofs, wallets, accounts, remaining-credit, nullifiers, or request signals | B6, B7, B8, B9, B13 |
| S22 | Control plane may know a principal paid and activated; it must not join that identity to nullifiers or request signals | B7, B9, B13 |
| S23 | Independent-review packet, R1CS dump, negative-test set, generated proof verified by the real Solidity verifier+adapter on Base Sepolia, and two-transcript recovery | B12 |
| S24 | Founder unpaid dry-run: discard one cold start, 20 hot prove+self-verify cycles on pinned artifacts, p95 ≤ 2.0s on a normal laptop, nothing submitted to the live gateway | B16 |
| S25 | Partner unpaid dry-run on their sidecar host against the published proving SLO (p50 ≤ 1.5s, p95 ≤ 3.0s); fail → not activated; no lab substitution, remote prove, or loosened cap | B13, B16 |
| S26 | Unit-economics fixture: full-bundle and two-dispatch worst case remain positive contribution at class ceilings; $40/UTC day and $200/30d provider caps pause checkout | B14 |
| S27 | Load: three activated sidecars, one `fullProve` per process, two-agent as two processes; gateway reserve/commit under concurrent exact retries and conflicting signals | B15 |
| S28 | Storage growth: at most 250 first-transcripts per bundle through expiry+7d; 24h replay ciphertext separate; deletion after retention | B17 |
| S29 | Claim-store: uniqueness and fencing generations, lease expiry, commit ambiguity remains fenced, crash between reserve and commit, crash between commit and client return | B18 |
| S30 | Event-cursor: finalized-root lag, `BondSlashed` revocation rebuild of remaining 250-slot nullifiers from chain history, reorg-safe cursor, no skip ahead of confirmation depth | B19 |
| S31 | Slashing path: two valid conflicting transcripts submitted without a live 402; 50/50 split; second slash rejected; release and slash mutually exclusive | B20 |
| S32 | Pilot activation evidence: twelve interviews, week-1 kill bars, at most three live-SKU partners, sidecar-local aggregates, continuation lines | B13 |
| S33 | Archive Stellar/evaluation runtime is not on the paid path; search audit finds no live Stellar spend | B10 |
| S34 | Full local verification matrix and release-gate checklist; mainnet and ceremony remain later-map | B11, B22 |

## Required suites

- Shared crypto (S1).
- Circuits and R1CS (S2–S5, S23).
- Foundry contract accounting and slash (S6, S7, S31).
- x402 custom scheme (S8–S11). Generic-wallet, public-facilitator, MCP, and
  `exact`-rail coverage are out of scope.
- Gateway claim lifecycle (S12–S15, S29).
- Sidecar proving (S16, S17, S24, S25).
- Stripe and durable jobs (S18, S22).
- Web/sidecar UX (S19, S20). Anthropic translation is not a pilot
  acceptance suite.
- Privacy assertions (S21, S22).
- Paid-traffic gate (S23).
- Benchmarks (S24–S31).
- Activation program (S32).
- Archive and release (S33, S34).

## Benchmarks

Record numeric fixtures, not slogans.

| Benchmark | Pass rule | Task |
| --- | --- | --- |
| Proof latency | Founder p95 ≤ 2.0s hot prove time; partner dry-run and soak p95 ≤ written accepted proving latency, never looser than 3.0s; per-attempt abort 10s | B16 |
| Unit economics | Remaining contribution ≥ $8.24 normal and ≥ $2.55 two-dispatch worst case at class ceilings; caps halt new checkout | B14 |
| Load | Concurrent exact retries coalesce; conflicting signals fail closed; one `fullProve` per sidecar process | B15 |
| Storage growth | Evidence vault ≤ 250 first-transcripts/bundle; replay 1 MiB × 24h; first-transcript retention expiry+7d then delete | B17 |
| Claim store | Unique (nullifier, signal) reservations; fencing generation; no slot consume on cancel or proof failure | B18 |
| Event cursor | Slash revocation of remaining slots before cursor advance; finalized-root lag alarm | B19 |
| Slashing path | Restored algebra; no live 402; 50/50; terminal exclusivity | B20 |

## Manual and external evidence

- Independent cryptographic review of the restored statement and implemented
  artifacts (S23).
- Real Base Sepolia verifier+adapter (S23).
- Partner-written accepted proving latency before first paid claim (S25).
- Interview notes plus pointer, not full transcripts (S32).
- Dated written renewal intent at live SKU (S32).

Do not claim these from local mocks.
