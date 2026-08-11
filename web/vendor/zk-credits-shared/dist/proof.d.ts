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
export interface MembershipRemovalCircuitResources {
    membershipRemovalWasm: string | Uint8Array;
    membershipRemovalZkey: string | Uint8Array;
    membershipRemovalVk: unknown;
}
export interface MembershipRemovalProofInput {
    secret_k: string;
    merkle_path_elements: string[];
    merkle_path_indices: string[];
}
export interface RlnProofInput {
    secret_k: string;
    ticket_index: string;
    request_digest: string;
    merkle_path_elements: string[];
    merkle_path_indices: string[];
}
export interface RlnProofResult extends ProofResult {
    nullifier: string;
}
export interface MembershipRemovalProofResult extends ProofResult {
    commitment: string;
    currentRoot: string;
    nextRoot: string;
}
export declare class ProofSelfVerificationError extends Error {
    constructor(message: string);
}
export declare function proveGroth16(input: unknown, wasm: string | Uint8Array, zkey: string | Uint8Array): Promise<ProofResult>;
export declare function computeDepositCommitment(secretK: Uint8Array, resources: DepositCircuitResources): Promise<string>;
export declare function generateDepositProof(input: DepositProofInput, resources: DepositCircuitResources): Promise<ProofResult>;
export declare function verifyGroth16Proof(verificationKey: unknown, publicSignals: string[], proof: object): Promise<boolean>;
export declare function generateRlnProofSelfVerified(input: RlnProofInput, resources: RlnCircuitResources): Promise<RlnProofResult>;
export declare function generateMembershipRemovalProofSelfVerified(input: MembershipRemovalProofInput, resources: MembershipRemovalCircuitResources): Promise<MembershipRemovalProofResult>;
