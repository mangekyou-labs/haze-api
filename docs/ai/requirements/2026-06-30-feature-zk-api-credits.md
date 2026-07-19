---
phase: requirements
title: "zk-api-credits: ZK-Based Anonymous API Usage Credits"
description: Privacy-preserving API payment system using a deposit contract + ZK-RLN proofs (Noir/Honk) for anonymous, unlinkable, double-spend-proof per-call payment on Base. Simplified MVP of the Crapis/Buterin "ZK API Usage Credits" paper.
---

# Requirements: zk-api-credits

## Problem Statement

API providers face payment friction: per-request billing requires either metered subscriptions (complex), upfront deposits (liquidated if provider misbehaves), or trust in the payer. Users face privacy exposure: every API call is linkable to their wallet, enabling providers to profile usage, correlate agents, and build surveillance dossiers.

Current solutions: API keys (leakable, no privacy), session tokens (centralized server state, linkable), on-chain payments per call (slow, expensive, full transaction-graph exposure). The [Crapis/Buterin paper](https://ethresear.ch/t/zk-api-usage-credits-llms-and-beyond/24104) proposes a single protocol: deposit funds once, then make thousands of API calls anonymously, securely, and efficiently. Honest users who stay within their deposit-funded capacity remain unlinkable; users who double-spend cryptographically reveal their secret key, enabling slashing.

This MVP is a **simplified, paper-faithful implementation** of that protocol: fixed-cost-per-call pricing (a special case the paper explicitly supports), no variable-cost refund circuit, RLN-based double-spend protection, and nullifier-based withdrawal of unspent deposit.

## Goals & Objectives

**Primary goals:**
- Enable a funder to deposit once and make multiple API calls without per-call onchain transactions
- Allow API providers to verify payment without learning which funder funded a request or correlating requests to each other
- Prevent double-spending via RLN (rate-limit nullifier): reusing a ticket index reveals the user's secret key, which is slashable
- Support multi-agent workflows where agents sharing a funder wallet cannot be linked by the provider

**Secondary goals:**
- Ship an MVP that demos end-to-end in under 5 minutes for a non-technical institution audience
- Keep the onchain footprint minimal (1 app contract + 1 generated verifier = 2 contracts, within the ethskills MVP budget)

**Non-goals:**
- Per-call variable-cost metering or refund tickets (use fixed pricing tiers; the refund-summation and homomorphic `E(R)` circuits are deferred to v2)
- Server-side policy-stake slashing (`S`, the burn-on-policy-violation layer) — deferred to v1.1; the MVP implements only the mathematical RLN stake `D`
- x402 / HTTP-402 payment-protocol integration (standalone protocol; non-private pay-per-call is x402's job)
- Multi-chain deployment (Base only for MVP)
- Content-level privacy (the provider sees the request payload `M`; this protocol provides payment-level unlinkability only — content confidentiality is a separable layer, e.g. TEE)
- ERC-8004 agent-identity integration (deferred to v2; MVP uses Merkle-tree identity commitments, paper-exact)

## User Stories & Use Cases

1. **Funder deposits funds**: As a trading desk operator, I deposit ETH into the deposit contract, generating secret `k` and committing `ID = Poseidon(k)` into the onchain Merkle tree, so my agents can later spend from this balance anonymously.

2. **Agent submits a paid, unlinkable request**: As an AI agent, I pick the next ticket index `i`, generate a Noir ZK proof of (Merkle membership of `ID`, solvency `(i+1)·C_max ≤ D`, and a valid RLN share/nullifier), and send `{payload, nullifier, signal (x,y), proof}` to the provider over HTTP. The provider verifies the proof offchain and serves the response without learning which funder funded me or which other agents exist.

3. **Multi-agent unlinkability**: As Agent A and Agent B funded by the same wallet, our simultaneous API calls to the same endpoint cannot be correlated by the provider.

4. **Double-spend detection and slashing**: If any agent attempts to reuse a ticket index `i` on two different payloads, the two RLN shares `(x,y)` let anyone solve for secret `k` and submit a slash proof to claim the RLN stake `D`.

5. **Honest exit (withdrawal)**: As a funder with leftover deposit, I submit a withdrawal ZK proof (membership of `ID` + a withdrawal-scoped nullifier) and reclaim my unspent `D` after a timelock, without deanonymizing my in-flight requests.

**Key workflows:**
- Happy path: deposit → generate ZK proof → API call with proof + nullifier → provider verifies offchain → serve
- Attack path: double-spend same index → two shares reveal `k` → slash `D` to submitter
- Exit path: withdrawal proof + timelock → reclaim unspent `D` (slash window closes first)

## Success Criteria

1. Funder deposits ETH → commitment inserted into LeanIMT → root updated: < 5 seconds end-to-end on Base
2. Provider verifies a Noir/Honk ZK proof offchain: < 1 second (target; client-side proof generation 5-30s in browser per Noir toolchain)
3. Multi-agent unlinkability: given two simultaneous requests from agents sharing a funder, the provider cannot determine they share a funder — demonstrated by an explicit unlinkability test (requests carry only nullifier + proof, never the funder address or a linkable session identifier)
4. RLN double-spend: submitting two proofs with the same ticket index on different payloads reveals `k` and a slash claim succeeds within 1 block
5. Honest withdrawal: a funder reclaims unspent `D` via withdrawal proof after the timelock; a pending slash supersedes the withdrawal during the timelock window
6. MVP deployable with Foundry on Base testnet in < 30 minutes by a developer familiar with Ethereum

## Constraints & Assumptions

**Technical constraints:**
- Chain: Base (high-frequency micropayments, cheap BN254 proof verification, smart-wallet onboarding; BN254 precompiles at standard addresses for Noir/Honk verification)
- Smart contracts: Solidity `>=0.8.21`, `evm_version = cancun`, OpenZeppelin v5; `@zk-kit/lean-imt.sol` + deployed `PoseidonT3` for the onchain Merkle tree
- ZK toolchain: Noir circuits + `bb` (Barretenberg) backend, Honk proofs; `--oracle_hash keccak` for EVM compatibility; separate deployed `HonkVerifier.sol` (proof = `bytes calldata`, public inputs = `bytes32[]`)
- Poseidon hashing throughout (circuit, offchain tree mirror, contract) — never SHA256 in-circuit
- Fixed pricing tiers (e.g. FREE/LOW/MEDIUM/HIGH); `C_max` per tier fixed at deployment; no per-call refund
- Nullifier formula (paper-exact): `a = Hash(k, i)`, `Nullifier = Hash(a) = Hash(Hash(k, i))`; RLN signal `x = Hash(M)`, `y = k + a·x`
- Request submission is offchain HTTP (not an onchain tx from the funder) — the ZK proof is what hides the funder↔request link; the deposit tx is the only funder-linked onchain action (paper-faithful)
- No onchain nullifier DB for requests: provider tracks spent nullifiers offchain (ephemeral, non-canonical); the contract tracks only withdrawal nullifiers and accepted Merkle roots

**Assumptions:**
- Client-side Noir proof generation is acceptable for MVP desktop/server agents (5-30s); mobile/thin-client proving via a trusted operator is deferred to v2
- Institutions are willing to pre-fund deposits in exchange for unlinkability guarantees and a timelocked exit
- API providers accept offchain Noir-proof verification as valid payment proof (proof verifies membership + solvency + RLN; provider additionally checks the nullifier is unspent)
- The provider seeing the plaintext payload `M` is acceptable for the MVP (payment-level unlinkability only)

## Questions & Open Items

1. **ZK proving infrastructure**: **RESOLVED → Client-side only (Noir + bb).** Accepts 5-30s browser proving for desktop/server agents; mobile/operator proving deferred to v2.
2. **RLN slashing**: **RESOLVED → First submitter claims RLN stake `D`.** MVP implements `D` only; policy stake `S` (burn-on-violation) deferred to v1.1 pending a real policy spec.
3. **Pricing oracle**: **RESOLVED → Static tiers (FREE/LOW/MEDIUM/HIGH).** No dynamic oracle. `C_max` per tier fixed at deployment.
4. **ERC-8004 integration**: **RESOLVED → Deferred to v2.** MVP uses Merkle-tree identity commitments (paper-exact).
5. **Withdrawal/exit**: **RESOLVED → Nullifier-based withdrawal with timelock (W1).** Funder submits a withdrawal ZK proof (membership of `ID` + withdrawal-scoped nullifier `Hash(Hash(k,"withdraw"))`); contract burns the withdrawal nullifier and returns unspent `D` after a timelock. A pending double-spend slash supersedes the withdrawal during the timelock window. Distinct from per-call refunds (still deferred).
6. **Session expiry**: **RESOLVED → N/A (no sessions).** With the EIP-191 path removed, there are no sessions to expire; capacity is governed entirely by the deposit and ticket index.
7. **Deposit finality**: **RESOLVED → 2 blocks.** Commitment considered Merkle-inserted after 2 Base block confirmations (~4s).
8. **EIP-191 session path**: **RESOLVED → Removed (Option A).** MVP is a single ZK+RLN path; no non-private billing tier (that role is served by x402, out of scope).
9. **x402 integration**: **RESOLVED → Standalone (no x402).** Own settlement contract; no HTTP-402 protocol integration.
10. **ZK toolchain**: **RESOLVED → Noir + bb (Barretenberg), Honk proofs.** Not Risc0/Circom+snarkjs. Separate deployed `HonkVerifier.sol`; `pragma >=0.8.21`, `evm_version = cancun`.
11. **Onchain Merkle tree**: **RESOLVED → `@zk-kit/lean-imt.sol` + deployed `PoseidonT3`.** Not a hand-rolled tree.
12. **Nullifier formula**: **RESOLVED → `Hash(Hash(k,i))`** (paper-exact), fixing the prior `Hash(k, ticketIndex)` drift.

**Open items for the design phase (not blocking requirements sign-off):**
- LeanIMT tree depth (anonymity-set size) — design decision
- Withdrawal timelock duration — design decision
- Exact tier `C_max` values — design decision
- Root-acceptance policy (recent-root history vs current-root-only) — design decision
