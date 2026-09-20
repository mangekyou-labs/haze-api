// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.20;

import {PrivateCreditBond} from "../../src/PrivateCreditBond.sol";
import {RealProofFixture} from "./RealProofFixture.sol";
import {PrivateCreditSpendFixture as F} from "../fixtures/PrivateCreditSpendFixture.sol";

/// @dev Two-transcript recovery against the real generated verifier and the real
///      Poseidon deployment: one transcript is harmless, two transcripts with one
///      nullifier and different signals recover slot blinding then the secret,
///      and both Poseidon bindings hold.
contract SpendRecoveryTest is RealProofFixture {
    uint256 internal constant JS_SECRET_FIELD = 455867356320691211509944977504407603390036387149619137164185182714736811808;
    uint256 internal constant JS_SHARE_42 = 15087272125883058474721785515802992066115338196419013289149161861593245981369;
    uint256 internal constant JS_SHARE_99 = 14619381646438372768423335197183601254733337994326873461980440609679400536986;

    function setUp() public {
        _deployRealStack();
        _fundFixtureCredential();
    }

    function test_theFixtureTranscriptsSatisfyTheRestoredStatement() external view {
        assertEq(F.SECRET_FIELD, JS_SECRET_FIELD);
        assertEq(F.SHARE_1, JS_SHARE_42);
        assertEq(F.SHARE_2, JS_SHARE_99);
        assertEq(F.SHARE_1, addmod(F.SECRET_FIELD, mulmod(F.SLOT_BLINDING, F.SIGNAL_1, FIELD), FIELD));
        assertEq(F.SHARE_2, addmod(F.SECRET_FIELD, mulmod(F.SLOT_BLINDING, F.SIGNAL_2, FIELD), FIELD));
        assertEq(poseidonT2.hash([F.SLOT_BLINDING]), F.NULLIFIER);
        assertEq(poseidonT2.hash([F.SECRET_FIELD]), F.COMMITMENT);
    }

    function test_twoTranscriptsSlashThroughTheRealVerifierAndRecoverTheCredential() external {
        uint256 reporterBefore = usdc.balanceOf(REPORTER);
        uint256 treasuryBefore = usdc.balanceOf(TREASURY);

        vm.prank(REPORTER);
        bond.slashBundle(
            bytes32(F.COMMITMENT),
            F.NULLIFIER,
            F.SIGNAL_1,
            F.SHARE_1,
            F.PROOF_1,
            F.SIGNAL_2,
            F.SHARE_2,
            F.PROOF_2
        );

        (PrivateCreditBond.BundleState state, , , , uint256 bondAmount) = bond.bundles(bytes32(F.COMMITMENT));
        assertEq(uint8(state), uint8(PrivateCreditBond.BundleState.Slashed));
        assertTrue(bond.spentNullifiers(F.NULLIFIER));
        assertEq(usdc.balanceOf(REPORTER) - reporterBefore, bondAmount / 2);
        assertEq(usdc.balanceOf(TREASURY) - treasuryBefore, bondAmount - bondAmount / 2);

        vm.prank(REPORTER);
        vm.expectRevert(PrivateCreditBond.TerminalState.selector);
        bond.slashBundle(
            bytes32(F.COMMITMENT),
            F.NULLIFIER,
            F.SIGNAL_1,
            F.SHARE_1,
            F.PROOF_1,
            F.SIGNAL_2,
            F.SHARE_2,
            F.PROOF_2
        );
    }

    function test_aSingleTranscriptCannotSlashAndRevealsNeitherSecretNorBlinding() external {
        assertTrue(F.SHARE_1 != JS_SECRET_FIELD);
        assertTrue(F.SHARE_1 != F.SLOT_BLINDING);

        vm.prank(REPORTER);
        vm.expectRevert(PrivateCreditBond.InvalidProof.selector);
        bond.slashBundle(
            bytes32(F.COMMITMENT),
            F.NULLIFIER,
            F.SIGNAL_1,
            F.SHARE_1,
            F.PROOF_1,
            F.SIGNAL_1,
            F.SHARE_1,
            F.PROOF_1
        );

        (PrivateCreditBond.BundleState state, , , , ) = bond.bundles(bytes32(F.COMMITMENT));
        assertEq(uint8(state), uint8(PrivateCreditBond.BundleState.Active));
    }
}
