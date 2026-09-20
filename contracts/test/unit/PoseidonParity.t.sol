// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.20;

import {RealProofFixture} from "./RealProofFixture.sol";
import {PrivateCreditSpendFixture as F} from "../fixtures/PrivateCreditSpendFixture.sol";

/// @dev Hash parity. Every literal below is pinned by
///      `packages/zk-credits-shared/src/base.test.ts` and by the circuit witness
///      suite, so circomlibjs, the compiled circuit, and the deployed Poseidon
///      T2/T3/T4 describe the same credential.
contract PoseidonParityTest is RealProofFixture {
    uint256 internal constant JS_COMMITMENT = 8687213900595150509063186631634067671233157784124627437219499552928422827997;
    uint256 internal constant JS_SLOT_BLINDING = 1911812699644766498332168042239771660199295119298035647216180696157284158486;
    uint256 internal constant JS_NULLIFIER = 3018868336897366874189054800414760262860200660079775010062207867762743153602;
    uint256 internal constant JS_LEAF = 12992319314469106065811618978512789981623859879058485908347559722389823331150;

    function setUp() public {
        _deployRealStack();
    }

    function test_theFixtureCarriesThePinnedCircuitAndJsLiterals() external view {
        assertEq(F.COMMITMENT, JS_COMMITMENT);
        assertEq(F.SLOT_BLINDING, JS_SLOT_BLINDING);
        assertEq(F.NULLIFIER, JS_NULLIFIER);
        assertEq(F.LEAF, JS_LEAF);
    }

    function test_realPoseidonReproducesTheCircuitAndJsLiterals() external view {
        assertEq(poseidonT2.hash([F.SECRET_FIELD]), JS_COMMITMENT);
        assertEq(poseidonT4.hash([F.COMMITMENT, uint256(F.TIER_ID), uint256(F.EXPIRY)]), JS_LEAF);
        assertEq(poseidonT4.hash([F.SECRET_FIELD, F.SLOT, F.DOMAIN]), JS_SLOT_BLINDING);
        assertEq(poseidonT2.hash([JS_SLOT_BLINDING]), JS_NULLIFIER);
        assertEq(poseidonT3.hash([uint256(0), uint256(0)]), bond.zeroHashes(1));
    }

    function test_fundingThroughRealPoseidonRepublishesTheCircuitRoot() external {
        _fundFixtureCredential();

        (, , uint64 expiry, , ) = bond.bundles(bytes32(F.COMMITMENT));
        assertEq(expiry, F.EXPIRY);
        assertEq(bond.computeLeaf(bytes32(F.COMMITMENT), F.TIER_ID, F.EXPIRY), bytes32(F.LEAF));
        assertEq(bond.currentRoot(), bytes32(F.ROOT));
    }
}
