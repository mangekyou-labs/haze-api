// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
// Imported for their artifacts: `deployCode` below needs the compiled bytecode,
// and the bond reaches the deployed libraries through `IPoseidonT*` addresses.
// The generated artifact paths are used below because the npm remapping's
// source aliases do not resolve through Foundry's deployCode lookup.
import {PoseidonT2} from "poseidon-solidity/PoseidonT2.sol";
import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";
import {PoseidonT4} from "poseidon-solidity/PoseidonT4.sol";
import {IPoseidonT2, IPoseidonT3, IPoseidonT4, PrivateCreditBond} from "../../src/PrivateCreditBond.sol";
import {Groth16Verifier} from "../../src/PrivateCreditSpendVerifier.sol";
import {SpendVerifier} from "../../src/SpendVerifier.sol";
import {MockUSDC} from "./PrivateCreditBond.t.sol";
import {PrivateCreditSpendFixture as F} from "../fixtures/PrivateCreditSpendFixture.sol";

/// @dev Wires the generated Groth16 verifier, the `ISpendVerifier` adapter, and
///      the real Poseidon T2/T3/T4 deployments to the fixture credential. The
///      clock is warped to `EXPIRY - VALIDITY_PERIOD` so `fundBundle` appends the
///      exact leaf and publishes the exact root the circuit proved membership in.
abstract contract RealProofFixture is Test {
    uint256 internal constant FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    address internal constant SPONSOR = address(0x100);
    address internal constant REFUND_VAULT = address(0x200);
    address internal constant TREASURY = address(0x300);
    address internal constant REPORTER = address(0x400);
    bytes32 internal constant DOMAIN = bytes32(F.DOMAIN);

    MockUSDC internal usdc;
    IPoseidonT2 internal poseidonT2;
    IPoseidonT3 internal poseidonT3;
    IPoseidonT4 internal poseidonT4;
    Groth16Verifier internal groth16;
    SpendVerifier internal adapter;
    PrivateCreditBond internal bond;

    function _deployRealStack() internal {
        vm.warp(F.EXPIRY - 30 days);
        poseidonT2 = IPoseidonT2(deployCode("out/PoseidonT2.sol/PoseidonT2.json"));
        poseidonT3 = IPoseidonT3(deployCode("out/PoseidonT3.sol/PoseidonT3.json"));
        poseidonT4 = IPoseidonT4(deployCode("out/PoseidonT4.sol/PoseidonT4.json"));
        groth16 = new Groth16Verifier();
        adapter = new SpendVerifier(address(groth16));
        usdc = new MockUSDC();
        bond = new PrivateCreditBond(
            address(usdc),
            SPONSOR,
            REFUND_VAULT,
            TREASURY,
            address(poseidonT2),
            address(poseidonT3),
            address(poseidonT4),
            address(adapter),
            DOMAIN
        );
        usdc.mint(SPONSOR, 1_000_000_000);
        vm.prank(SPONSOR);
        usdc.approve(address(bond), type(uint256).max);
    }

    /// @dev The sponsor funds the fixture credential, and the bond must publish
    ///      the circuit's root, which is the Poseidon parity check that matters.
    function _fundFixtureCredential() internal {
        vm.prank(SPONSOR);
        bond.fundBundle(bytes32(F.COMMITMENT), F.TIER_ID);
    }
}
