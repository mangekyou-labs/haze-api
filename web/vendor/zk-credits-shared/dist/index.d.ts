/**
 * Public, chain-agnostic Base credential helpers.
 *
 * The former Stellar crypto/proof API is preserved under archive/stellar and
 * is intentionally not part of the active package export surface.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
export { BASE_MEMBERSHIP_TREE_CAPACITY, BASE_MEMBERSHIP_TREE_DEPTH, BN254_FIELD_ORDER, CREDENTIAL_EXPORT_FORMAT, CREDENTIAL_VERSION, FUNDED_SLOT_ALLOWANCE, FUNDED_TIER_ID, RECOVERY_CAPSULE_VERSION, REQUEST_SIGNAL_DOMAIN_TAG, canonicalizeBaseJson, canonicalizeRfc8785, computeCommitment, computeCreditLeaf, computeNullifier, computeShare, computeSlotBlinding, createCredential, createRecoveryCapsule, createRecoveryCapsuleFile, decryptAnyCredentialExport, decryptCredentialExport, deriveSparseCreditWitness, deriveRequestSignal, encryptCredentialExport, generateSecret, openRecoveryCapsule, poseidonHash, recoverSecret, recoverSlotBlinding, secretFromBase64Url, secretToBase64Url, secretToField, verifyActivatedCredential, verifyRecoveryCapsule, wrapActivatedCredential, } from './base.js';
export type { ActivatedCredentialFile, ActivatedCredentialMetadata, CredentialExportFile, CreditCredential, EncryptedCredentialExport, MerkleWitness, RecoveryCapsule, RecoveryCapsuleFile, RecoveryCapsulePayload, RequestSignal, RequestSignalInput, } from './base.js';
