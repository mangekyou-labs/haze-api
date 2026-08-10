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
  return { proof, publicSignals };
}

export async function computeDepositCommitment(secretK, resources) {
  const result = await proveGroth16(
    {
      secret_k: skToField(secretK),
      merkle_path_elements: ['0', '0', '0'],
      merkle_path_indices: ['0', '0', '0'],
    },
    resources.depositWasm,
    resources.depositZkey,
  );
  return result.publicSignals[1];
}

export async function generateDepositProof(input, resources) {
  return proveGroth16(input, resources.depositWasm, resources.depositZkey);
}

export async function verifyGroth16Proof(verificationKey, publicSignals, proof) {
  return groth16.verify(verificationKey, publicSignals, proof);
}

export async function generateRlnProofSelfVerified(input, resources) {
  const result = await proveGroth16(input, resources.rlnWasm, resources.rlnZkey);
  let valid;
  try {
    valid = await verifyGroth16Proof(resources.rlnVk, result.publicSignals, result.proof);
  } catch (err) {
    throw new ProofSelfVerificationError(
      `Local Groth16 verification failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!valid) throw new ProofSelfVerificationError('Local Groth16 verification failed; proof not returned');
  return { ...result, nullifier: result.publicSignals[1] };
}
