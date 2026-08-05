// Groth16 proof helpers — shared by the browser (web) and Node (gateway/CLI).
// Circuit resources (wasm + zkey + VK) are injected (DI) so the browser can
// pass `/circuits/*` URLs and Node can pass filesystem paths. This module keeps
// snarkjs usage in one place and never touches `globalThis`/`window`.

import { groth16 } from 'snarkjs';
import { skToField } from './crypto.js';

export interface ProofResult {
  proof: object;
  publicSignals: string[];
}

export interface DepositCircuitResources {
  depositWasm: string | Uint8Array;
  depositZkey: string | Uint8Array;
}

export interface DepositProofInput {
  secret_k: string;
  merkle_path_elements: string[];
  merkle_path_indices: string[];
}

export interface RlnCircuitResources {
  rlnWasm: string | Uint8Array;
  rlnZkey: string | Uint8Array;
  rlnVk: unknown;
}

export interface RlnProofInput {
  secret_k: string;
  signal_value: string;
  epoch: string;
  merkle_path_elements: string[];
  merkle_path_indices: string[];
}

export interface RlnProofResult extends ProofResult {
  // RLN public signals: [root, nullifier, share_x, share_y, epoch]; the
  // nullifier is the gateway's replay-protection key (signal index 1).
  nullifier: string;
}

export class ProofSelfVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProofSelfVerificationError';
  }
}

export async function proveGroth16(
  input: unknown,
  wasm: string | Uint8Array,
  zkey: string | Uint8Array,
): Promise<ProofResult> {
  const { proof, publicSignals } = await groth16.fullProve(input, wasm, zkey);
  return { proof: proof as object, publicSignals: publicSignals as string[] };
}

// deposit_membership public outputs: [root, commitment]. Returns the commitment.
export async function computeDepositCommitment(
  secretK: Uint8Array,
  resources: DepositCircuitResources,
): Promise<string> {
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

export async function generateDepositProof(
  input: DepositProofInput,
  resources: DepositCircuitResources,
): Promise<ProofResult> {
  return proveGroth16(input, resources.depositWasm, resources.depositZkey);
}

export async function verifyGroth16Proof(
  verificationKey: unknown,
  publicSignals: string[],
  proof: object,
): Promise<boolean> {
  return groth16.verify(verificationKey, publicSignals, proof);
}

// Client-side proof self-verification (M1.3): prove an RLN statement and
// verify the proof locally against the injected verification key before
// returning it. A proof that fails local verification throws
// ProofSelfVerificationError and is never returned — so it can never be
// attached to an X-ZK-Proof header. The gateway re-verifies as defense in
// depth and additionally checks nullifier replay + epoch quota.
export async function generateRlnProofSelfVerified(
  input: RlnProofInput,
  resources: RlnCircuitResources,
): Promise<RlnProofResult> {
  const result = await proveGroth16(input, resources.rlnWasm, resources.rlnZkey);
  let valid: boolean;
  try {
    valid = await verifyGroth16Proof(resources.rlnVk, result.publicSignals, result.proof);
  } catch (err) {
    // A mismatched VK / malformed input can make snarkjs throw rather than
    // return false. Both must be treated as a failed self-verification so the
    // proof is never returned to the caller.
    throw new ProofSelfVerificationError(
      `Local Groth16 verification failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!valid) {
    throw new ProofSelfVerificationError(
      'Local Groth16 verification failed; proof not returned',
    );
  }
  return { ...result, nullifier: result.publicSignals[1] };
}