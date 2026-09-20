// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {PrivateCreditBond, IPoseidonT2, IPoseidonT3, IPoseidonT4, ISpendVerifier} from "../../src/PrivateCreditBond.sol";

contract MockUSDC is IERC20 {
    string public constant name = "USD Coin";
    string public constant symbol = "USDC";
    uint8 public constant decimals = 6;
    uint256 public override totalSupply;
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        require(approved >= amount, "allowance");
        if (approved != type(uint256).max) allowance[from][msg.sender] = approved - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

/// @dev Keccak stand-ins for the Poseidon deployments. Proof acceptance is
///      mocked, but every test below derives the commitment, nullifier, leaf,
///      and shares through the restored algebraic statement, so the same
///      assertions hold once the contract sits behind a real Poseidon.
contract MockPoseidonT2 is IPoseidonT2 {
    function hash(uint256[1] calldata input) external pure returns (uint256) {
        return uint256(keccak256(abi.encode(input))) % 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    }
}

contract MockPoseidonT3 is IPoseidonT3 {
    function hash(uint256[2] calldata input) external pure returns (uint256) {
        return uint256(keccak256(abi.encode(input))) % 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    }
}

contract MockPoseidonT4 is IPoseidonT4 {
    function hash(uint256[3] calldata input) external pure returns (uint256) {
        return uint256(keccak256(abi.encode(input))) % 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    }
}

contract MockSpendVerifier is ISpendVerifier {
    struct Result {
        bool valid;
        bytes32 root;
        uint256 timestamp;
        bytes32 domain;
    }

    mapping(bytes32 => Result) public results;

    function setResult(bytes calldata proof, Result calldata result) external {
        results[keccak256(proof)] = result;
    }

    function verifySpend(
        bytes32,
        uint256,
        uint256,
        uint256,
        bytes calldata proof
    ) external view returns (bool valid, bytes32 root, uint256 timestamp, bytes32 domain) {
        Result memory result = results[keccak256(proof)];
        return (result.valid, result.root, result.timestamp, result.domain);
    }
}

/// @dev Shared wiring, Poseidon helpers, and restored-algebra fixtures.
abstract contract BondFixture is Test {
    uint256 internal constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint8 internal constant FUNDED_TIER = 0;
    uint256 internal constant FUNDED_ALLOWANCE = 250;
    uint256 internal constant FUNDED_BOND = 20_000_000;
    uint256 internal constant CHALLENGE_PERIOD = 7 days;
    uint256 internal constant VALIDITY_PERIOD = 30 days;
    address internal constant SPONSOR = address(0x100);
    address internal constant REFUND_VAULT = address(0x200);
    address internal constant TREASURY = address(0x300);
    address internal constant REPORTER = address(0x400);
    bytes32 internal constant DOMAIN = bytes32(uint256(0xB4532));

    MockUSDC internal usdc;
    MockPoseidonT2 internal poseidonT2;
    MockPoseidonT3 internal poseidonT3;
    MockPoseidonT4 internal poseidonT4;
    MockSpendVerifier internal verifier;
    PrivateCreditBond internal bond;

    /// @dev One funded credential and the values the restored algebra recovers.
    struct Bundle {
        uint256 secret;
        uint256 blinding;
        bytes32 commitment;
        uint256 nullifier;
    }

    /// @dev USDC balances that must move by exactly one bond when a slash lands.
    struct Balances {
        uint256 reporter;
        uint256 treasury;
        uint256 escrow;
    }

    function _balances() internal view returns (Balances memory balances) {
        balances.reporter = usdc.balanceOf(REPORTER);
        balances.treasury = usdc.balanceOf(TREASURY);
        balances.escrow = usdc.balanceOf(address(bond));
    }

    function _deploy() internal {
        // Real unix-second timestamps: proof timestamps are compared against
        // block.timestamp and a bundle's expiry, and slash evidence may predate
        // the report.
        vm.warp(1_800_000_000);
        usdc = new MockUSDC();
        poseidonT2 = new MockPoseidonT2();
        poseidonT3 = new MockPoseidonT3();
        poseidonT4 = new MockPoseidonT4();
        verifier = new MockSpendVerifier();
        bond = new PrivateCreditBond(
            address(usdc),
            SPONSOR,
            REFUND_VAULT,
            TREASURY,
            address(poseidonT2),
            address(poseidonT3),
            address(poseidonT4),
            address(verifier),
            DOMAIN
        );
        // Enough USDC that the invariant run is limited by interleaving rather
        // than by the sponsor's float.
        usdc.mint(SPONSOR, 1_000_000_000_000_000);
        vm.prank(SPONSOR);
        usdc.approve(address(bond), type(uint256).max);
    }

    function _hash1(uint256 value) internal view returns (uint256) {
        uint256[1] memory input = [value];
        return poseidonT2.hash(input);
    }

    function _hash2(uint256 left, uint256 right) internal view returns (uint256) {
        uint256[2] memory input = [left, right];
        return poseidonT3.hash(input);
    }

    function _hash3(uint256 first, uint256 second, uint256 third) internal view returns (uint256) {
        uint256[3] memory input = [first, second, third];
        return poseidonT4.hash(input);
    }

    /// @dev `commitment = Poseidon(secret)` and `nullifier = Poseidon(slotBlinding)`.
    function _bundle(uint256 secret, uint256 blinding) internal view returns (Bundle memory bundle_) {
        bundle_.secret = secret;
        bundle_.blinding = blinding;
        bundle_.commitment = bytes32(_hash1(secret));
        bundle_.nullifier = _hash1(blinding);
    }

    /// @dev Restored statement: `share = secret + slotBlinding * requestSignal`.
    function _share(Bundle memory bundle_, uint256 signal) internal pure returns (uint256) {
        return addmod(bundle_.secret, mulmod(bundle_.blinding, signal, FIELD), FIELD);
    }

    function _fund(Bundle memory bundle_) internal {
        vm.prank(SPONSOR);
        bond.fundBundle(bundle_.commitment, FUNDED_TIER);
    }

    function _accept(bytes memory proof, bytes32 root, uint256 timestamp) internal {
        verifier.setResult(proof, MockSpendVerifier.Result(true, root, timestamp, DOMAIN));
    }

    /// @dev Reports two conflicting restored-algebra transcripts for one bundle.
    function _slash(Bundle memory bundle_, uint256 signal1, uint256 signal2, bytes memory tag) internal {
        bytes memory proof1 = abi.encodePacked(tag, "one");
        bytes memory proof2 = abi.encodePacked(tag, "two");
        bytes32 root = bond.rootAt(1);
        _accept(proof1, root, block.timestamp);
        _accept(proof2, root, block.timestamp);
        vm.prank(REPORTER);
        bond.slashBundle(
            bundle_.commitment,
            bundle_.nullifier,
            signal1,
            _share(bundle_, signal1),
            proof1,
            signal2,
            _share(bundle_, signal2),
            proof2
        );
    }
}

contract PrivateCreditBondTest is BondFixture {
    function setUp() public {
        _deploy();
    }

    function test_singleFundedTierIsTwoHundredFiftyCreditsForATwentyDollarBond() external view {
        (uint256 allowance, uint256 bondAmount) = bond.tierConfig(FUNDED_TIER);
        assertEq(allowance, FUNDED_ALLOWANCE);
        assertEq(bondAmount, FUNDED_BOND);
        assertEq(bond.tierAllowance(FUNDED_TIER), FUNDED_ALLOWANCE);
        assertEq(bond.tierBondAmount(FUNDED_TIER), FUNDED_BOND);
    }

    function test_fundBundleStoresTierExpiryAndKnownRoot() external {
        bytes32 commitment = bytes32(uint256(123));

        vm.prank(SPONSOR);
        bond.fundBundle(commitment, FUNDED_TIER);

        (PrivateCreditBond.BundleState state, uint8 tierId, uint64 expiry, uint32 leafIndex, uint256 amount) =
            bond.bundles(commitment);
        assertEq(uint8(state), uint8(PrivateCreditBond.BundleState.Active));
        assertEq(tierId, FUNDED_TIER);
        assertEq(expiry, block.timestamp + VALIDITY_PERIOD);
        assertEq(leafIndex, 0);
        assertEq(amount, FUNDED_BOND);
        assertEq(bond.leafCount(), 1);
        assertTrue(bond.knownRoot(bond.currentRoot()));
    }

    function test_fundBundleRejectsEveryOtherTier() external {
        bytes32 commitment = bytes32(uint256(1));

        vm.startPrank(SPONSOR);
        vm.expectRevert(PrivateCreditBond.InvalidTier.selector);
        bond.fundBundle(commitment, 1);
        vm.expectRevert(PrivateCreditBond.InvalidTier.selector);
        bond.fundBundle(commitment, 2);
        vm.expectRevert(PrivateCreditBond.InvalidTier.selector);
        bond.fundBundle(commitment, type(uint8).max);
        vm.stopPrank();

        vm.expectRevert(PrivateCreditBond.InvalidTier.selector);
        bond.tierConfig(1);
        vm.expectRevert(PrivateCreditBond.InvalidTier.selector);
        bond.tierAllowance(2);
        vm.expectRevert(PrivateCreditBond.InvalidTier.selector);
        bond.tierBondAmount(3);
    }

    function test_fundBundleAppendsToTheIncrementalMerkleFrontier() external {
        bytes32 first = bytes32(uint256(123));
        bytes32 second = bytes32(uint256(456));

        vm.prank(SPONSOR);
        bond.fundBundle(first, FUNDED_TIER);
        (, , uint64 firstExpiry, , ) = bond.bundles(first);
        bytes32 firstLeaf = bond.computeLeaf(first, FUNDED_TIER, firstExpiry);

        vm.prank(SPONSOR);
        bond.fundBundle(second, FUNDED_TIER);
        (, , uint64 secondExpiry, , ) = bond.bundles(second);
        bytes32 secondLeaf = bond.computeLeaf(second, FUNDED_TIER, secondExpiry);

        uint256 node = _hash2(uint256(firstLeaf), uint256(secondLeaf));
        assertEq(bond.filledSubtrees(0), firstLeaf);
        assertEq(bond.filledSubtrees(1), bytes32(node));
        for (uint256 level = 1; level < bond.TREE_DEPTH(); ++level) {
            node = _hash2(node, bond.zeroHashes(level));
        }
        assertEq(bond.currentRoot(), bytes32(node));
        assertTrue(bond.knownRoot(bytes32(node)));
    }

    function test_historicalRootsStayUsableAfterLaterFunding() external {
        bytes32 first = bytes32(uint256(123));
        vm.prank(SPONSOR);
        bond.fundBundle(first, FUNDED_TIER);
        bytes32 firstRoot = bond.currentRoot();

        vm.prank(SPONSOR);
        bond.fundBundle(bytes32(uint256(456)), FUNDED_TIER);

        assertTrue(bond.currentRoot() != firstRoot);
        assertTrue(bond.knownRoot(firstRoot));
        assertEq(bond.rootAt(1), firstRoot);
    }

    function test_fundBundleOnlySponsorAndRejectsInvalidCommitments() external {
        vm.expectRevert(PrivateCreditBond.OnlySponsor.selector);
        bond.fundBundle(bytes32(uint256(1)), FUNDED_TIER);

        vm.startPrank(SPONSOR);
        vm.expectRevert(PrivateCreditBond.InvalidCommitment.selector);
        bond.fundBundle(bytes32(0), FUNDED_TIER);
        vm.expectRevert(PrivateCreditBond.InvalidCommitment.selector);
        bond.fundBundle(bytes32(FIELD), FUNDED_TIER);
        vm.stopPrank();
    }

    function test_fundBundleRejectsADuplicateCommitment() external {
        Bundle memory bundle_ = _bundle(987_654, 0xB11D);
        _fund(bundle_);

        vm.prank(SPONSOR);
        vm.expectRevert(PrivateCreditBond.AlreadyFunded.selector);
        bond.fundBundle(bundle_.commitment, FUNDED_TIER);
    }

    function test_releaseBondAfterMaturityReturnsBondToRefundVault() external {
        Bundle memory bundle_ = _bundle(987_654, 0xB11D);
        _fund(bundle_);

        vm.warp(block.timestamp + VALIDITY_PERIOD + CHALLENGE_PERIOD);
        uint256 beforeBalance = usdc.balanceOf(REFUND_VAULT);
        bond.releaseBond(bundle_.commitment);

        (PrivateCreditBond.BundleState state,,,,) = bond.bundles(bundle_.commitment);
        assertEq(uint8(state), uint8(PrivateCreditBond.BundleState.Released));
        assertEq(usdc.balanceOf(REFUND_VAULT), beforeBalance + FUNDED_BOND);
        assertEq(usdc.balanceOf(address(bond)), 0);

        vm.expectRevert(PrivateCreditBond.TerminalState.selector);
        bond.releaseBond(bundle_.commitment);
    }

    function test_releaseBondIsPermissionless() external {
        Bundle memory bundle_ = _bundle(987_654, 0xB11D);
        _fund(bundle_);

        vm.warp(block.timestamp + VALIDITY_PERIOD + CHALLENGE_PERIOD);
        vm.prank(address(0xDEADBEEF));
        bond.releaseBond(bundle_.commitment);

        assertEq(usdc.balanceOf(REFUND_VAULT), FUNDED_BOND);
    }

    function test_releaseBondRejectsBeforeChallengeWindow() external {
        Bundle memory bundle_ = _bundle(987_654, 0xB11D);
        _fund(bundle_);
        (, , uint64 expiry, , ) = bond.bundles(bundle_.commitment);

        vm.warp(uint256(expiry) + CHALLENGE_PERIOD - 1);
        vm.expectRevert(PrivateCreditBond.NotMature.selector);
        bond.releaseBond(bundle_.commitment);
    }

    function test_releaseAndSlashAreMutuallyExclusive() external {
        Bundle memory released = _bundle(111_111, 0xB11D);
        _fund(released);
        vm.warp(block.timestamp + VALIDITY_PERIOD + CHALLENGE_PERIOD);
        bond.releaseBond(released.commitment);

        bytes memory proof = abi.encodePacked("proof-release-race");
        _accept(proof, bond.rootAt(1), block.timestamp);
        vm.prank(REPORTER);
        vm.expectRevert(PrivateCreditBond.TerminalState.selector);
        bond.slashBundle(
            released.commitment,
            released.nullifier,
            11,
            _share(released, 11),
            proof,
            29,
            _share(released, 29),
            proof
        );
    }

    function test_slashIsRejectedAfterRelease() external {
        Bundle memory bundle_ = _bundle(222_222, 0xC0FFEE);
        _fund(bundle_);
        _slash(bundle_, 11, 29, "proof-slash-then-release");

        vm.warp(block.timestamp + VALIDITY_PERIOD + CHALLENGE_PERIOD);
        vm.expectRevert(PrivateCreditBond.TerminalState.selector);
        bond.releaseBond(bundle_.commitment);
    }

    function test_slashRecoversSlotBlindingThenSecretAndSplitsBondFiftyFifty() external {
        Bundle memory bundle_ = _bundle(987_654, 0xB11D);
        bytes memory proof1 = abi.encodePacked("proof-one");
        bytes memory proof2 = abi.encodePacked("proof-two");

        _fund(bundle_);
        _accept(proof1, bond.currentRoot(), block.timestamp);
        _accept(proof2, bond.currentRoot(), block.timestamp);

        Balances memory before = _balances();
        vm.prank(REPORTER);
        bond.slashBundle(
            bundle_.commitment,
            bundle_.nullifier,
            11,
            _share(bundle_, 11),
            proof1,
            29,
            _share(bundle_, 29),
            proof2
        );

        (PrivateCreditBond.BundleState state,,,,) = bond.bundles(bundle_.commitment);
        assertEq(uint8(state), uint8(PrivateCreditBond.BundleState.Slashed));
        assertEq(usdc.balanceOf(REPORTER) - before.reporter, FUNDED_BOND / 2);
        assertEq(usdc.balanceOf(TREASURY) - before.treasury, FUNDED_BOND / 2);
        assertEq(usdc.balanceOf(address(bond)), before.escrow - FUNDED_BOND);
        assertTrue(bond.spentNullifiers(bundle_.nullifier));
    }

    function test_slashRejectsANullifierThatDoesNotBindTheRecoveredSlotBlinding() external {
        Bundle memory bundle_ = _bundle(987_654, 0xB11D);
        bytes memory proof1 = abi.encodePacked("proof-bad-nullifier-one");
        bytes memory proof2 = abi.encodePacked("proof-bad-nullifier-two");

        _fund(bundle_);
        bytes32 root = bond.currentRoot();
        _accept(proof1, root, block.timestamp);
        _accept(proof2, root, block.timestamp);

        vm.prank(REPORTER);
        vm.expectRevert(PrivateCreditBond.InvalidProof.selector);
        bond.slashBundle(
            bundle_.commitment,
            bundle_.nullifier + 1,
            11,
            _share(bundle_, 11),
            proof1,
            29,
            _share(bundle_, 29),
            proof2
        );
    }

    function test_slashRejectsASecretThatDoesNotOpenTheFundedCommitment() external {
        Bundle memory funded = _bundle(111_111, 0xB11D);
        Bundle memory impostor = _bundle(222_222, 0xB11D);
        bytes memory proof1 = abi.encodePacked("proof-bad-secret-one");
        bytes memory proof2 = abi.encodePacked("proof-bad-secret-two");

        _fund(funded);
        bytes32 root = bond.currentRoot();
        _accept(proof1, root, block.timestamp);
        _accept(proof2, root, block.timestamp);

        vm.prank(REPORTER);
        vm.expectRevert(PrivateCreditBond.InvalidProof.selector);
        bond.slashBundle(
            funded.commitment,
            funded.nullifier,
            11,
            _share(impostor, 11),
            proof1,
            29,
            _share(impostor, 29),
            proof2
        );
    }

    function test_slashRejectsEqualSignals() external {
        Bundle memory bundle_ = _bundle(987_654, 0xB11D);
        bytes memory proof = abi.encodePacked("proof-equal-signal");
        _fund(bundle_);
        _accept(proof, bond.currentRoot(), block.timestamp);

        vm.prank(REPORTER);
        vm.expectRevert(PrivateCreditBond.InvalidProof.selector);
        bond.slashBundle(bundle_.commitment, bundle_.nullifier, 11, 13, proof, 11, 17, proof);
    }

    function test_slashRejectsZeroSignals() external {
        Bundle memory bundle_ = _bundle(987_654, 0xB11D);
        bytes memory proof = abi.encodePacked("proof-zero-signal");
        _fund(bundle_);
        _accept(proof, bond.currentRoot(), block.timestamp);

        vm.startPrank(REPORTER);
        vm.expectRevert(PrivateCreditBond.InvalidProof.selector);
        bond.slashBundle(bundle_.commitment, bundle_.nullifier, 0, _share(bundle_, 0), proof, 29, _share(bundle_, 29), proof);
        vm.expectRevert(PrivateCreditBond.InvalidProof.selector);
        bond.slashBundle(bundle_.commitment, bundle_.nullifier, 11, _share(bundle_, 11), proof, 0, _share(bundle_, 0), proof);
        vm.stopPrank();
    }

    function test_slashRejectsAZeroRecoveredSlotBlinding() external {
        Bundle memory bundle_ = _bundle(987_654, 0);
        bytes memory proof1 = abi.encodePacked("proof-zero-blinding-one");
        bytes memory proof2 = abi.encodePacked("proof-zero-blinding-two");

        _fund(bundle_);
        bytes32 root = bond.currentRoot();
        _accept(proof1, root, block.timestamp);
        _accept(proof2, root, block.timestamp);

        // blinding == 0 makes both shares equal to the secret, so recovery
        // yields zero. The circuit forbids that witness; slash must too.
        vm.prank(REPORTER);
        vm.expectRevert(PrivateCreditBond.InvalidProof.selector);
        bond.slashBundle(bundle_.commitment, bundle_.nullifier, 11, _share(bundle_, 11), proof1, 29, _share(bundle_, 29), proof2);
    }

    function test_slashRejectsOutOfRangeFieldElements() external {
        Bundle memory bundle_ = _bundle(987_654, 0xB11D);
        bytes memory proof = abi.encodePacked("proof-out-of-range");
        _fund(bundle_);
        _accept(proof, bond.currentRoot(), block.timestamp);

        uint256 share = _share(bundle_, 11);
        vm.startPrank(REPORTER);
        vm.expectRevert(PrivateCreditBond.FieldElementOutOfRange.selector);
        bond.slashBundle(bundle_.commitment, FIELD, 11, share, proof, 29, share, proof);
        vm.expectRevert(PrivateCreditBond.FieldElementOutOfRange.selector);
        bond.slashBundle(bundle_.commitment, bundle_.nullifier, FIELD, share, proof, 29, share, proof);
        vm.expectRevert(PrivateCreditBond.FieldElementOutOfRange.selector);
        bond.slashBundle(bundle_.commitment, bundle_.nullifier, 11, FIELD, proof, 29, share, proof);
        vm.expectRevert(PrivateCreditBond.FieldElementOutOfRange.selector);
        bond.slashBundle(bundle_.commitment, bundle_.nullifier, 11, share, proof, FIELD, share, proof);
        vm.expectRevert(PrivateCreditBond.FieldElementOutOfRange.selector);
        bond.slashBundle(bundle_.commitment, bundle_.nullifier, 11, share, proof, 29, FIELD, proof);
        vm.stopPrank();
    }

    function test_slashRejectsUnknownRootAndForeignDomain() external {
        Bundle memory bundle_ = _bundle(987_654, 0xB11D);
        bytes memory proof1 = abi.encodePacked("proof-unknown-root");
        bytes memory proof2 = abi.encodePacked("proof-foreign-domain");
        _fund(bundle_);
        bytes32 root = bond.currentRoot();

        verifier.setResult(proof1, MockSpendVerifier.Result(true, bytes32(uint256(0xBAD)), block.timestamp, DOMAIN));
        _accept(proof2, root, block.timestamp);
        vm.prank(REPORTER);
        vm.expectRevert(PrivateCreditBond.InvalidProof.selector);
        bond.slashBundle(bundle_.commitment, bundle_.nullifier, 11, _share(bundle_, 11), proof1, 29, _share(bundle_, 29), proof2);

        verifier.setResult(proof1, MockSpendVerifier.Result(true, root, block.timestamp, bytes32(uint256(1))));
        vm.prank(REPORTER);
        vm.expectRevert(PrivateCreditBond.InvalidProof.selector);
        bond.slashBundle(bundle_.commitment, bundle_.nullifier, 11, _share(bundle_, 11), proof1, 29, _share(bundle_, 29), proof2);
    }

    function test_slashRejectsFutureAndExpiredProofTimestamps() external {
        Bundle memory bundle_ = _bundle(987_654, 0xB11D);
        bytes memory proof1 = abi.encodePacked("proof-future");
        bytes memory proof2 = abi.encodePacked("proof-expired");
        _fund(bundle_);
        (, , uint64 expiry, , ) = bond.bundles(bundle_.commitment);
        bytes32 root = bond.currentRoot();

        _accept(proof2, root, block.timestamp);
        _accept(proof1, root, block.timestamp + 1);
        vm.prank(REPORTER);
        vm.expectRevert(PrivateCreditBond.InvalidProof.selector);
        bond.slashBundle(bundle_.commitment, bundle_.nullifier, 11, _share(bundle_, 11), proof1, 29, _share(bundle_, 29), proof2);

        _accept(proof1, root, expiry);
        _accept(proof2, root, expiry);
        vm.prank(REPORTER);
        vm.expectRevert(PrivateCreditBond.InvalidProof.selector);
        bond.slashBundle(bundle_.commitment, bundle_.nullifier, 11, _share(bundle_, 11), proof1, 29, _share(bundle_, 29), proof2);
    }

    function test_slashAcceptsEvidenceOlderThanAnySpendWindow() external {
        Bundle memory bundle_ = _bundle(987_654, 0xB11D);
        uint256 signal1 = 11;
        uint256 signal2 = 29;
        bytes memory proof1 = abi.encodePacked("proof-old-one");
        bytes memory proof2 = abi.encodePacked("proof-old-two");

        _fund(bundle_);
        bytes32 root = bond.currentRoot();
        // Six hours old and far outside any 300s issuedAt window. Slash
        // evidence is not a spend authorization and carries no such window.
        _accept(proof1, root, block.timestamp - 6 hours);
        _accept(proof2, root, block.timestamp - 6 hours);

        vm.prank(REPORTER);
        bond.slashBundle(
            bundle_.commitment,
            bundle_.nullifier,
            signal1,
            _share(bundle_, signal1),
            proof1,
            signal2,
            _share(bundle_, signal2),
            proof2
        );

        (PrivateCreditBond.BundleState state,,,,) = bond.bundles(bundle_.commitment);
        assertEq(uint8(state), uint8(PrivateCreditBond.BundleState.Slashed));
    }

    function test_slashRejectsAfterTheChallengePeriod() external {
        Bundle memory bundle_ = _bundle(987_654, 0xB11D);
        bytes memory proof = abi.encodePacked("proof-late");
        _fund(bundle_);
        (, , uint64 expiry, , ) = bond.bundles(bundle_.commitment);
        _accept(proof, bond.rootAt(1), block.timestamp);

        vm.warp(uint256(expiry) + CHALLENGE_PERIOD);
        vm.prank(REPORTER);
        vm.expectRevert(PrivateCreditBond.NotChallengePeriod.selector);
        bond.slashBundle(bundle_.commitment, bundle_.nullifier, 11, _share(bundle_, 11), proof, 29, _share(bundle_, 29), proof);
    }

    function test_slashRejectsASecondSpendOfTheSameNullifier() external {
        uint256 blinding = 0xB11D;
        Bundle memory first = _bundle(987_654, blinding);
        Bundle memory second = _bundle(424_242, blinding);
        assertEq(first.nullifier, second.nullifier);

        _fund(first);
        _slash(first, 11, 29, "proof-nullifier-replay");

        bytes memory proof = abi.encodePacked("proof-nullifier-replay-second");
        _fund(second);
        _accept(proof, bond.rootAt(2), block.timestamp);
        vm.prank(REPORTER);
        vm.expectRevert(PrivateCreditBond.NullifierAlreadySpent.selector);
        bond.slashBundle(
            second.commitment,
            second.nullifier,
            11,
            _share(second, 11),
            proof,
            29,
            _share(second, 29),
            proof
        );
    }

    function testFuzz_fundedBundleIsAlwaysSlashableUnderTheRestoredAlgebra(
        uint256 secret,
        uint256 blinding,
        uint256 signal1,
        uint256 signal2
    ) external {
        secret = bound(secret, 1, FIELD - 1);
        blinding = bound(blinding, 1, FIELD - 1);
        signal1 = bound(signal1, 1, FIELD - 1);
        signal2 = bound(signal2, 1, FIELD - 1);
        vm.assume(signal1 != signal2);

        Bundle memory bundle_ = _bundle(secret, blinding);
        vm.assume(bundle_.commitment != bytes32(0));

        bytes memory proof = abi.encodePacked("proof-fuzz", secret, blinding, signal1, signal2);
        _fund(bundle_);
        _accept(proof, bond.currentRoot(), block.timestamp);

        uint256 reporterBefore = usdc.balanceOf(REPORTER);
        vm.prank(REPORTER);
        bond.slashBundle(
            bundle_.commitment,
            bundle_.nullifier,
            signal1,
            _share(bundle_, signal1),
            proof,
            signal2,
            _share(bundle_, signal2),
            proof
        );

        assertEq(usdc.balanceOf(REPORTER), reporterBefore + FUNDED_BOND / 2);
        assertTrue(bond.spentNullifiers(bundle_.nullifier));
    }

    function testFuzz_fundBundleAcceptsAnyFieldBoundedCommitment(uint256 commitment) external {
        commitment = bound(commitment, 1, FIELD - 1);
        bytes32 value = bytes32(commitment);

        vm.prank(SPONSOR);
        bond.fundBundle(value, FUNDED_TIER);

        (, , , , uint256 amount) = bond.bundles(value);
        assertEq(amount, FUNDED_BOND);
        assertEq(usdc.balanceOf(address(bond)), FUNDED_BOND);
    }
}

/// @dev Randomly funds, slashes, and releases so the accounting invariant is
///      checked across many interleavings rather than one path.
contract BondHandler is Test {
    PrivateCreditBond internal immutable bond;
    MockUSDC internal immutable usdc;
    MockSpendVerifier internal immutable verifier;
    bytes32 internal immutable domain;
    address internal immutable sponsor;
    address internal immutable reporter;

    uint256 internal constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 internal constant CHALLENGE_PERIOD = 7 days;

    mapping(bytes32 => uint256) internal secretOf;
    mapping(bytes32 => uint256) internal blindingOf;
    bytes32[] public commitments;

    constructor(
        PrivateCreditBond bond_,
        MockUSDC usdc_,
        MockSpendVerifier verifier_,
        bytes32 domain_,
        address sponsor_,
        address reporter_
    ) {
        bond = bond_;
        usdc = usdc_;
        verifier = verifier_;
        domain = domain_;
        sponsor = sponsor_;
        reporter = reporter_;
    }

    function commitmentCount() external view returns (uint256) {
        return commitments.length;
    }

    function fund(uint256 seed) external {
        uint256 secret = uint256(keccak256(abi.encode("secret", seed))) % (FIELD - 1) + 1;
        uint256 blinding = uint256(keccak256(abi.encode("blinding", seed))) % (FIELD - 1) + 1;
        bytes32 commitment = bytes32(_hash1(secret));
        if (_state(commitment) != PrivateCreditBond.BundleState.None) return;

        vm.prank(sponsor);
        bond.fundBundle(commitment, 0);

        secretOf[commitment] = secret;
        blindingOf[commitment] = blinding;
        commitments.push(commitment);
    }

    function slash(uint256 index) external {
        if (commitments.length == 0) return;
        bytes32 commitment = commitments[index % commitments.length];
        if (_state(commitment) != PrivateCreditBond.BundleState.Active) return;
        (, , uint64 expiry, , ) = bond.bundles(commitment);
        if (block.timestamp >= uint256(expiry) + CHALLENGE_PERIOD) return;

        bytes memory proof1 = abi.encodePacked("handler-proof-one", index);
        bytes memory proof2 = abi.encodePacked("handler-proof-two", index);
        verifier.setResult(proof1, MockSpendVerifier.Result(true, bond.rootAt(1), block.timestamp, domain));
        verifier.setResult(proof2, MockSpendVerifier.Result(true, bond.rootAt(1), block.timestamp, domain));

        vm.prank(reporter);
        try bond.slashBundle(
            commitment,
            _nullifierOf(commitment),
            11,
            _shareOf(commitment, 11),
            proof1,
            29,
            _shareOf(commitment, 29),
            proof2
        ) {} catch {}
    }

    function release(uint256 index) external {
        if (commitments.length == 0) return;
        bytes32 commitment = commitments[index % commitments.length];
        if (_state(commitment) != PrivateCreditBond.BundleState.Active) return;
        (, , uint64 expiry, , ) = bond.bundles(commitment);

        vm.warp(uint256(expiry) + CHALLENGE_PERIOD);
        try bond.releaseBond(commitment) {} catch {}
    }

    function bondAmountOf(bytes32 commitment) external view returns (uint256 amount) {
        (, , , , amount) = bond.bundles(commitment);
    }

    function _state(bytes32 commitment) internal view returns (PrivateCreditBond.BundleState state) {
        (state, , , , ) = bond.bundles(commitment);
    }

    function _nullifierOf(bytes32 commitment) internal view returns (uint256) {
        return _hash1(blindingOf[commitment]);
    }

    function _shareOf(bytes32 commitment, uint256 signal) internal view returns (uint256) {
        return addmod(secretOf[commitment], mulmod(blindingOf[commitment], signal, FIELD), FIELD);
    }

    function _hash1(uint256 value) internal view returns (uint256) {
        uint256[1] memory input = [value];
        return IPoseidonT2(bond.poseidonT2()).hash(input);
    }

    function outstandingBonds() external view returns (uint256 total) {
        for (uint256 i = 0; i < commitments.length; ++i) {
            if (_state(commitments[i]) == PrivateCreditBond.BundleState.Active) {
                total += this.bondAmountOf(commitments[i]);
            }
        }
    }
}

contract PrivateCreditBondInvariantTest is BondFixture {
    BondHandler internal handler;

    function setUp() public {
        _deploy();
        handler = new BondHandler(bond, usdc, verifier, DOMAIN, SPONSOR, REPORTER);
        targetContract(address(handler));
    }

    /// @dev The escrow balance always equals the bonds it still owes: it never
    ///      pays out more than it took in and never strands a refundable bond.
    function invariant_escrowBalanceEqualsOutstandingBonds() external view {
        assertEq(usdc.balanceOf(address(bond)), handler.outstandingBonds());
    }

    /// @dev Every funded bundle carries the single funded tier's bond, so a tier
    ///      table change can never silently alter escrow accounting.
    function invariant_everyBundleCarriesTheFundedTierBond() external view {
        uint256 count = handler.commitmentCount();
        for (uint256 i = 0; i < count; ++i) {
            assertEq(handler.bondAmountOf(handler.commitments(i)), FUNDED_BOND);
        }
    }
}
