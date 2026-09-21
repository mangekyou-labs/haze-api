// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/// @title DepositContract - ZK-API Usage Credits deposit registry
/// @notice Stores deposit commitments in a keccak256 Merkle tree, tracks nullifiers
/// @dev Uses keccak256 for MVP. Poseidon-2 deferred per design doc deviation.
///      For production, replace _hashPair with Poseidon-2 field-element hash.
contract DepositContract is ReentrancyGuard {
    // ═══════════════════════════════════════════════════════
    // Constants
    // ═══════════════════════════════════════════════════════

    /// @dev Depth of the Merkle tree (supports 2^16 = 65536 leaves)
    uint256 public constant TREE_DEPTH = 16;
    uint256 public constant TREE_SIZE = 2 ** TREE_DEPTH; // 65536

    /// @dev Slashing parameters
    uint256 public constant RLN_STAKE = 0.1 ether;
    uint256 public constant POLICY_STAKE = 0.05 ether;

    // ═══════════════════════════════════════════════════════
    // Structs
    // ═══════════════════════════════════════════════════════

    struct Deposit {
        uint256 amount;
        address depositor;
        uint256 expiry;
        bool withdrawn;
    }

    // ═══════════════════════════════════════════════════════
    // Merkle Tree State
    // ═══════════════════════════════════════════════════════

    /// @dev Current Merkle root
    bytes32 public currentRoot;

    /// @dev Number of leaves inserted
    uint256 public leafCount;

    /// @dev Historical roots
    mapping(uint256 => bytes32) public roots;

    /// @dev Zero hashes for each level (precomputed for gas efficiency)
    bytes32[TREE_DEPTH + 1] public zeroHashes;

    // ═══════════════════════════════════════════════════════
    // Deposit State
    // ═══════════════════════════════════════════════════════

    /// @dev Commitment → Deposit data
    mapping(bytes32 => Deposit) public commitments;

    /// @dev Spent nullifiers
    mapping(bytes32 => bool) public nullifiers;

    // ═══════════════════════════════════════════════════════
    // Events
    // ═══════════════════════════════════════════════════════

    event Deposited(bytes32 indexed commitment, uint256 amount, address depositor);
    event NullifierSpent(bytes32 indexed nullifier);
    event Slashed(bytes32 indexed commitment, address submitter);

    // ═══════════════════════════════════════════════════════
    // Custom Errors
    // ═══════════════════════════════════════════════════════

    error MustSendETH();
    error CommitmentCannotBeZero();
    error AlreadyWithdrawn();
    error NotDepositor();
    error TreeFull();
    error InvalidProof();

    // ═══════════════════════════════════════════════════════
    // Constructor
    // ═══════════════════════════════════════════════════════

    constructor() {
        // Precompute zero hashes: zeroHashes[0] = bytes32(0)
        // zeroHashes[i] = keccak256(zeroHashes[i-1] || zeroHashes[i-1])
        zeroHashes[0] = bytes32(0);
        for (uint256 i = 1; i <= TREE_DEPTH; i++) {
            zeroHashes[i] = keccak256(abi.encode(zeroHashes[i - 1], zeroHashes[i - 1]));
        }
        currentRoot = zeroHashes[TREE_DEPTH];
    }

    // ═══════════════════════════════════════════════════════
    // Deposit
    // ═══════════════════════════════════════════════════════

    /// @notice Deposit ETH and register a commitment in the Merkle tree
    /// @param commitment Hash of the user's secret k (identity commitment)
    function deposit(
        bytes32 commitment
    ) external payable nonReentrant {
        if (msg.value == 0) revert MustSendETH();
        if (commitment == bytes32(0)) revert CommitmentCannotBeZero();
        if (leafCount >= TREE_SIZE) revert TreeFull();

        // Store previous root before update
        roots[leafCount] = currentRoot;

        // Insert leaf and update root
        currentRoot = _insertLeaf(leafCount, commitment);

        commitments[commitment] = Deposit({
            amount: msg.value,
            depositor: msg.sender,
            expiry: 0,
            withdrawn: false
        });

        leafCount++;

        emit Deposited(commitment, msg.value, msg.sender);
    }

    // ═══════════════════════════════════════════════════════
    // Withdraw
    // ═══════════════════════════════════════════════════════

    /// @notice Withdraw deposited ETH to a recipient
    /// @param commitment The commitment that was deposited
    /// @param recipient Address to send the ETH to
    function withdraw(
        bytes32 commitment,
        address recipient
    ) external nonReentrant {
        Deposit memory dep = commitments[commitment];

        if (dep.withdrawn) revert AlreadyWithdrawn();
        if (dep.depositor != msg.sender) revert NotDepositor();

        commitments[commitment].withdrawn = true;

        // CEI: state updated before external call
        (bool success, ) = recipient.call{value: dep.amount}("");
        require(success, "transfer failed");

        emit NullifierSpent(commitment);
    }

    // ═══════════════════════════════════════════════════════
    // Slash (placeholder - full implementation in task 1.4)
    // ═══════════════════════════════════════════════════════

    /// @notice Slash a commitment given two ZK proofs with same ticketIndex
    /// @dev Full RLN extraction + slash in task 1.4
    function slash(
        bytes32,
        bytes32,
        bytes calldata,
        bytes calldata
    ) external pure {
        revert("slash not implemented - see task 1.4");
    }

    // ═══════════════════════════════════════════════════════
    // Merkle Tree Operations (keccak256)
    // ═══════════════════════════════════════════════════════

    /// @dev Insert a leaf at index and compute new root
    /// @dev Uses keccak256 (Poseidon deferred per design doc)
    function _insertLeaf(
        uint256 index,
        bytes32 leaf
    ) internal view returns (bytes32 newRoot) {
        newRoot = leaf;

        for (uint256 i = 0; i < TREE_DEPTH; i++) {
            if (index % 2 == 0) {
                // Current node is left child
                newRoot = _hashPair(newRoot, zeroHashes[i]);
            } else {
                // Current node is right child
                newRoot = _hashPair(zeroHashes[i], newRoot);
            }
            index /= 2;
        }
    }

    /// @dev Hash two bytes32 values
    function _hashPair(bytes32 left, bytes32 right) internal pure returns (bytes32) {
        return keccak256(abi.encode(left, right));
    }

    /// @notice Verify a Merkle proof
    /// @param leaf The commitment to verify
    /// @param path Merkle proof sibling hashes
    /// @param index Index of the leaf in the tree
    /// @return true if the proof is valid
    function verifyProof(
        bytes32 leaf,
        bytes32[] memory path,
        uint256 index
    ) external view returns (bool) {
        if (path.length != TREE_DEPTH) revert InvalidProof();

        bytes32 root = leaf;

        for (uint256 i = 0; i < TREE_DEPTH; i++) {
            if (index % 2 == 0) {
                root = _hashPair(root, path[i]);
            } else {
                root = _hashPair(path[i], root);
            }
            index /= 2;
        }

        return root == currentRoot;
    }

    /// @notice Get historical root at a given leaf count
    /// @param count Leaf count when the root was stored
    function getHistoricalRoot(uint256 count) external view returns (bytes32) {
        return roots[count];
    }
}
