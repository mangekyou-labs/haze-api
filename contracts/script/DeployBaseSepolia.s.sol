// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {PrivateCreditBond} from "../src/PrivateCreditBond.sol";

/// @notice Deploys the immutable escrow registry after the Poseidon libraries,
/// generated spend verifier, and Base Sepolia USDC have been independently
/// deployed and reviewed.
contract DeployBaseSepolia is Script {
    function run() external returns (PrivateCreditBond bond) {
        address usdc = vm.envAddress("BASE_USDC");
        address sponsor = vm.envAddress("BASE_SPONSOR");
        address refundVault = vm.envAddress("BASE_REFUND_VAULT");
        address treasury = vm.envAddress("BASE_TREASURY");
        address poseidonT2 = vm.envAddress("POSEIDON_T2");
        address poseidonT3 = vm.envAddress("POSEIDON_T3");
        address poseidonT4 = vm.envAddress("POSEIDON_T4");
        address spendVerifier = vm.envAddress("SPEND_VERIFIER");
        bytes32 domain = vm.envBytes32("BASE_DEPLOYMENT_DOMAIN");

        require(domain != bytes32(0), "deployment domain is required");

        vm.startBroadcast();
        bond = new PrivateCreditBond(
            usdc,
            sponsor,
            refundVault,
            treasury,
            poseidonT2,
            poseidonT3,
            poseidonT4,
            spendVerifier,
            domain
        );
        vm.stopBroadcast();
    }
}
