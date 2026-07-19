---
phase: design
title: "zk-api-credits: ZK-Based Anonymous API Usage Credits"
description: Privacy-preserving API payment system using deposit contracts + EIP-191 sessions + optional ZK-STARK proofs for multi-agent unlinkability on Base
---

# Design: zk-api-credits

## Architecture Overview

```mermaid
graph TD
    subgraph Onchain["Onchain (Base)"]
        DC[DepositContract<br/>MerkleTree Poseidon]
        ERC8004[ERC-8004 IdentityRegistry<br/>0x8004A169...]
    end

    subgraph Funder["Funder Wallet"]
        SK[Secret k<br/>ID = Hash(k)]
        ST[EIP-191 SessionToken<br/>signed by funder]
    end

    subgraph Agent["AI Agent (Client)"]
        ZKC[ZK Circuit<br/>Circom/Risc0]
        ZKP[STARK Proof<br/>client-side]
    end

    subgraph Provider["API Provider"]
        SV[Session Verifier<br/>EIP-191 verify]
        ZVV[ZK Verifier<br/>onchain or offchain]
        RT[Rate Limiter<br/>RLN tracking]
    end

    DC -->|deposit commitment| Funder
    Funder -->|EIP-191 token| Agent
    Agent -->|API request + token| Provider
    Agent -->|ZK proof| Provider
    SV -->|verify sig| Provider
    ZVV -->|verify proof| Provider
    RT -->|nullifier check| Provider

    style DC fill:#3f3
    style SV fill:#99f
    style ZKC fill:#f93
```

**Flows:**

**Path 1 — EIP-191 session (common case, no ZK):**
1. Funder calls `DepositContract.deposit{value: D}(commitment)` → deposit inserted into Merkle tree
2. Funder generates secret `k`, derives `ID = PoseidonHash(k)`, includes in commitment
3. Funder signs EIP-191 session token: `{funder, ID, sessionId, ticketIndex, validUntil, C_max}`
4. Agent sends API request with session token in `Authorization` header
5. Provider verifies EIP-191 signature against funder address (offchain, <10ms)
6. Provider serves request, tracks ticketIndex locally

**Path 2 — ZK proof (multi-agent privacy, adversarial):**
1. Same deposit as above
2. Agent generates ZK-STARK proof: proves Merkle membership of ID + valid RLN shares + solvency
3. Agent sends API request with: session token + ZK proof + nullifier
4. Provider verifies ZK proof (offchain via Risc0/guestVM or onchain via Verifier contract)
5. Provider records nullifier to prevent reuse

**Path 3 — Double-spend slash:**
1. Watcher monitors for nullifier reuse (or provider detects it)
2. Watcher submits double-sign proof to `DepositContract.slash()`
3. Contract verifies proof, extracts secret k from two RLN shares
4. Slashed deposit D → submitter, policy stake S → burned

## Data Models

### Onchain: DepositContract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MerkleTree} from "@poseidon/contracts/MerkleTree.sol";
import {Poseidon} from "@poseidon/contracts/Poseidon.sol";

// Commitment: PoseidonHash(secret_k)
// Stored in append-only Merkle tree (Poseidon hash, arity-2)
contract DepositContract {
    // Merkle tree state
    uint256 public currentRoot;
    uint256 public leafCount;
    mapping(uint256 => bytes32) public roots; // historical roots

    // Deposit state
    mapping(bytes32 => Deposit) public deposits;
    mapping(bytes32 => bool) public nullifiers; // spent nullifiers

    // Slashing
    uint256 public constant RLN_STAKE = 0.1 ether;
    uint256 public constant POLICY_STAKE = 0.05 ether;

    struct Deposit {
        uint256 amount;      // wei deposited
        address depositor;
        uint256 expiry;      // optional block-based expiry (0 = no expiry)
        bool withdrawn;
    }

    // Events
    event Deposited(bytes32 indexed commitment, uint256 amount, address depositor);
    event NullifierSpent(bytes32 indexed nullifier);
    event Slashed(bytes32 indexed commitment, address submitter);

    // Actions
    function deposit(bytes32 commitment) external payable;
    function verifyProof(
        bytes32 commitment,
        bytes32[] memory merkleProof,
        bytes32 nullifier,
        uint256[2] memory a,
        uint256[2] memory b,
        uint256[2] memory c
    ) external returns (bool valid);
    function slash(
        bytes32 nullifier1,
        bytes32 nullifier2,
        uint256[2] memory a1, uint256[2] memory b1, uint256[2] memory c1,
        uint256[2] memory a2, uint256[2] memory b2, uint256[2] memory c2
    ) external;
    function withdraw(bytes32 commitment, bytes32 recipient) external;
}
```

### Offchain: Session Token (EIP-191)

```typescript
// EIP-191 structured data
interface SessionToken {
  funder: string;           // ethereum address
  commitment: string;      // bytes32 PoseidonHash(k)
  sessionId: string;       // bytes32 random session ID
  ticketIndex: bigint;      // strictly increasing per session
  validUntil: bigint;      // block number, 0 = no expiry
  cMax: bigint;            // max cost per request (tier: 0=FREE, 1=LOW, 2=MED, 3=HIGH)
  chainId: bigint;         // Base chainId
}

// EIP-191 signing format:
// "\x19Ethereum Signed Message:\n" + JSON.stringify(SessionToken)
```

### Offchain: ZK Proof Input/Output (Circom)

```typescript
// Private inputs (known only to prover)
interface ZKPrivateInputs {
  secret_k: bigint;           // user's secret key
  path_elements: bigint[];   // Merkle proof path
  path_indices: bigint[];    // left/right indicators
  accumulated_refunds: bigint; // sum of signed refund tickets
}

// Public inputs (onchain or verified)
interface ZKPublicInputs {
  commitment: bigint;         // PoseidonHash(k) - public
  nullifier: bigint;          // Hash(k, ticketIndex) - prevents double-spend
  solvency_constraint: bigint; // (ticketIndex + 1) * C_max <= deposit + refunds
  root: bigint;               // current Merkle root
}

// Circuit constraints:
 // 1. Merkle membership: Hash(secret_k) matches leaf at path
 // 2. RLN double-sign: given two (x,y) pairs with same ticketIndex, extract secret_k
 // 3. Solvency: accumulated_refunds + deposit >= (ticketIndex + 1) * C_max
```

### Offchain: Pricing Tiers

```typescript
enum PricingTier {
  FREE  = 0,  // 0 wei
  LOW   = 1,  // ~0.001 ETH per request
  MED   = 2,  // ~0.01 ETH per request
  HIGH  = 3   // ~0.1 ETH per request
}

const TIER_COSTS: Record<PricingTier, bigint> = {
  [PricingTier.FREE]: 0n,
  [PricingTier.LOW]: 1_000_000_000_000n,   // 0.001 ETH
  [PricingTier.MED]: 10_000_000_000_000n,  // 0.01 ETH
  [PricingTier.HIGH]: 100_000_000_000_000n // 0.1 ETH
};
```

## API Design

### Provider Endpoint: Verify Session

```
POST /api/v1/verify-session
Content-Type: application/json

{
  "token": "0x...",        // EIP-191 session token (signed)
  "provider": "0x...",     // API provider address
  "tier": 2,               // PricingTier enum
  "signature": "0x..."     // EIP-191 signature
}

Response 200:
{
  "valid": true,
  "funder": "0x...",       // extracted from signature
  "remainingCalls": 1000  // computed from deposit / tier cost
}

Response 403:
{
  "valid": false,
  "reason": "signature_invalid" | "expired" | "insufficient_balance"
}
```

### Provider Endpoint: Submit ZK Proof

```
POST /api/v1/prove
Content-Type: application/json

{
  "proof": {
    "a": ["0x...", "0x..."],
    "b": [["0x...", "0x..."], ["0x...", "0x..."]],
    "c": [["0x...", "0x..."], ["0x...", "0x..."]]
  },
  "publicInputs": {
    "commitment": "0x...",
    "nullifier": "0x...",
    "root": "0x...",
    "solvency": "0x..."
  },
  "provider": "0x...",
  "tier": 2
}

Response 200:
{
  "valid": true,
  "nullifierUsed": true    // true = first use, false = already spent
}
```

### Demo Frontend API

```
GET /api/v1/deposit-status?commitment=0x...
Response: { "amount": "1.0", "spent": "0.3", "remaining": "0.7" }

POST /api/v1/generate-session
Body: { "tier": 2, "count": 100 }
Response: { "sessionToken": "0x...", "ticketIndex": 5 }

GET /api/v1/nullifier-status?nullifier=0x...
Response: { "spent": false }
```

## Component Breakdown

### 1. DepositContract (Solidity)

**Responsibility**: Tracks deposits, Merkle tree state, nullifiers, slashing.

**Key design decisions:**
- Poseidon hash for Merkle tree (ZK-friendly, native to many circuits)
- Append-only tree (no deletion) — withdrawal tracked via nullifier
- Slashing requires two ZK proofs with same ticketIndex → extract secret k via RLN math
- Events emitted for all state changes → frontend/indexer consumption

**Gas estimate**: ~150k gas per deposit, ~300k gas per proof verification (STARK verification expensive)

### 2. ZK Circuit (Circom + snarkjs or Risc0)

**Responsibility**: Generate and verify STARK proofs of deposit membership + RLN constraints.

**Circuit components:**
- `merkle_tree.circom`: membership proof verification
- `rln.circom`: double-sign detection via polynomial reconstruction
- `solvency.circom`: deposit + refunds >= cost

**Toolchain choice:**
- Option A: **Circom + snarkjs** (mature, widely used, but snarkjs = PLONKish = trusted setup)
- Option B: **Risc0** (RISC-V, no trusted setup, EVM verifier via guestVM, but newer)

**Recommendation**: Risc0 for EVM-native verification. No trusted setup required. Can verify in Solidity via Risc0's EVM verifier or offchain via host API.

### 3. Session Verifier (offchain/TypeScript)

**Responsibility**: Verify EIP-191 signatures, check expiry, validate tier costs.

**Implementation**: Pure TypeScript, no blockchain calls for session verification. Provider maintains local state of used ticket indices.

**Security**: Server must track (funder, ticketIndex) pairs to detect reuse within session scope.

### 4. Demo Frontend (Next.js + wagmi)

**Responsibility**: Walk non-technical audience through the demo in < 5 minutes.

**Flow:**
1. "Connect wallet" → MetaMask / Safe
2. "Deposit 1 ETH" → deposit to contract, get commitment
3. "Generate session token" → EIP-191 signed token appears
4. "Make API call" → request goes to mock AI API provider with token
5. "See privacy in action" → show that provider cannot link two sessions to same funder

**Stack**: Scaffold-ETH 2 (BuidlGuidl), wagmi, viem, Next.js.

## Design Decisions

| Decision | Choice | Rationale | Alternatives Considered |
|----------|--------|-----------|------------------------|
| Chain | Base | $0.0003 transfers, ERC-8004 live, Coinbase-backed | Arbitrum (more TVL), Optimism (OP Stack) |
| Identity | Merkle tree | Paper-exact, self-contained, no ERC-8004 dep | ERC-8004 registry (deferred to v2) |
| Session auth | EIP-191 | Universal wallet support, no special SDK | EIP-2771 meta-transactions (more complex) |
| ZK proving | Client-side | Decentralized, no operator trust | Trusted operator (centralized) |
| ZK toolchain | Risc0 | No trusted setup, RISC-V, EVM-native | Circom+snarkjs (trusted setup, older) |
| Slash claimer | First submitter | Maximizes watchtower incentives | Protocol treasury (more governance) |
| Policy stake | Burned | Prevents false-ban profit motive | Goes to reporter (misaligned incentives) |
| Withdrawals | Session depletion | Simple MVP, institution recurring budgets | Nullifier-based exit (complex v2) |
| Session expiry | Explicit revocation | Funder controls, optional block-based | Count-based (provider must track) |

## Non-Functional Requirements

**Performance:**
- EIP-191 session verification: < 10ms offchain
- ZK proof generation (client-side): 5-15 min CPU, GPU operators < 30s
- ZK proof verification (offchain): < 1s
- ZK proof verification (onchain): ~300k gas, ~$0.00009 on Base
- Deposit transaction: < 5 seconds block inclusion on Base

**Privacy:**
- Provider sees no link between API calls from same funder (EIP-191 path: provider sees funder address per request, but requests are unlinkable if session tokens are independent)
- ZK path: provider cannot determine funder identity or correlation between agents
- RLN: double-spend reveals secret k, slashable

**Security:**
- Double-spend: mathematically impossible without revealing secret
- Front-running slash: submitter race condition mitigated byRLN stake incentive
- Reentrancy: Checks-Effects-Interactions on all contract functions
- Signature replay: session tokens include chainId + provider address

**Scalability:**
- Onchain: O(log n) Merkle proof verification per call
- Offchain: O(1) ticketIndex tracking per provider per funder
- ZK proving: parallelizable across agents

**Cost:**
- Deposit: ~$0.0003 (150k gas on Base)
- ZK verification (offchain): $0
- ZK verification (onchain): ~$0.00009
- EIP-191 session: $0 (offchain)
