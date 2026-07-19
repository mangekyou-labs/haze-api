---
phase: requirements
title: "zk-api-credits: ZK-Based Anonymous API Usage Credits"
description: Privacy-preserving API payment system using deposit contracts + EIP-191 sessions + optional ZK-STARK proofs for multi-agent unlinkability on Base
---

# Requirements: zk-api-credits

## Problem Statement

API providers face payment friction: per-request billing requires either metered subscriptions (complex), upfront deposits (liquidated if provider misbehaves), or trust in the payer. Users face privacy exposure: every API call is linkable to their wallet, enabling providers to profile usage, correlate agents, and build surveillance dossiers.

Current solutions: API keys (leakable, no privacy), session tokens (centralized server state, linkable), ZK-proof systems (complex, expensive per call). The paper proposes a hybrid: simple deposits + EIP-191 sessions for the common case, ZK proofs for adversarial multi-agent scenarios.

## Goals & Objectives

**Primary goals:**
- Enable users to deposit once and make multiple API calls without per-call onchain transactions
- Allow API providers to verify payment without learning user identity or correlating requests
- Prevent double-spending via RLN (rate nullification) cryptographic mechanism
- Support multi-agent workflows where agents sharing a funder wallet cannot be linked by the provider

**Secondary goals:**
- Ship MVP that demo flows in under 5 minutes for a non-technical institution audience
- Integrate with ERC-8004 identity registry for agent identity where applicable

**Non-goals:**
- Per-token metering (use fixed pricing tiers instead)
- Full RPC middleware (keep server logic simple, proof verification only)
- Multi-chain deployment (Base only for MVP)
- Privacy for single-agent single-provider flows (EIP-191 sessions suffice)
- Real-time credit updates via homomorphic encryption (defer to v2)

## User Stories & Use Cases

1. **Funder deposits funds**: As a trading desk operator, I deposit ETH into the deposit contract and receive a commitment (Merkle root insertion), so my agents can later spend from this balance.

2. **Agent requests session token**: As an AI agent, I request a session token from the funder, signed via EIP-191, so I can prove payment eligibility to API providers without revealing the funder's identity.

3. **API call with session proof**: As an API provider, I receive a request with a session token + optional ZK proof, verify it in microseconds offchain, and serve the response — without knowing which funder or which other agents are active.

4. **Multi-agent unlinkability**: As Agent A and Agent B funded by the same wallet, our API calls cannot be correlated by the provider, even if we call the same endpoint simultaneously.

5. **Double-spend detection**: If any agent attempts to reuse a ticket index, the RLN mechanism reveals the secret key, enabling slashing.

**Key workflows:**
- Happy path: deposit → session token → API call (EIP-191 only, no ZK)
- Privacy path: deposit → ZK proof generation → API call with ZK proof (RLN-based)
- Attack path: double-spend attempt → secret reveal → slashing

## Success Criteria

1. Funder deposits ETH → Merkle root updated → session token generated: < 5 seconds end-to-end
2. API provider verifies session token signature offchain: < 10ms
3. Multi-agent unlinkability: provider cannot determine Agent A and Agent B share same funder wallet (proven by inspecting request patterns)
4. RLN double-spend: attempting to reuse ticket index reveals secret key within 1 block
5. MVP deployable with Foundry on Base testnet in < 30 minutes by a developer familiar with Ethereum

## Constraints & Assumptions

**Technical constraints:**
- Chain: Base (ERC-8004 identity registry live, ~$0.0003 transfers, Coinbase-backed)
- Smart contracts: Solidity 0.8.x, OpenZeppelin v5
- ZK library: Risc0 (RISC-V proofs verifiable on EVM) or Circom + snarkjs for STARKs
- No per-token metering: Fixed pricing tiers (FREE/LOW/MEDIUM/HIGH) per request
- No centralized server state: Session validity verifiable offchain, no server-side nullifier DB

**Assumptions:**
- ERC-8004 identity registry on Base is accessible and verified
- ZK proving can be done client-side for MVP (accepting that mobile/low-power clients may struggle)
- Institutions are willing to pre-fund deposits in exchange for privacy guarantees
- API providers will accept EIP-191 session tokens as valid payment proof

## Questions & Open Items

1. **ZK proving infrastructure**: Who generates STARK proofs? Client-side (heavy), or operator/gateway (centralization risk)?
2. **RLN slashing**: Who claims the slashed deposit? Protocol treasury? burns?
3. **Pricing oracle**: How does the provider assert request cost (C_max)? Static tiers or dynamic?
4. **ERC-8004 integration**: Does the identity registry replace the Merkle tree, or supplement it?
5. **Withdrawal/refunds**: How does unused balance return to the funder?
6. **Session expiry**: Do sessions expire? On what basis?
7. **Deposit finality**: How many block confirmations before deposit is considered final for Merkle inclusion?
