/**
 * Base private-credit primitives.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
export declare const BN254_FIELD_ORDER = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export declare const BASE_MEMBERSHIP_TREE_DEPTH = 20;
export declare const BASE_MEMBERSHIP_TREE_CAPACITY: number;
export declare const CREDENTIAL_VERSION = 1;
export declare const FUNDED_TIER_ID = 0;
export declare const FUNDED_SLOT_ALLOWANCE = 250;
export declare const REQUEST_SIGNAL_DOMAIN_TAG = "zk-prepaid-request-signal-v1";
/** Poseidon over the Circom BN254 field. Out-of-range inputs are rejected, not wrapped. */
export declare function poseidonHash(inputs: readonly (bigint | number | string)[]): Promise<string>;
export declare function generateSecret(): Uint8Array;
export declare function secretToField(secret: Uint8Array): string;
export declare function secretFromBase64Url(value: string): Uint8Array;
export declare function secretToBase64Url(secret: Uint8Array): string;
export declare function computeCommitment(secret: Uint8Array): Promise<string>;
export declare function computeCreditLeaf(commitment: string, tierId: number, expiry: number): Promise<string>;
export declare function computeSlotBlinding(secret: Uint8Array, slot: number, deploymentDomain: string): Promise<string>;
export declare function computeNullifier(slotBlinding: string): Promise<string>;
export declare function computeShare(secret: Uint8Array, signal: string, slotBlinding: string): Promise<string>;
export declare function recoverSlotBlinding(share1: string, share2: string, signal1: string, signal2: string): string;
export declare function recoverSecret(share: string, slotBlinding: string, signal: string): string;
export declare function canonicalizeBaseJson(value: unknown): string;
/** RFC 8785 JSON Canonicalization Scheme for JSON values. */
export declare function canonicalizeRfc8785(value: unknown, path?: string): string;
export interface RequestSignalInput {
    method: string;
    url: string;
    body: Uint8Array;
    requirements: unknown;
    nonce: string;
    responseKey: string;
}
export interface RequestSignal {
    canonical: string;
    digest: string;
    field: string;
}
/** Domain-separated SHA-256 hash-to-BN254 of length-prefixed request binding inputs. */
export declare function deriveRequestSignal(input: RequestSignalInput): Promise<RequestSignal>;
export interface CreditCredential {
    version: typeof CREDENTIAL_VERSION;
    secret: string;
    commitment: string;
    tierId: number;
    expiry: number;
    deploymentDomain: string;
}
export interface EncryptedCredentialExport {
    version: typeof CREDENTIAL_VERSION;
    algorithm: 'PBKDF2-AES-GCM';
    salt: string;
    iv: string;
    ciphertext: string;
}
export declare function createCredential(secret: Uint8Array, tierId: number, expiry: number, deploymentDomain: string): Promise<CreditCredential>;
/** Encrypts the credential locally; the returned value is safe to download, not to log. */
export declare function encryptCredentialExport(credential: CreditCredential, password: string): Promise<EncryptedCredentialExport>;
export declare function decryptCredentialExport(exported: EncryptedCredentialExport, password: string): Promise<CreditCredential>;
export interface MerkleWitness {
    root: string;
    leafIndex: number;
    pathElements: string[];
    pathIndices: number[];
}
/**
 * Creates a depth-20 witness from sparse append-only leaves. Missing nodes are
 * the contract's deterministic zero subtrees, so local event synchronization
 * does not need to allocate a million-element array for every request.
 */
export declare function deriveSparseCreditWitness(leaves: ReadonlyMap<number, string>, leafIndex: number): Promise<MerkleWitness>;
