// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.20;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/// @notice The one-input Poseidon permutation used for commitments.
interface IPoseidonT2 {
    function hash(uint256[1] calldata input) external view returns (uint256);
}

/// @notice The two-input Poseidon permutation used for Merkle nodes.
interface IPoseidonT3 {
    function hash(uint256[2] calldata input) external view returns (uint256);
}

/// @notice The three-input Poseidon permutation used for leaves and nullifiers.
interface IPoseidonT4 {
    function hash(uint256[3] calldata input) external view returns (uint256);
}

/// @notice A verifier adapter for the generated Groth16 spend verifier.
///
/// The adapter owns the generated verifier ABI and returns the public metadata
/// that this contract must bind to the immutable deployment domain and the
/// historical Merkle-root set.  The spend payload itself is opaque to the bond
/// contract so the x402 transport never has to know an account or commitment.
interface ISpendVerifier {
    function verifySpend(
        bytes32 commitment,
        uint256 signal,
        uint256 nullifier,
        uint256 share,
        bytes calldata proof
    ) external view returns (bool valid, bytes32 root, uint256 timestamp, bytes32 domain);
}

/// @title PrivateCreditBond
/// @notice Immutable Base USDC escrow for Stripe-backed private API credits.
/// @dev This contract holds only refundable bonds.  Service fees, Stripe
///      orders, accounts, prompts, responses, and secrets remain off-chain.
contract PrivateCreditBond is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BN254_FIELD_ORDER =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 public constant TREE_DEPTH = 20;
    uint256 public constant TREE_SIZE = uint256(1) << TREE_DEPTH;
    uint256 public constant VALIDITY_PERIOD = 30 days;
    uint256 public constant CHALLENGE_PERIOD = 7 days;
    /// @dev The pilot compiles exactly one funded tier. Additional SKUs need a
    ///      new tier row, a new circuit freeze, and a new deployment.
    uint8 public constant FUNDED_TIER_ID = 0;
    uint256 public constant FUNDED_TIER_ALLOWANCE = 250;
    uint256 public constant FUNDED_TIER_BOND = 20_000_000;

    enum BundleState {
        None,
        Active,
        Released,
        Slashed
    }

    struct Bundle {
        BundleState state;
        uint8 tierId;
        uint64 expiry;
        uint32 leafIndex;
        uint256 bondAmount;
    }

    IERC20 public immutable usdc;
    address public immutable sponsor;
    address public immutable refundVault;
    address public immutable treasury;
    address public immutable poseidonT2;
    address public immutable poseidonT3;
    address public immutable poseidonT4;
    address public immutable spendVerifier;
    bytes32 public immutable deploymentDomain;

    bytes32 public currentRoot;
    uint256 public leafCount;
    uint256[TREE_DEPTH + 1] public zeroHashes;
    /// @dev The rightmost populated node at each level. Keeping the frontier
    ///      on-chain makes every published root an actual append-only Merkle
    ///      root instead of a root for an isolated leaf plus zero siblings.
    bytes32[TREE_DEPTH] public filledSubtrees;

    mapping(bytes32 => bool) private _knownRoots;
    mapping(uint256 => bytes32) public rootAt;
    mapping(bytes32 => Bundle) public bundles;
    mapping(uint256 => bool) public spentNullifiers;

    event BundleFunded(
        bytes32 indexed commitment,
        uint8 indexed tierId,
        uint64 expiry,
        uint256 leafIndex,
        uint256 bondAmount,
        bytes32 root
    );
    event MerkleRootUpdated(bytes32 indexed root, uint256 indexed leafIndex);
    event BondSlashed(
        bytes32 indexed commitment,
        uint256 indexed nullifier,
        address indexed reporter,
        uint256 reporterAmount,
        uint256 treasuryAmount
    );
    event BondReleased(bytes32 indexed commitment, uint256 bondAmount, address indexed recipient);

    error OnlySponsor();
    error InvalidAddress();
    error InvalidCommitment();
    error InvalidTier();
    error AlreadyFunded();
    error TreeFull();
    error TerminalState();
    error NotMature();
    error NotChallengePeriod();
    error InvalidProof();
    error NullifierAlreadySpent();
    error FieldElementOutOfRange();

    constructor(
        address usdc_,
        address sponsor_,
        address refundVault_,
        address treasury_,
        address poseidonT2_,
        address poseidonT3_,
        address poseidonT4_,
        address spendVerifier_,
        bytes32 deploymentDomain_
    ) {
        if (
            usdc_ == address(0) || sponsor_ == address(0) || refundVault_ == address(0)
                || treasury_ == address(0) || poseidonT2_ == address(0) || poseidonT3_ == address(0)
                || poseidonT4_ == address(0) || spendVerifier_ == address(0)
        ) revert InvalidAddress();
        if (deploymentDomain_ == bytes32(0)) revert InvalidAddress();

        usdc = IERC20(usdc_);
        sponsor = sponsor_;
        refundVault = refundVault_;
        treasury = treasury_;
        poseidonT2 = poseidonT2_;
        poseidonT3 = poseidonT3_;
        poseidonT4 = poseidonT4_;
        spendVerifier = spendVerifier_;
        deploymentDomain = deploymentDomain_;

        zeroHashes[0] = 0;
        for (uint256 i = 1; i <= TREE_DEPTH; ++i) {
            zeroHashes[i] = _hash2(zeroHashes[i - 1], zeroHashes[i - 1]);
        }
        currentRoot = bytes32(zeroHashes[TREE_DEPTH]);
        _knownRoots[currentRoot] = true;
        rootAt[0] = currentRoot;
    }

    modifier onlySponsor() {
        if (msg.sender != sponsor) revert OnlySponsor();
        _;
    }

    /// @notice Return the fixed tier allowance and refundable USDC bond.
    /// @dev USDC uses six decimals, so the bond is 20_000_000 = $20. The
    ///      allowance is enforced in the circuit; it is returned here so the
    ///      single funded SKU stays auditable from the contract.
    function tierConfig(uint8 tierId) public pure returns (uint256 allowance, uint256 bondAmount) {
        if (tierId != FUNDED_TIER_ID) revert InvalidTier();
        return (FUNDED_TIER_ALLOWANCE, FUNDED_TIER_BOND);
    }

    function tierAllowance(uint8 tierId) external pure returns (uint256) {
        (uint256 allowance,) = tierConfig(tierId);
        return allowance;
    }

    function tierBondAmount(uint8 tierId) external pure returns (uint256) {
        (, uint256 bondAmount) = tierConfig(tierId);
        return bondAmount;
    }

    function knownRoot(bytes32 root) external view returns (bool) {
        return _knownRoots[root];
    }

    /// @notice Sponsor deposits the matching USDC bond and appends a leaf.
    function fundBundle(bytes32 commitment, uint8 tierId) external onlySponsor nonReentrant {
        if (commitment == bytes32(0) || uint256(commitment) >= BN254_FIELD_ORDER) revert InvalidCommitment();
        if (bundles[commitment].state != BundleState.None) revert AlreadyFunded();
        if (leafCount >= TREE_SIZE) revert TreeFull();
        (, uint256 bondAmount) = tierConfig(tierId);

        uint64 expiry = uint64(block.timestamp + VALIDITY_PERIOD);
        uint256 leaf = _hash3(uint256(commitment), uint256(tierId), uint256(expiry));
        uint256 index = leafCount;
        uint256 root = _insertLeaf(index, leaf);

        bundles[commitment] = Bundle({
            state: BundleState.Active,
            tierId: tierId,
            expiry: expiry,
            leafIndex: uint32(index),
            bondAmount: bondAmount
        });
        leafCount = index + 1;
        currentRoot = bytes32(root);
        rootAt[leafCount] = currentRoot;
        _knownRoots[currentRoot] = true;

        usdc.safeTransferFrom(sponsor, address(this), bondAmount);

        emit MerkleRootUpdated(currentRoot, index);
        emit BundleFunded(commitment, tierId, expiry, index, bondAmount, currentRoot);
    }

    /// @notice Permissionlessly slash two distinct signals for one nullifier.
    /// @dev The verifier adapter checks Groth16 proofs and returns each proof's
    ///      root/timestamp/domain. Two transcripts of the restored statement
    ///      `share = secret + slotBlinding * requestSignal` recover the slot
    ///      blinding and then the secret, and Poseidon must bind both back to
    ///      the funded credential. Neither value is emitted.
    function slashBundle(
        bytes32 commitment,
        uint256 nullifier,
        uint256 signal1,
        uint256 share1,
        bytes calldata proof1,
        uint256 signal2,
        uint256 share2,
        bytes calldata proof2
    ) external nonReentrant {
        Bundle storage bundle = bundles[commitment];
        if (bundle.state != BundleState.Active) revert TerminalState();
        if (block.timestamp >= uint256(bundle.expiry) + CHALLENGE_PERIOD) revert NotChallengePeriod();

        _checkField(nullifier);
        _checkField(signal1);
        _checkField(signal2);
        _checkField(share1);
        _checkField(share2);
        // A zero signal or nullifier is never a spend the circuit can produce,
        // and equal signals cannot separate the two unknowns.
        if (signal1 == signal2) revert InvalidProof();
        if (nullifier == 0 || signal1 == 0 || signal2 == 0) revert InvalidProof();
        if (spentNullifiers[nullifier]) revert NullifierAlreadySpent();

        _verifyAndCheckProof(commitment, signal1, nullifier, share1, proof1, bundle.expiry);
        _verifyAndCheckProof(commitment, signal2, nullifier, share2, proof2, bundle.expiry);

        uint256 blinding = _recoverSlotBlinding(signal1, share1, signal2, share2);
        if (blinding == 0 || _hash1(blinding) != nullifier) revert InvalidProof();

        uint256 secret = _recoverSecret(share1, blinding, signal1);
        if (secret == 0 || _hash1(secret) != uint256(commitment)) revert InvalidProof();

        spentNullifiers[nullifier] = true;
        bundle.state = BundleState.Slashed;

        _settleSlash(commitment, nullifier, bundle.bondAmount);
    }

    /// @notice Release an unchallenged bond to the refund vault.
    function releaseBond(bytes32 commitment) external nonReentrant {
        Bundle storage bundle = bundles[commitment];
        if (bundle.state != BundleState.Active) revert TerminalState();
        if (block.timestamp < uint256(bundle.expiry) + CHALLENGE_PERIOD) revert NotMature();

        bundle.state = BundleState.Released;
        usdc.safeTransfer(refundVault, bundle.bondAmount);
        emit BondReleased(commitment, bundle.bondAmount, refundVault);
    }

    /// @notice Compute a leaf using the contract's Poseidon deployment.
    function computeLeaf(bytes32 commitment, uint8 tierId, uint64 expiry) external view returns (bytes32) {
        tierConfig(tierId);
        if (commitment == bytes32(0) || uint256(commitment) >= BN254_FIELD_ORDER) revert InvalidCommitment();
        return bytes32(_hash3(uint256(commitment), uint256(tierId), uint256(expiry)));
    }

    /// @notice Verify a depth-20 witness against any retained root.
    function verifyMembership(bytes32 leaf, uint256[] calldata path, uint256 index, bytes32 root)
        external
        view
        returns (bool)
    {
        if (path.length != TREE_DEPTH || !_knownRoots[root] || index >= TREE_SIZE) return false;
        uint256 node = uint256(leaf);
        for (uint256 i = 0; i < TREE_DEPTH; ++i) {
            node = index % 2 == 0 ? _hash2(node, path[i]) : _hash2(path[i], node);
            index /= 2;
        }
        return bytes32(node) == root;
    }

    function _checkProofContext(bytes32 root, uint256 timestamp, uint64 expiry, bytes32 domain) internal view {
        if (!_knownRoots[root] || domain != deploymentDomain || timestamp > block.timestamp || timestamp >= expiry) {
            revert InvalidProof();
        }
    }

    function _verifyAndCheckProof(
        bytes32 commitment,
        uint256 signal,
        uint256 nullifier,
        uint256 share,
        bytes calldata proof,
        uint64 expiry
    ) internal view {
        (bool valid, bytes32 root, uint256 timestamp, bytes32 domain) = ISpendVerifier(spendVerifier).verifySpend(
            commitment, signal, nullifier, share, proof
        );
        if (!valid) revert InvalidProof();
        _checkProofContext(root, timestamp, expiry, domain);
    }

    /// @dev `slotBlinding = (share1 - share2) / (signal1 - signal2)`.
    function _recoverSlotBlinding(uint256 signal1, uint256 share1, uint256 signal2, uint256 share2)
        internal
        pure
        returns (uint256)
    {
        uint256 denominator = addmod(signal1, BN254_FIELD_ORDER - signal2, BN254_FIELD_ORDER);
        if (denominator == 0) revert InvalidProof();
        uint256 numerator = addmod(share1, BN254_FIELD_ORDER - share2, BN254_FIELD_ORDER);
        return mulmod(numerator, _inverse(denominator), BN254_FIELD_ORDER);
    }

    /// @dev `secret = share - slotBlinding * signal`.
    function _recoverSecret(uint256 share, uint256 blinding, uint256 signal) internal pure returns (uint256) {
        return addmod(share, BN254_FIELD_ORDER - mulmod(blinding, signal, BN254_FIELD_ORDER), BN254_FIELD_ORDER);
    }

    function _settleSlash(bytes32 commitment, uint256 nullifier, uint256 bondAmount) internal {
        uint256 reporterAmount = bondAmount / 2;
        uint256 treasuryAmount = bondAmount - reporterAmount;
        usdc.safeTransfer(msg.sender, reporterAmount);
        usdc.safeTransfer(treasury, treasuryAmount);
        emit BondSlashed(commitment, nullifier, msg.sender, reporterAmount, treasuryAmount);
    }

    function _checkField(uint256 value) internal pure {
        if (value >= BN254_FIELD_ORDER) revert FieldElementOutOfRange();
    }

    function _hash1(uint256 value) internal view returns (uint256) {
        uint256[1] memory input = [value];
        return IPoseidonT2(poseidonT2).hash(input);
    }

    function _hash2(uint256 left, uint256 right) internal view returns (uint256) {
        uint256[2] memory input = [left, right];
        return IPoseidonT3(poseidonT3).hash(input);
    }

    function _hash3(uint256 first, uint256 second, uint256 third) internal view returns (uint256) {
        uint256[3] memory input = [first, second, third];
        return IPoseidonT4(poseidonT4).hash(input);
    }

    function _insertLeaf(uint256 index, uint256 leaf) internal returns (uint256 node) {
        node = leaf;
        uint256 currentIndex = index;
        for (uint256 i = 0; i < TREE_DEPTH; ++i) {
            if (currentIndex % 2 == 0) {
                filledSubtrees[i] = bytes32(node);
                node = _hash2(node, zeroHashes[i]);
            } else {
                node = _hash2(uint256(filledSubtrees[i]), node);
            }
            currentIndex /= 2;
        }
    }

    function _inverse(uint256 value) internal pure returns (uint256 result) {
        result = 1;
        uint256 base = value;
        uint256 exponent = BN254_FIELD_ORDER - 2;
        while (exponent != 0) {
            if (exponent & 1 == 1) result = mulmod(result, base, BN254_FIELD_ORDER);
            base = mulmod(base, base, BN254_FIELD_ORDER);
            exponent >>= 1;
        }
    }
}
