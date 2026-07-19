---
phase: planning
title: "zk-api-credits: Project Planning & Task Breakdown"
description: Implementation task plan for ZK-based anonymous API credits MVP on Base
---

# Project Planning: zk-api-credits

## Milestones

- [x] **M1**: Foundation — project scaffold, DepositContract, Poseidon Merkle tree, EIP-191 sessions
- [ ] **M2**: ZK Layer — Risc0 circuit, RLN constraints, offchain verifier, slash mechanism
- [ ] **M3**: Demo & Ship — Next.js demo UI, provider mock server, deploy to Base testnet

## Task Breakdown

### M1: Foundation

#### 1.1 Project scaffold
- [x] Initialize Foundry project with `forge init zk-api-credits`
- [x] Add dependencies: OpenZeppelin v5, Poseidon contracts, forge-std
- [x] Set up test directory structure (unit/integration/e2e)
- [x] Configure Base testnet RPC + deployer mnemonic in `.env`
- [x] Add `remappings.txt` for OpenZeppelin imports
- [x] **Outcome**: `forge build` succeeds, tests run
- **Deviation**: Poseidon library unavailable via forge/npm. keccak256 used for MVP Merkle tree. Poseidon-2 deferred to ZK circuit phase.
- **Validation**: `forge build` ✓ `forge test` ✓
- [ ] **Validation**: `forge test` passes, no compile warnings

#### 1.2 DepositContract — core storage
- [x] Define `Deposit` struct with `amount`, `depositor`, `expiry`, `withdrawn`
- [x] Implement `commitments` mapping (bytes32 → Deposit)
- [x] Implement `nullifiers` mapping (bytes32 → bool) — stub
- [x] Implement `currentRoot`, `leafCount`, `roots` mapping
- [x] Implement `DepositContract.deposit(commitment) external payable`
- [x] Implement `DepositContract.withdraw(commitment, recipient)`
- [x] Emit `Deposited(bytes32 indexed commitment, uint256 amount, address depositor)`
- [x] Emit `NullifierSpent(bytes32 indexed nullifier)`
- [x] **Outcome**: Deposit and withdraw work with correct events
- [x] **Validation**: All unit tests pass (11/11)
- [x] **Dependencies**: 1.1

#### 1.3 Poseidon Merkle tree integration
- [ ] Integrate Poseidon-2 hasher (2-input) for Merkle tree
- [ ] Implement `insertLeaf(bytes32 leaf) → newRoot`
- [ ] Implement `verifyProof(bytes32 leaf, bytes32[] memory path, uint256[] memory indices) → bool`
- [ ] Store historical roots for later proof validation
- [ ] **Outcome**: Commitments inserted into Poseidon Merkle tree
- [ ] **Validation**: Test with known Poseidon preimages, verify root matches reference implementation
- [ ] **Dependencies**: 1.2
- [ ] **Risk**: Poseidon implementation correctness — use @poseidon/contracts (audited)

#### 1.4 RLN slashing mechanism
- [ ] Implement `slash(nullifier1, nullifier2, proof1, proof2)` — requires two ZK proofs sharing same ticketIndex
- [ ] Implement RLN math: extract `secret_k` from two (x, y) RLN shares
- [ ] Transfer `RLN_STAKE` (0.1 ETH) to submitter
- [ ] Burn `POLICY_STAKE` (0.05 ETH) — send to `address(0)` or burn mechanism
- [ ] Emit `Slashed(bytes32 indexed commitment, address submitter)`
- [ ] **Outcome**: Double-spend reveals secret, submitter rewards, policy stake burned
- [ ] **Validation**: Test with two valid ZK proofs, verify secret extraction
- [ ] **Dependencies**: 1.3, 2.1 (ZK circuit must be defined first for the math)
- [ ] **Risk**: RLN math must match circuit exactly — coordinate with circuit design

#### 1.5 EIP-191 session token — funder side
- [x] Define `SessionToken` interface: `{funder, commitment, sessionId, ticketIndex, validUntil, cMax, chainId}`
- [x] Implement `signSessionToken(token, privateKey) → signature` — EIP-191 signing via viem v2
- [x] Implement `verifySessionToken(token, signature) → address|null` — async via viem v2 recoverAddress
- [x] Implement `hashSessionToken(token) → messageHash` — keccak256 + EIP-191 prefix
- [x] Implement `validateSessionToken(token, providerAddress, chainId)` — chain/provider/tier validation
- [x] **Outcome**: Funder can generate signed session tokens offline; provider verifies in < 10ms
- [x] **Validation**: 20 unit tests — sign/verify, expiry, validation, serialize/parse
- [x] **Dependencies**: 1.2

#### 1.6 EIP-191 session token — provider verifier
- [x] Implement `verifySession(token, signature, config, tracker, blockNumber)` — async, all checks
- [x] Implement `TicketTracker` — in-memory Map for replay prevention per (funder, sessionId)
- [x] Implement `verifyNullifier(nullifier, tracker)` — ZK path nullifier tracking
- [x] Implement `MockProviderServer` — /verify-session, /prove, /chat endpoints
- [x] **Outcome**: Provider verifies EIP-191 tokens in < 10ms offchain
- [x] **Validation**: 20 unit tests — all rejection cases, replay detection, mock server
- [x] **Dependencies**: 1.5

### M2: ZK Layer

#### 2.1 Risc0 circuit design — RLN + Merkle membership
- [ ] Write Risc0 guest program: `verify(api_request, commitment, nullifier, merkle_root) → bool`
- [ ] Circuit constraints:
  - `commitment == Poseidon(secret_k)` — identity commitment
  - `nullifier == RLNHash(secret_k, ticketIndex)` — unique per request
  - Merkle membership: `Poseidon(secret_k)` is leaf in tree with given `root`
  - Solvency: `(ticketIndex + 1) * cMax <= depositAmount + accumulatedRefunds`
- [ ] Compile circuit: `cargo risc0 build`
- [ ] **Outcome**: Compiled Risc0 image ID + guest program
- [ ] **Validation**: Test vectors from Solidity reference implementation
- [ ] **Dependencies**: 1.3 (Merkle tree interface known)
- [ ] **Risk**: Circuit constraints must match Solidity RLN math exactly — define test vectors before coding

#### 2.2 Offchain ZK verifier
- [ ] Implement Risc0 verifier using `risc0-ethereum` SDK
- [ ] Server receives proof + public inputs from agent
- [ ] Runs `Risc0Verifier::verify()` offchain (no gas)
- [ ] Returns `{valid: bool, reason?: string}`
- [ ] Tracks nullifiers to prevent offchain double-spend
- [ ] **Outcome**: Provider can verify ZK proofs in < 1s, no gas cost
- [ ] **Validation**: Integration tests with real proof generation
- [ ] **Dependencies**: 2.1

#### 2.3 Onchain ZK verifier (optional for MVP)
- [ ] Deploy `Groth16Verifier` or `Risc0LightVerifier` Solidity contract
- [ ] Implement `DepositContract.verifyProof()` using onchain verifier
- [ ] **Outcome**: ZK proofs verifiable onchain for trustless scenarios
- [ ] **Validation**: Gas snapshot < 300k
- [ ] **Dependencies**: 2.1
- [ ] **Note**: Defer if offchain verifier is sufficient for demo

### M3: Demo & Ship

#### 3.1 Provider mock server
- [x] Node.js/TypeScript server: endpoints `/api/v1/verify-session`, `/api/v1/prove`
- [x] Mock AI API endpoint: `/api/v1/chat` — returns mock LLM response if session valid
- [x] Session verifier module (from 1.6)
- [ ] ZK verifier module (from 2.2) — deferred, EIP-191 path works
- [x] Rate limiter: track `(funder, ticketIndex)` pairs in memory
- [x] **Outcome**: Working mock API provider with full verification flow
- [x] **Validation**: 51 tests pass — session/chat/prove/ticket-status/deposit-status endpoints
- [x] **Dependencies**: 1.6, 2.2 (EIP-191 path works; ZK path deferred to 2.2)

#### 3.2 Demo frontend — Scaffold-ETH 2
- [ ] Clone scaffold-eth-2 base: `npx create-scaffold-eth@latest zk-api-credits-demo`
- [ ] Add wagmi/viem for Base + MetaMask
- [ ] Add Safe wallet support via `@safe-global/protocol`
- [ ] **Screen 1**: Connect wallet → shows address
- [ ] **Screen 2**: Deposit panel — input amount, call `deposit()` → show commitment
- [ ] **Screen 3**: Generate session — click generates EIP-191 token, shows token JSON
- [ ] **Screen 4**: API call — sends request to mock server, shows response
- [ ] **Screen 5**: Multi-agent view — shows two sessions from same funder, provider view showing unlinkability
- [ ] **Outcome**: Non-technical user completes full flow in < 5 minutes
- [ ] **Validation**: Test with colleague who has never seen the demo
- [ ] **Dependencies**: 1.5, 3.1

#### 3.3 Deploy to Base testnet
- [ ] Deploy `DepositContract` to Base Sepolia (or Base Mainnet if ready)
- [ ] Verify on Basescan
- [ ] Transfer contract ownership to deployer's Safe (production)
- [ ] Fund funder accounts with Base Sepolia ETH (faucet)
- [ ] **Outcome**: Live on testnet, publicly accessible
- [ ] **Validation**: Frontend works end-to-end against live contract
- [ ] **Dependencies**: 1.4, 3.2

#### 3.4 Monitoring setup
- [ ] Add `Slashed` and `Deposited` events to Dune Analytics dashboard
- [ ] Add contract address to OpenZeppelin Defender autotask for alert on slash events
- [ ] Add Basescan contract verification
- [ ] **Outcome**: Team gets alerts on slash events, can see deposit stats
- [ ] **Dependencies**: 3.3

## Dependencies Summary

```
1.1 (scaffold)
  └── 1.2 (DepositContract storage)
        ├── 1.3 (Merkle tree) ──→ 1.4 (slash) ──→ 3.3 (deploy)
        │                            ↑
        ├── 1.5 (session gen) ──→ 3.2 (frontend)
        │         ↑
        └── 1.6 (session verify) ──→ 3.1 (mock server)
                                        ↓
                                   2.2 (ZK verify) ←── 2.1 (circuit)
                                        ↓
                                   3.2 (frontend ZK mode)
```

## Timeline & Estimates

| Task | Estimate | Risk |
|------|----------|------|
| 1.1 Project scaffold | 1-2h | Low |
| 1.2 DepositContract storage | 2-3h | Low |
| 1.3 Poseidon Merkle tree | 3-4h | Medium (Poseidon lib issues) |
| 1.4 RLN slashing | 4-6h | High (circuit/Solidity RLN math alignment) |
| 1.5 EIP-191 session gen | 2h | Low |
| 1.6 EIP-191 session verify | 2h | Low |
| 2.1 Risc0 circuit | 6-10h | High (ZK constraint design) |
| 2.2 Offchain verifier | 3-4h | Medium |
| 2.3 Onchain verifier | 4-6h | Medium (gas optimization) |
| 3.1 Provider mock server | 3-4h | Low |
| 3.2 Demo frontend | 6-8h | Medium (UI/UX polish) |
| 3.3 Deploy | 1-2h | Low |
| 3.4 Monitoring | 2h | Low |
| **Total** | **40-60h** | |

## Risks & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Poseidon library incompatibility with Foundry | Medium | High | Use @poseidon/contracts (npm), verify with test vectors |
| RLN circuit math ≠ Solidity RLN math | High | Critical | Define shared test vectors before writing either; co-design with circuit |
| Risc0 proving too slow for demo | Medium | Medium | GPU operator fallback; or precompute proofs for demo; or use SP1 instead |
| ZK proving infrastructure complexity | High | High | Defer ZK to v2 if timeline slips; EIP-191 only still demoable |
| Base testnet faucet unreliable | Low | Medium | Use Alchemy/Infura for gas drops, or mainnet if testnet fails |

## Resources Needed

- **1 Foundry/Rust developer**: Contract + circuit
- **1 TypeScript developer**: Session verifier + mock server
- **1 Frontend dev**: Next.js demo UI
- **ZK tooling**: Risc0 toolchain (`cargo risc0 install`), Foundry
- **RPC**: Alchemy or Infura for Base Sepolia
- **Block explorer**: Basescan API key
- **Wallet**: MetaMask + Safe for testing

## Verification Checklist

Every testing doc scenario mapped:

| Test Scenario | Task |
|---------------|------|
| Deposit + Merkle root | 1.2, 1.3 |
| EIP-191 verify session | 1.5, 1.6 |
| ZK proof generation | 2.1 |
| ZK offchain verify | 2.2 |
| Double-spend slash | 1.4 |
| Session revocation | 1.5 |
| Concurrent agents unlinkable | 1.6 + 3.1 |
| Demo flow < 5min | 3.2 |
| Slash dashboard | 3.4 |
