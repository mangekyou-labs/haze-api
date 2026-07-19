---
phase: implementation
title: "zk-api-credits: Implementation Notes"
description: Technical implementation notes for ZK-based anonymous API usage credits MVP
---

# Implementation: zk-api-credits

## Development Setup

**Prerequisites:**
- Foundry (`forge`, `cast`, `chisel`) — https://book.getfoundry.sh
- Node.js 18+ with npm
- Rust toolchain (for Risc0 — task 2.1)
- Alchemy or Infura account for Base RPC
- MetaMask or Safe wallet

**Environment setup:**
```bash
cd contracts
cp .env.example .env  # fill in RPC URLs and keys
forge install         # install dependencies
forge build          # should succeed
forge test           # should pass
```

**Installed dependencies:**
- `openzeppelin/openzeppelin-contracts@v5.0.0` → `lib/openzeppelin-contracts/`
- `foundry-rs/forge-std` → `lib/forge-std/`
- `poseidon-solidity@0.0.5` → `node_modules/poseidon-solidity/`

## Code Structure

```
contracts/
├── src/
│   ├── DepositContract.sol      # Main contract (stub — full impl 1.2)
│   └── DepositContract.t.sol    # Tests
├── test/
│   ├── unit/
│   │   └── DepositContract.t.sol
│   └── integration/
├── script/                      # Deployment scripts (task 3.3)
├── lib/
│   ├── forge-std/
│   ├── openzeppelin-contracts/
│   └── poseidon-solidity/       # node_modules symlinked
├── remappings.txt               # Forge import remappings
├── foundry.toml                 # Solc 0.8.20, optimizer, Base RPC
├── .env                         # Secrets (not committed)
└── .gitignore                   # Excludes .env, cache/, out/
```

## Implementation Notes

### Task 1.1 — Scaffold ✓

**Completed:**
- Foundry project initialized with Solc 0.8.20
- OpenZeppelin v5 installed
- `poseidon-solidity` npm package installed (arity-1 only — see deviation below)
- `foundry.toml` configured with Base RPC endpoints and optimizer
- `.env` template created (secrets not committed)
- Test directories created (`unit/`, `integration/`)
- `forge build` succeeds, `forge test` passes

**Deviation — Poseidon unavailable:**
- Attempted: `@poseidon/contracts` npm (404), `iden3/poseidon-solidity` (404), `dustnypb/poseidon` (not found), `0xPARC/poseidon` (not found)
- `poseidon-solidity` npm package exists but only provides arity-1 hasher (`hash(uint[1])`), not arity-2
- **Resolution**: Using `keccak256` for MVP Merkle tree. Full design doc specifies Poseidon-2 for ZK-friendly hashing. When task 2.1 (Risc0 circuit) begins, either: (a) find working Poseidon-2 source, or (b) implement Poseidon-2 from BN254 field arithmetic per the Poseidon paper specification.
- Impact: ZK circuit (task 2.1) must use the same hash function as the contract. If we switch to Poseidon later, circuit must be updated.

**Files changed:**
- `contracts/src/Counter.sol` deleted
- `contracts/src/DepositContract.sol` created (stub)
- `contracts/test/unit/DepositContract.t.sol` created (scaffold test)
- `contracts/remappings.txt` created
- `contracts/foundry.toml` updated
- `contracts/.env` created
- `contracts/.gitignore` already excludes `.env`

### Task 1.2 — DepositContract core storage ✓

**Completed:**
- Keccak256 Merkle tree with TREE_DEPTH=16 (65536 leaf capacity)
- Precomputed zero hashes in constructor for gas efficiency
- `deposit(commitment)`: inserts commitment, updates root, stores Deposit struct
- `withdraw(commitment, recipient)`: CEI pattern, ReentrancyGuard, restricted to depositor
- `verifyProof(leaf, path, index)`: public API for offchain ZK verification
- `slash()`: placeholder reverting with message (full impl task 1.4)
- `roots[leafCount]`: historical root storage for archival
- `nullifiers` mapping: stub (used by slash in task 1.4)
- 11 unit tests: all passing

**Key design decisions:**
- keccak256 over Poseidon (Poseidon deferred per design doc)
- Binary Merkle tree (arity-2) with precomputed zero hashes
- TREE_DEPTH=16: supports 65536 deposits, sufficient for MVP
- Constructor precomputes zeroHashes[0..16] to avoid runtime keccak chains

**Files changed:**
- `contracts/src/DepositContract.sol` — full implementation
- `contracts/test/unit/DepositContract.t.sol` — 11 unit tests

**Gas estimates:**
- `deposit()`: ~160k gas
- `withdraw()`: ~190k gas
- `verifyProof()`: ~16 * 30k = ~480k gas (worst case, depth 16)

### Pending Tasks

| Task | Status | Blocker |
|------|--------|---------|
| 1.3 Poseidon Merkle tree | `todo` | Using keccak256 (deferred) |
| 1.4 RLN slashing | `todo` | — |
| 1.5 EIP-191 session gen | `todo` | — |
| 1.6 EIP-191 session verify | `todo` | — |
| 2.1 Risc0 circuit | `todo` | 1.3 |
| 2.2 Offchain verifier | `todo` | 2.1 |
| 2.3 Onchain verifier | `todo` | 2.1 (optional) |
| 3.1 Mock server | `todo` | 1.6, 2.2 |
| 3.2 Demo frontend | `todo` | 1.5, 3.1 |
| 3.3 Deploy | `todo` | 1.4, 3.2 |
| 3.4 Monitoring | `todo` | 3.3 |

## Security Notes

- `.env` contains deployer mnemonic/private key — never commit
- Use hardware wallet or Safe for production deployments
- All contract state changes emit events for indexing
- `ReentrancyGuard` to be applied in task 1.2
- CEI pattern for all external calls (task 1.2)


