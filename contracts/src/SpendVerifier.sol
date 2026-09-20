// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.20;

import {ISpendVerifier} from "./PrivateCreditBond.sol";
import {Groth16Verifier} from "./PrivateCreditSpendVerifier.sol";

/// @title SpendVerifier
/// @notice `ISpendVerifier` adapter for the frozen `private-credit-spend-bn254-dev`
///         circuit.
/// @dev `PrivateCreditSpendVerifier.sol` is the unmodified snarkjs output for the
///      development zkey pinned by `packages/zk-credits-sidecar/circuits/manifest.json`
///      (zkey sha256 `3afb378d832d646a7d207b7eecbbd33cf3b041b99274cb074bbe314ac0b79291`).
///      Regenerate it with
///      `snarkjs zkey export solidityverifier <zkey> PrivateCreditSpendVerifier.sol`
///      and never hand-edit it.
///
///      Payload layout: the snarkjs `soliditycalldata` word list — the eight
///      Groth16 point words followed by the six public signals in canonical
///      order `[root, timestamp, domain, requestSignal, nullifier, share]`. The
///      adapter passes those six words to the generated verifier unchanged, so a
///      reordered, altered, or truncated payload can only fail.
///
///      The commitment is not a public input of the circuit. The bond binds it
///      instead by recovering `slotBlinding` and the secret from two transcripts
///      and requiring `Poseidon(slotBlinding) == nullifier` and
///      `Poseidon(secret) == commitment`, so this adapter never sees it.
contract SpendVerifier is ISpendVerifier {
    /// @dev Eight Groth16 point words followed by the six public signals.
    uint256 private constant PAYLOAD_WORDS = 14;
    uint256 private constant PAYLOAD_BYTES = PAYLOAD_WORDS * 32;
    uint256 private constant PUBLIC_SIGNAL_WORD = 8;
    uint256 private constant PUBLIC_SIGNAL_COUNT = 6;
    /// @dev Canonical positions of the statement values inside `publicSignals`.
    uint256 private constant REQUEST_SIGNAL_INDEX = 3;
    uint256 private constant NULLIFIER_INDEX = 4;
    uint256 private constant SHARE_INDEX = 5;

    /// @notice The generated Groth16 verifier this adapter wraps.
    address public immutable verifier;

    error InvalidVerifierAddress();

    constructor(address verifier_) {
        if (verifier_ == address(0)) revert InvalidVerifierAddress();
        verifier = verifier_;
    }

    /// @inheritdoc ISpendVerifier
    function verifySpend(
        bytes32,
        uint256 signal,
        uint256 nullifier,
        uint256 share,
        bytes calldata proof
    ) external view returns (bool valid, bytes32 root, uint256 timestamp, bytes32 domain) {
        if (proof.length != PAYLOAD_BYTES) return _reject();

        uint256[2] memory pA;
        uint256[2][2] memory pB;
        uint256[2] memory pC;
        uint256[6] memory publicSignals;
        for (uint256 i = 0; i < 2; i++) {
            pA[i] = _word(proof, i);
        }
        for (uint256 i = 0; i < 2; i++) {
            for (uint256 j = 0; j < 2; j++) {
                pB[i][j] = _word(proof, 2 + i * 2 + j);
            }
        }
        for (uint256 i = 0; i < 2; i++) {
            pC[i] = _word(proof, 6 + i);
        }
        for (uint256 i = 0; i < PUBLIC_SIGNAL_COUNT; i++) {
            publicSignals[i] = _word(proof, PUBLIC_SIGNAL_WORD + i);
        }

        // The caller's statement must be the payload's statement. An altered
        // value cannot both satisfy this and a proof produced for the original.
        if (publicSignals[REQUEST_SIGNAL_INDEX] != signal) return _reject();
        if (publicSignals[NULLIFIER_INDEX] != nullifier) return _reject();
        if (publicSignals[SHARE_INDEX] != share) return _reject();

        if (!Groth16Verifier(verifier).verifyProof(pA, pB, pC, publicSignals)) return _reject();
        return (true, bytes32(publicSignals[0]), publicSignals[1], bytes32(publicSignals[2]));
    }

    /// @dev Nothing is surfaced about a rejected payload beyond the invalid flag.
    function _reject() private pure returns (bool, bytes32, uint256, bytes32) {
        return (false, bytes32(0), 0, bytes32(0));
    }

    /// @dev Reads one 32-byte word of the calldata payload.
    function _word(bytes calldata payload, uint256 index) private pure returns (uint256 word) {
        assembly {
            word := calldataload(add(payload.offset, mul(index, 32)))
        }
    }
}
