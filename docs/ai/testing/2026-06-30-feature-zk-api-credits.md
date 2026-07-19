---
phase: testing
title: "zk-api-credits: Testing Strategy"
description: Test scenarios for ZK-based anonymous API usage credits MVP
---

# Testing Strategy: zk-api-credits

## Test Coverage Goals

- **Unit**: 100% coverage on DepositContract, session token verification, ZK circuit constraints
- **Integration**: Full deposit → session → API call flow; slash flow
- **E2E**: Demo user completes full flow in < 5 minutes
- **Benchmark**: ZK proof verification < 1s offchain, < 300k gas onchain

## Unit Tests

### DepositContract

- [ ] `deposit()`: inserts commitment into Merkle tree, emits `Deposited` event
- [ ] `deposit()`: reverts if `msg.value == 0`
- [ ] `deposit()`: reverts if commitment is zero
- [ ] `deposit()`: increments `leafCount`
- [ ] `deposit()`: sets `currentRoot` to new Merkle root
- [ ] `verifyProof()`: accepts valid proof with correct Merkle path
- [ ] `verifyProof()`: rejects invalid Merkle path (wrong element)
- [ ] `verifyProof()`: rejects if nullifier already spent
- [ ] `verifyProof()`: rejects proof not matching commitment
- [ ] `slash()`: accepts two proofs with same ticketIndex, extracts secret, transfers RLN stake to submitter
- [ ] `slash()`: burns policy stake S (not transferred)
- [ ] `slash()`: reverts if two proofs have different ticketIndex
- [ ] `slash()`: reverts if nullifiers don't match
- [ ] `withdraw()`: transfers remaining balance to depositor
- [ ] `withdraw()`: marks deposit as withdrawn
- [ ] `withdraw()`: reverts if already withdrawn
- [ ] `withdraw()`: reverts if caller is not depositor
- [ ] Edge: deposit max uint256 amount
- [ ] Edge: deposit and withdraw in same block
- [ ] Edge: zero-value deposit (should be allowed for commitment-only)

### SessionToken (TypeScript)

- [ ] Signs valid EIP-191 message with funder private key
- [ ] Verifies valid signature against funder address
- [ ] Rejects signature with wrong funder address
- [ ] Rejects expired session (`validUntil < block.number`, when `validUntil != 0`)
- [ ] Rejects session with wrong `chainId`
- [ ] Rejects session with wrong `provider` address
- [ ] Handles `validUntil = 0` (no expiry) as valid
- [ ] Serializes/deserializes session token correctly
- [ ] Generates unique `sessionId` each time

### ZK Circuit (Circom/Risc0)

- [ ] Valid proof with correct Merkle membership passes verification
- [ ] Proof fails with wrong Merkle path (tampered element)
- [ ] Proof fails if commitment doesn't match secret k
- [ ] Proof fails if accumulated refunds < solvency constraint
- [ ] RLN double-sign: two valid proofs with same ticketIndex reveal secret k
- [ ] RLN: different ticketIndices produce different nullifiers (no reveal)
- [ ] Edge: ticketIndex = 0 (first call) passes
- [ ] Edge: accumulated_refunds = 0 (no refunds yet) passes solvency

### PricingTiers (TypeScript)

- [ ] `TIER_COSTS[FREE] == 0`
- [ ] `TIER_COSTS[LOW] > 0`
- [ ] `TIER_COSTS[MED] > TIER_COSTS[LOW]`
- [ ] `TIER_COSTS[HIGH] > TIER_COSTS[MED]`
- [ ] Tier enum maps correctly to uint8 values

## Integration Tests

- [ ] **Happy path EIP-191**: deposit ETH → generate session token → provider verifies → API call succeeds
- [ ] **ZK path**: deposit → generate ZK proof (client-side) → submit to provider → provider offchain verify → call succeeds
- [ ] **ZK onchain verify**: same as above but verify via `DepositContract.verifyProof()` (expensive but testable)
- [ ] **Double-spend detect (offchain)**: agent sends two API calls with same ticketIndex → second call rejected by provider's local tracker
- [ ] **Double-spend slash (onchain)**: two ZK proofs with same ticketIndex submitted to `slash()` → RLN stake transferred to submitter
- [ ] **Session revocation**: funder calls `revokeSession()` → subsequent API calls rejected even with valid session token
- [ ] **Concurrent agents**: two agents using same funder → provider can serve both but cannot correlate them
- [ ] **Chain reorg**: deposit in block N → reorg → deposit still valid (confirmation depth check)
- [ ] **Provider mismatch**: session token for provider A submitted to provider B → rejected with appropriate error

## End-to-End Tests

- [ ] **Demo flow**: connect wallet → deposit 1 ETH → generate session token → make mock API call → provider responds → total time < 5 min
- [ ] **Multi-agent demo**: start agent A → start agent B (same funder) → both call same API endpoint → observer shows two unlinkable requests
- [ ] **ZK privacy demo**: enable ZK mode → both agents call API → show provider's view: no funder address visible, no correlation between calls
- [ ] **Slash demo**: intentionally double-spend → watch slash tx land → verify submitter receives RLN stake
- [ ] **Funder view**: funder dashboard shows total spent, remaining balance, active sessions, revoke button
- [ ] **Provider view**: provider dashboard shows incoming requests, tier distribution, no funder identity data

## Fuzz Testing

- [ ] `deposit()`: fuzz test with random wei amounts (0 to max uint256)
- [ ] `verifyProof()`: fuzz test Merkle path with random indices
- [ ] `slash()`: fuzz test with random valid proof pairs
- [ ] Session token: fuzz test signature generation with random inputs

## Test Data & Fixtures

- **Accounts**: 3 funder EOAs (deployer, funder1, funder2), 1 provider EOA, 1 watcher EOA
- **Seeding**: Pre-fund funder EOAs with 10 ETH each on Base testnet
- **Merkle tree**: Pre-compute known roots for known deposit sets
- **ZK proving**: Pre-generate test proving keys / verification keys for known circuits
- **Fork testing**: Fork Base mainnet for integration tests against live state (no ERC-8004 dependency)

## Performance Benchmarks

| Operation | Target | Test Method |
|-----------|--------|-------------|
| EIP-191 verify | < 10ms | `console.time` in Node.js |
| ZK proof (client, CPU) | < 15 min | Risc0 local benchmark |
| ZK proof (client, GPU) | < 30s | Risc0 GPU benchmark |
| ZK verify offchain | < 1s | Risc0 guestVM |
| ZK verify onchain | < 300k gas | Foundry gas snapshot |
| Deposit tx (Base) | < 5s block | `forge test` + `time.sleep` |

## Manual Testing Checklist

- [ ] MetaMask + Safe wallet both work as funder
- [ ] Session token persists across page refresh
- [ ] Provider server responds correctly to valid session
- [ ] Provider server returns 403 to expired/invalid session
- [ ] Demo UI explains the privacy guarantee in plain language
- [ ] Demo UI shows unlinkability via visual comparison (two sessions look identical to provider)
- [ ] Slash transaction visible on Basescan within 2 blocks

## Bug Severity

| Severity | Definition | Examples |
|----------|------------|----------|
| Critical | Funds lost or slash bypassed | Double-spend succeeds, slashed funds not transferred |
| High | Protocol broken | ZK proof always fails, sessions always valid |
| Medium | Degraded UX | Slow proving, UI error messages unclear |
| Low | Cosmetic | Wrong formatting, misleading labels |
