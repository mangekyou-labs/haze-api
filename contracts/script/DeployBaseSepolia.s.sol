// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {PrivateCreditBond} from "../src/PrivateCreditBond.sol";

interface IReviewedSpendVerifier {
    function verifier() external view returns (address);
}

/// @notice Deploys the exact four-contract pilot sequence from launch-native
/// environment variables. The reviewed SpendVerifier adapter is an existing
/// deployment; the launcher validates its underlying verifier before this
/// script is exposed to the operator.
contract DeployBaseSepolia is Script {
    address internal constant REVIEWED_VERIFIER = 0xC66CC4866f945Ce39c207729CF136fd03d58207E;
    address internal constant REVIEWED_SPEND_VERIFIER = 0xD3FED81c5Aa3D1c976448cAaDAa66832E7F5BCDD;

    function run()
        external
        returns (address poseidonT2, address poseidonT3, address poseidonT4, PrivateCreditBond bond)
    {
        address usdc = vm.envAddress("BASE_USDC_ADDRESS");
        address sponsor = vm.envAddress("BASE_SPONSOR_ADDRESS");
        address refundVault = vm.envAddress("BASE_REFUND_VAULT");
        address treasury = vm.envAddress("BASE_TREASURY_ADDRESS");
        address spendVerifier = vm.envAddress("BASE_SPEND_VERIFIER_ADDRESS");
        uint256 domainInput = vm.envUint("BASE_DEPLOYMENT_DOMAIN");
        bytes32 domain = bytes32(domainInput);

        require(domainInput == 84532, "deployment domain must be Base Sepolia");
        require(block.chainid == domainInput, "wrong deployment chain");
        require(spendVerifier == REVIEWED_SPEND_VERIFIER, "unexpected SpendVerifier adapter");
        require(
            IReviewedSpendVerifier(spendVerifier).verifier() == REVIEWED_VERIFIER,
            "SpendVerifier is not linked to the reviewed verifier"
        );

        vm.startBroadcast();
        poseidonT2 = deployCode("PoseidonT2.sol:PoseidonT2");
        poseidonT3 = deployCode("PoseidonT3.sol:PoseidonT3");
        poseidonT4 = deployCode("PoseidonT4.sol:PoseidonT4");
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

        console2.log("PoseidonT2", poseidonT2);
        console2.log("PoseidonT3", poseidonT3);
        console2.log("PoseidonT4", poseidonT4);
        console2.log("PrivateCreditBond", address(bond));
    }
}
