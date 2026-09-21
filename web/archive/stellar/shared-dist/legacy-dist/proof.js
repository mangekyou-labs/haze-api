// Groth16 proof helpers — shared by the browser (web) and Node (gateway/CLI).
// Circuit resources (wasm + zkey + VK) are injected (DI) so the browser can
// pass `/circuits/*` URLs and Node can pass filesystem paths. This module keeps
// snarkjs usage in one place and never touches `globalThis`/`window`.
import { groth16 } from 'snarkjs';
import { skToField } from './crypto.js';
export class ProofSelfVerificationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ProofSelfVerificationError';
    }
}
export async function proveGroth16(input, wasm, zkey) {
    const { proof, publicSignals } = await groth16.fullProve(input, wasm, zkey);
    return { proof: proof, publicSignals: publicSignals };
}
// deposit_membership public outputs: [root, commitment]. Returns the commitment.
export async function computeDepositCommitment(secretK, resources) {
    const result = await proveGroth16({
        secret_k: skToField(secretK),
        merkle_path_elements: ['0', '0', '0'],
        merkle_path_indices: ['0', '0', '0'],
    }, resources.depositWasm, resources.depositZkey);
    return result.publicSignals[1];
}
export async function generateDepositProof(input, resources) {
    return proveGroth16(input, resources.depositWasm, resources.depositZkey);
}
export async function verifyGroth16Proof(verificationKey, publicSignals, proof) {
    return groth16.verify(verificationKey, publicSignals, proof);
}
// Client-side proof self-verification (M1.3): prove an RLN statement and
// verify the proof locally against the injected verification key before
// returning it. A proof that fails local verification throws
// ProofSelfVerificationError and is never returned — so it can never be
// attached to an X-ZK-Proof header. The gateway re-verifies as defense in
// depth and additionally checks request binding and ticket replay.
export async function generateRlnProofSelfVerified(input, resources) {
    const result = await proveGroth16(input, resources.rlnWasm, resources.rlnZkey);
    let valid;
    try {
        valid = await verifyGroth16Proof(resources.rlnVk, result.publicSignals, result.proof);
    }
    catch (err) {
        // A mismatched VK / malformed input can make snarkjs throw rather than
        // return false. Both must be treated as a failed self-verification so the
        // proof is never returned to the caller.
        throw new ProofSelfVerificationError(`Local Groth16 verification failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!valid) {
        throw new ProofSelfVerificationError('Local Groth16 verification failed; proof not returned');
    }
    return { ...result, nullifier: result.publicSignals[1] };
}
// Withdrawal proof generation mirrors the RLN self-verification rule: a
// browser never sends a membership-removal proof to the custodial signer until
// it verifies locally with the statement's own verification key.
export async function generateMembershipRemovalProofSelfVerified(input, resources) {
    const result = await proveGroth16(input, resources.membershipRemovalWasm, resources.membershipRemovalZkey);
    let valid;
    try {
        valid = await verifyGroth16Proof(resources.membershipRemovalVk, result.publicSignals, result.proof);
    }
    catch (err) {
        throw new ProofSelfVerificationError(`Local membership-removal verification failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!valid) {
        throw new ProofSelfVerificationError('Local membership-removal verification failed; proof not returned');
    }
    if (result.publicSignals.length !== 3) {
        throw new ProofSelfVerificationError(`Membership-removal statement has ${result.publicSignals.length} public signals; expected 3`);
    }
    return {
        ...result,
        commitment: result.publicSignals[0],
        currentRoot: result.publicSignals[1],
        nextRoot: result.publicSignals[2],
    };
}
