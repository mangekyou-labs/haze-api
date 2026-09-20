---
phase: planning
title: Base private API credits delivery plan
description: Ordered rewrite and verification tasks for the paid Base Sepolia pilot
---

# Base private API credits delivery plan

Date: 2026-09-20  
Feature slug: `base-zk-credits`  
Branch: `feature-base-zk-credits`  
Base: `feature-stellar-launch-level4`  
Status: approved 2026-09-20 on
[Review the reconciled pilot design and implementation plan](../../wayfinder/base-zk-credits-pilot/tickets/05-reconcile-pilot-docs.md).

This plan is a rewrite plan, not a greenfield build. Several packages and
contracts already exist. The circuit, shared crypto, and bond are rewritten
(B2/B3/B4). The gateway still enforces only a 30s future-skew timestamp
bound and still carries a 10 MiB replay cap and a 32 MiB upstream buffer;
the rejected algebra survives only in the gitignored root negative
fixtures. Status **present-unsafe** means the files are there and must be
rewritten against the frozen design before paid traffic. Do not mark them
complete.

Base mainnet and a production proving ceremony are **B22**: blocked on a
later go/no-go map. They are not tasks on this queue.

## Artifact status (as of 2026-09-20)

| Artifact | Status | Note |
| --- | --- | --- |
| `packages/zk-credits-shared` | done (B2) | rewritten against the frozen statement: restored slot-blinding algebra, BN254 field checks, RFC 8785 length-prefixed request-signal binding, encrypted credential export |
| `circuits/private_credit_spend.circom` plus `circuits/scripts/compile-private-credit.js` and `circuits/scripts/private-credit-test.js` | done (B3) | Circom 2, restored algebra, allowance 250; compiles to `circuits/build/private-credit/` at 6 outputs / 0 extra public / 48 private |
| Root `circuits/private_credit_spend.{r1cs,wasm,sym}` | present-unsafe, negative fixtures | Circom 0.5 output of the rejected algebra: `nullifier = Poseidon(secret, slot, domain)`; `share = secret * signal + nullifier`; allowances 5000/25000/75000; 48 public / 0 private. Never overwrite; proving artifacts stay gitignored |
| `contracts/src/PrivateCreditBond.sol` | done (B4) | One funded tier: `FUNDED_TIER_ID` 0, allowance 250, refundable bond `20_000_000` ($20 at six decimals); restored recovery requires `Poseidon(slotBlinding) == nullifier` and `Poseidon(secret) == commitment`; verifier is still a Foundry mock |
| `packages/x402-zk-prepaid` | present-unsafe | custom scheme package exists; no `extra.issuedAt`; credit-asset fields need freeze |
| `ts/claim-store.ts`, `ts/zk-prepaid-gateway.ts`, `ts/response-replay.ts` | present-unsafe | timestamp future-skew 30s only; `MAX_REPLAY_BYTES` 10 MiB; `MAX_UPSTREAM_BYTES` 32 MiB; charging/stream paths not frozen |
| `packages/zk-credits-sidecar` | present-unsafe | local `fullProve` exists; development manifest is not hash-pinned for the restored circuit; self-verify/SLO/proof-failure semantics incomplete |
| `ts/stripe-billing.ts`, `web/` | done (B9), legacy unreferenced | invite-only unpaid onboarding replaced paid checkout: the web dashboard is a five-step state machine, Stripe routes and dependencies are deleted from the active web/gateway entry points, and `ts/stripe-billing.ts`, `ts/wallet-links.ts`, and `ts/db/billing.ts` remain unreferenced for history. README and landing copy still list three SKUs, owned by B21 |
| `archive/stellar` | present, reference only | must stay off the paid path |

## Ordered queue

Implement each product-code task with a failing test, minimum green change,
refactor, and fresh narrow verification. Contract and circuit changes stay
behind explicit interfaces so local tests can use deterministic mock
verifiers without implying development proving material is production-ready.

| ID | Work | Status | Outcome | Dependencies | Validation evidence | Scenarios |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | Worktree, lifecycle docs, AGPL, Base/ETH standards | done | Decision-complete requirements, design, testing, planning, implementation, deployment, and monitoring; no silent contradiction with closed tickets | Closed tickets 01–04 and 06 | `npx ai-devkit@latest lint --feature base-zk-credits`; `npx ai-devkit@latest lint`; explicit user approval of this set | S34 |
| B2 | BN254 shared crypto, credential export, request canonicalization | done | Poseidon, field checks, encrypted export, and request-signal binding match the frozen ABI | B1 | 2026-09-20 local: `npm test` in `packages/zk-credits-shared` (23 passed, 8 skipped); `npm test` in `packages/zk-credits-sidecar` (46 passed); `NODE_ENV=test npx vitest run zk-prepaid-gateway.test.ts` (7 passed) | S1, S10 |
| B3 | Circom spend circuit, development compile scripts, R1CS freeze | done | Restored slot-blinding algebra; six public signals; in-circuit allowance 250; 48 private inputs; reject zeros | B2 | 2026-09-20 local: `CIRCOM=$HOME/.local/bin/circom npm test` in `circuits` (compiled with circom 2.2.2 to 0 public inputs / 48 private / 6 public outputs; witness checks passed; rejects altered root/path/tier/expiry, slot ≥ 250, slot ≥ 256, `timestamp >= expiry`, zero secret, zero request signal, malformed field encoding); `r1csfile.readR1cs` new build `{ nOutputs: 6, nPubInputs: 0, nPrvInputs: 48 }` vs root fixture `{ nOutputs: 6, nPubInputs: 48, nPrvInputs: 0 }`; `npx ai-devkit@latest lint --feature base-zk-credits` passed. S3 is partial: zero slot blinding, cross-domain replay, and reordered-signal consumption stay with B2 and B12 | S2, S3, S4, S5 |
| B4 | Immutable USDC bond contract, mocks, Foundry invariants | done | Single funded tier 250; restored `_recoverSecret`; known roots; 50/50 slash; release maturity; SafeERC20 | B3 | 2026-09-20 local: rewritten tests first failed on the three-tier table (`5000 != 250`, `5000000 != 20000000`) and on `InvalidProof` for restored-algebra slashes; then `FOUNDRY_OFFLINE=true forge test` in `contracts` passed 28 (26 unit + 2 invariants, 256 runs, 0 reverts). Real verifier and onchain slash remain B12. S31 stays with B20 | S6, S7 |
| B5 | Custom x402 v2 `zk-prepaid` package, credit-asset fields, `@x402/core` registration | done | `issuedAt` in extra; `amount`/`asset` name the credit; scheme-based selection; omit `payer`; empty transaction | B2 | 2026-09-20 local: package `npm test` (8 passed), package `npm run build`, `ts/npm run typecheck`, `NODE_ENV=test npx vitest run zk-prepaid-gateway.test.ts` (7 passed), targeted sidecar regressions (7 passed), both `ai-devkit lint` commands, and `git diff --check` passed. Real core client/resource-server/facilitator registration, `/supported`, escrow phase orchestration, wire validation, cache invalidation, and sidecar issuedAt binding are covered. Durable claim lifecycle and gateway HTTP mapping remain B6. | S8, S9, S10, S11 |
| B6 | Isolated claim store, facilitator, gateway reservation lifecycle | present-unsafe | Reserve-before-dispatch; commit-only-after-success; 1 MiB buffered replay; no streaming; `issuedAt` window; proof failure never inserts a claim | B5 | Concurrency, crash, freshness, streaming-reject, and replay tests | S9–S15, S21, S29 |
| B7 | Stripe opaque orders, sponsorship/maturity/refund/dispute jobs | present-unsafe | Signed idempotent webhooks; no Stripe identity joined to nullifiers or signals; durable retry | B4, B6 | Webhook/job integration tests; privacy scan of billing rows | S18, S21, S22 |
| B8 | Sidecar: hash-pinned WASM/zkey, self-verify, Merkle path, OpenAI-compatible `/v1/chat/completions`, proof-failure metric | present-unsafe | Sidecar-only Groth16; refuse on hash mismatch; one `fullProve` at a time; retries stay on same slot/signal/`issuedAt` | B3, B5, B6 | Sidecar tests; no runtime key fetch; proof-failure leaves slot unused | S12–S17, S21 |
| B9 | Web purchase, backup gate, Base status, optional SIWE, retired eval UI | done (B9, unpaid amendment) | Invite-only unpaid onboarding: single-use invites, detached funding capability, two-stage version-2 export, sanitized Base Sepolia status; no checkout, no SIWE wallet link, no remaining-credit view. Live paid SKU wording stays with B21 | B7 (detached) | Web lint/typecheck/build; gateway and pilot unit/integration suites; Playwright onboarding and recovery flows; local smoke probes | S19, S20, S21, S22 |
| B10 | Keep Stellar/evaluation runtime archived; env/docs/deploy scripts Base-only | present | Paid path has no Stellar spend or evaluation cohort gates | B9 | Dependency/search audit | S33 |
| B11 | Full local verification and release-gate reconciliation | todo | Fresh command matrix; unpaid traffic only until B12–B16 pass | B2–B10 | Lint, typecheck, package tests, Foundry, circuit, web build, `git diff --check` | S34 |
| B12 | Paid-traffic cryptographic gate | todo | Independent review, R1CS, negative tests, real Sepolia verifier+adapter, two-transcript recovery | B3, B4, B11 | Written review; on-chain verify receipt; recovery test log | S23, S4, S5, S7 |
| B13 | Pilot activation and continuation evidence | todo | Twelve interviews then ≤3 live-SKU partners; sidecar-local aggregates; week-1 kill bars; no identity join | B12, B16, B8 | Interview notes+pointer; activation checklist; weekly export schema tests | S25, S32, S21, S22 |
| B14 | Unit-economics benchmark | todo | Fixture reproduces contribution table; provider-spend caps pause checkout | B6, B7 | Numeric fixture + cap integration test | S26 |
| B15 | Load benchmark | todo | Concurrent exact retries and conflicting signals; one prove per sidecar process | B6, B8 | Load harness log | S27 |
| B16 | Proof-latency SLO benchmark | todo | Founder p95 ≤ 2.0s; partner dry-run vs published SLO p50 ≤ 1.5s / p95 ≤ 3.0s; 10s abort | B8 | 20-sample unpaid dry-run on pinned artifacts; nothing sent to live gateway | S16, S17, S24, S25 |
| B17 | Storage-growth benchmark | todo | ≤250 first-transcripts/bundle through expiry+7d; 24h replay; deletion | B6 | Retention tests and size fixture | S28 |
| B18 | Claim-store benchmark | todo | Uniqueness, fencing, lease, crash windows, proof-failure non-insert | B6 | Crash/concurrency tests | S29 |
| B19 | Event-cursor and slash-revocation benchmark | todo | Rebuild remaining 250-slot nullifiers from `BondSlashed` before cursor advance | B4, B6 | Reorg and rebuild tests; lag alarm | S30 |
| B20 | Slashing-path benchmark | todo | Two transcripts, no live 402, 50/50, terminal exclusivity | B4, B6 | Foundry + gateway integration | S31, S7 |
| B21 | Product copy freeze (README, dashboard SKU table) | todo | One 250-credit live SKU; custom-scheme wording; no 5k/25k/75k table | B9 | Diff review; no stale SKU strings on the paid path | S19 |
| B22 | Base mainnet and production ceremony | blocked | Later go/no-go map only | Pilot continuation gate | Not in this map | S34 |

## Sequencing

1. B1 is done (document set approved 2026-09-20).
2. B2 → B3 → B4, the cryptographic spine, is done locally and committed.
   Do not onboard partners until B12 replaces the mock verifier with a real
   generated one and closes the paid-traffic gate.
3. B5 → B6 → B8 follow the public-signal ABI frozen in B3.
4. B7 and B9 follow a working reservation machine.
5. B11 is local verification. B12 is the paid-traffic gate. B16 founder
   dry-run must pass before any partner dry-run.
6. B13 starts after B12 and a passing founder B16. B14–B20 may run as
   fixtures in parallel with B11 once B6/B8 exist, but they are release
   evidence, not substitutes for B12.
7. B21 may land with B9. B22 does not start in this map.

## External gates (not local defaults)

- Independent cryptographer for B12.
- Base Sepolia contract, sponsor, refund vault, treasury, USDC, RPC, and
  verifier addresses.
- Stripe and OpenRouter credentials.
- Partner-written accepted proving latency before first paid claim.
- Interview recruitment from named split-key and multi-agent operators.

Do not broadcast transactions or claim Sepolia deployment without configured
external keys and user authorization.

## Risks

- Shipping the present-unsafe circuit as “privacy-preserving” leaks the
  secret from one share. Mitigation: B3/B12 are hard gates; current
  artifacts are negative fixtures.
- Treating a proof failure as a cancelled claim burns slots the partner
  never spent. Mitigation: B6/B8/S16.
- Streaming or a 10 MiB buffer makes settlement and replay diverge.
  Mitigation: B6/S13; cap 1 MiB.
- Joining Stripe identity to nullifiers breaks the continuation evidence
  rules. Mitigation: B7/B13/S22.
- Lab substitution for proving SLOs. Mitigation: B16 judged on the partner
  sidecar host.

## Next actions

1. B5 custom x402 v2 `zk-prepaid` package, then B6: `issuedAt` window and
   1 MiB non-streaming commit path.
2. B8 sidecar hash-pinned manifest and self-verify against the compiled
   `circuits/build/private-credit/` artifacts.
3. B11 fresh local verification matrix before any paid-traffic claim.
