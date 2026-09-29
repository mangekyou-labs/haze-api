// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {PrivateCreditBond} from "../src/PrivateCreditBond.sol";
import {SpendVerifier} from "../src/SpendVerifier.sol";
import {Groth16Verifier as Groth16VerifierV2} from "../src/PrivateCreditSpendVerifierV2.sol";

/// @notice Deploys the v2 verifier, adapter, Poseidon libraries, and bond as one
///         six-CREATE Base Sepolia sequence for the guarded launcher to reconcile.
contract DeployBaseSepoliaV2 is Script {
    struct Config {
        address usdc;
        address sponsor;
        address refundVault;
        address treasury;
        bytes32 domain;
    }

    struct Deployment {
        Groth16VerifierV2 verifier;
        SpendVerifier spendVerifier;
        address poseidonT2;
        address poseidonT3;
        address poseidonT4;
        PrivateCreditBond bond;
    }

    function run() external {
        Config memory config = Config({
            usdc: vm.envAddress("BASE_USDC_ADDRESS"),
            sponsor: vm.envAddress("BASE_SPONSOR_ADDRESS"),
            refundVault: vm.envAddress("BASE_REFUND_VAULT"),
            treasury: vm.envAddress("BASE_TREASURY_ADDRESS"),
            domain: bytes32(vm.envUint("BASE_DEPLOYMENT_DOMAIN"))
        });
        require(uint256(config.domain) == 84532, "deployment domain must be Base Sepolia");
        require(block.chainid == uint256(config.domain), "wrong deployment chain");

        Deployment memory deployed = _deploy(config);
        require(deployed.spendVerifier.verifier() == address(deployed.verifier), "v2 adapter verifier linkage failed");
        _log(deployed);
    }

    function _deploy(Config memory config) private returns (Deployment memory deployed) {
        vm.startBroadcast();
        deployed.verifier = new Groth16VerifierV2();
        deployed.spendVerifier = new SpendVerifier(address(deployed.verifier));
        deployed.poseidonT2 = deployCode("out/PoseidonT2.sol/PoseidonT2.json");
        deployed.poseidonT3 = deployCode("out/PoseidonT3.sol/PoseidonT3.json");
        deployed.poseidonT4 = deployCode("out/PoseidonT4.sol/PoseidonT4.json");
        deployed.bond = _deployBond(config, deployed);
        vm.stopBroadcast();
    }

    function _deployBond(Config memory config, Deployment memory deployed) private returns (PrivateCreditBond) {
        return new PrivateCreditBond(
            config.usdc,
            config.sponsor,
            config.refundVault,
            config.treasury,
            deployed.poseidonT2,
            deployed.poseidonT3,
            deployed.poseidonT4,
            address(deployed.spendVerifier),
            config.domain
        );
    }

    function _log(Deployment memory deployed) private view {
        console2.log("Groth16Verifier", address(deployed.verifier));
        console2.log("SpendVerifier", address(deployed.spendVerifier));
        console2.log("PoseidonT2", deployed.poseidonT2);
        console2.log("PoseidonT3", deployed.poseidonT3);
        console2.log("PoseidonT4", deployed.poseidonT4);
        console2.log("PrivateCreditBond", address(deployed.bond));
    }
}
