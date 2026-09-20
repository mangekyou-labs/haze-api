// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.20;

import {RealProofFixture} from "./RealProofFixture.sol";
import {PrivateCreditSpendFixture as F} from "../fixtures/PrivateCreditSpendFixture.sol";

/// @dev The adapter seam: `verifySpend` consumes the six canonical public
///      signals as-is, binds the caller's signal/nullifier/share to their
///      canonical positions, and returns the metadata the bond checks against
///      its immutable domain and retained roots.
contract SpendVerifierTest is RealProofFixture {
    function setUp() public {
        _deployRealStack();
    }

    function _wordAt(bytes memory payload, uint256 index) private pure returns (uint256 word) {
        assembly {
            word := mload(add(add(payload, 32), mul(index, 32)))
        }
    }

    /// @dev Returns a copy of the payload with one 32-byte word replaced.
    function _withWord(bytes memory payload, uint256 index, uint256 value) private pure returns (bytes memory copy) {
        copy = bytes.concat(payload);
        assembly {
            mstore(add(add(copy, 32), mul(index, 32)), value)
        }
    }

    /// @dev Returns a truncated copy of the payload.
    function _resize(bytes memory payload, uint256 length) private pure returns (bytes memory copy) {
        copy = new bytes(length);
        for (uint256 i = 0; i < length; i++) {
            copy[i] = payload[i];
        }
    }

    function test_verifiesAGeneratedProofAndReturnsTheCanonicalMetadata() external view {
        (bool valid, bytes32 root, uint256 timestamp, bytes32 domain) =
            adapter.verifySpend(bytes32(F.COMMITMENT), F.SIGNAL_1, F.NULLIFIER, F.SHARE_1, F.PROOF_1);

        assertTrue(valid);
        assertEq(root, bytes32(F.ROOT));
        assertEq(timestamp, F.TIMESTAMP);
        assertEq(domain, DOMAIN);
    }

    function test_verifiesBothTranscriptsOfOneNullifier() external view {
        (bool first, bytes32 firstRoot, , ) =
            adapter.verifySpend(bytes32(F.COMMITMENT), F.SIGNAL_1, F.NULLIFIER, F.SHARE_1, F.PROOF_1);
        (bool second, bytes32 secondRoot, , ) =
            adapter.verifySpend(bytes32(F.COMMITMENT), F.SIGNAL_2, F.NULLIFIER, F.SHARE_2, F.PROOF_2);

        assertTrue(first);
        assertTrue(second);
        assertEq(firstRoot, secondRoot);
    }

    function test_rejectsAReorderedStatement() external view {
        bytes memory reordered =
            _withWord(_withWord(F.PROOF_1, 11, _wordAt(F.PROOF_1, 12)), 12, _wordAt(F.PROOF_1, 11));

        (bool valid, , , ) =
            adapter.verifySpend(bytes32(F.COMMITMENT), F.SIGNAL_1, F.NULLIFIER, F.SHARE_1, reordered);

        assertFalse(valid);
    }

    function test_rejectsASwappedRootAndTimestamp() external view {
        bytes memory swapped =
            _withWord(_withWord(F.PROOF_1, 8, _wordAt(F.PROOF_1, 9)), 9, _wordAt(F.PROOF_1, 8));

        (bool valid, , , ) =
            adapter.verifySpend(bytes32(F.COMMITMENT), F.SIGNAL_1, F.NULLIFIER, F.SHARE_1, swapped);

        assertFalse(valid);
    }

    function test_rejectsAnAlteredPublicSignal() external view {
        (bool alteredRoot, , , ) = adapter.verifySpend(
            bytes32(F.COMMITMENT), F.SIGNAL_1, F.NULLIFIER, F.SHARE_1, _withWord(F.PROOF_1, 8, F.ROOT + 1)
        );
        (bool alteredTimestamp, , , ) = adapter.verifySpend(
            bytes32(F.COMMITMENT), F.SIGNAL_1, F.NULLIFIER, F.SHARE_1, _withWord(F.PROOF_1, 9, F.TIMESTAMP + 1)
        );
        (bool alteredDomain, , , ) = adapter.verifySpend(
            bytes32(F.COMMITMENT), F.SIGNAL_1, F.NULLIFIER, F.SHARE_1, _withWord(F.PROOF_1, 10, F.DOMAIN + 1)
        );

        assertFalse(alteredRoot);
        assertFalse(alteredTimestamp);
        assertFalse(alteredDomain);
    }

    function test_rejectsACallerValueThatDisagreesWithThePayload() external view {
        (bool alteredSignal, , , ) =
            adapter.verifySpend(bytes32(F.COMMITMENT), F.SIGNAL_1 + 1, F.NULLIFIER, F.SHARE_1, F.PROOF_1);
        (bool alteredNullifier, , , ) =
            adapter.verifySpend(bytes32(F.COMMITMENT), F.SIGNAL_1, F.NULLIFIER + 1, F.SHARE_1, F.PROOF_1);
        (bool alteredShare, , , ) =
            adapter.verifySpend(bytes32(F.COMMITMENT), F.SIGNAL_1, F.NULLIFIER, F.SHARE_1 + 1, F.PROOF_1);

        assertFalse(alteredSignal);
        assertFalse(alteredNullifier);
        assertFalse(alteredShare);
    }

    function test_rejectsMalformedProofEncodings() external view {
        (bool empty, , , ) = adapter.verifySpend(bytes32(F.COMMITMENT), F.SIGNAL_1, F.NULLIFIER, F.SHARE_1, "");
        (bool short_, , , ) = adapter.verifySpend(
            bytes32(F.COMMITMENT), F.SIGNAL_1, F.NULLIFIER, F.SHARE_1, _resize(F.PROOF_1, 13 * 32)
        );
        (bool clipped, , , ) = adapter.verifySpend(
            bytes32(F.COMMITMENT), F.SIGNAL_1, F.NULLIFIER, F.SHARE_1, _resize(F.PROOF_1, 14 * 32 - 1)
        );
        (bool long_, , , ) = adapter.verifySpend(
            bytes32(F.COMMITMENT), F.SIGNAL_1, F.NULLIFIER, F.SHARE_1, bytes.concat(F.PROOF_1, bytes32(0))
        );

        assertFalse(empty);
        assertFalse(short_);
        assertFalse(clipped);
        assertFalse(long_);
    }

    function test_rejectsPublicSignalsOutsideTheScalarField() external view {
        // The caller agrees with the payload so the binding check passes and the
        // generated verifier's own scalar-field check is what rejects it.
        (bool outOfField, , , ) = adapter.verifySpend(
            bytes32(F.COMMITMENT), F.SIGNAL_1, F.NULLIFIER, FIELD, _withWord(F.PROOF_1, 13, FIELD)
        );

        assertFalse(outOfField);
    }
}
