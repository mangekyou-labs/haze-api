// Browser-side crypto: re-exports the isomorphic core from @zk-credits/shared.
// DI: circuit resources are the browser-served static URLs (`/circuits/*`),
// matching how the shared package is consumed in Node (filesystem paths).

import {
  generateSecretK,
  recoverSecretK,
  deriveMnemonic,
  skToField,
  computeDepositCommitment,
  generateRlnProofSelfVerified,
  generateMembershipRemovalProofSelfVerified,
  requestDigestToField,
  type RlnProofResult,
  type MembershipRemovalProofResult,
  type DepositCircuitResources,
} from '@zk-credits/shared';

const browserDepositResources: DepositCircuitResources = {
  depositWasm: '/circuits/deposit_membership.wasm',
  depositZkey: '/circuits/deposit_membership_final.zkey',
};

const browserRlnResources = {
  rlnWasm: '/circuits/rln_nullifier.wasm',
  rlnZkey: '/circuits/rln_nullifier_final.zkey',
};

const browserMembershipRemovalResources = {
  membershipRemovalWasm: '/circuits/membership_removal.wasm',
  membershipRemovalZkey: '/circuits/membership_removal_final.zkey',
};

let verificationKeyPromise: Promise<unknown> | null = null;
let membershipRemovalVerificationKeyPromise: Promise<unknown> | null = null;

function loadRlnVerificationKey(): Promise<unknown> {
  verificationKeyPromise ??= fetch('/circuits/verification_key_rln.json').then(
    async (response) => {
      if (!response.ok) {
        throw new Error('The browser verification key could not be loaded');
      }
      return response.json() as Promise<unknown>;
    },
  );
  return verificationKeyPromise;
}

function loadMembershipRemovalVerificationKey(): Promise<unknown> {
  membershipRemovalVerificationKeyPromise ??= fetch('/circuits/verification_key_membership_removal.json').then(
    async (response) => {
      if (!response.ok) {
        throw new Error('The browser membership-removal verification key could not be loaded');
      }
      return response.json() as Promise<unknown>;
    },
  );
  return membershipRemovalVerificationKeyPromise;
}

export { generateSecretK, recoverSecretK, deriveMnemonic };

// Keep the v1 alias for compatibility.
export const secretKToField = skToField;

// deposit_membership outputs: [root, commitment] → returns the commitment.
export async function computeCommitment(secretK: Uint8Array): Promise<string> {
  return computeDepositCommitment(secretK, browserDepositResources);
}

export interface ChatProofResult extends RlnProofResult {
  ticketIndex: number;
  requestDigest: Awaited<ReturnType<typeof requestDigestToField>>;
}

export async function generateChatProof(
  secretK: Uint8Array,
  ticketIndex: number,
  requestBody: unknown,
): Promise<ChatProofResult> {
  const requestDigest = await requestDigestToField(requestBody);
  const result = await generateRlnProofSelfVerified(
    {
      secret_k: skToField(secretK),
      ticket_index: ticketIndex.toString(),
      request_digest: requestDigest.field,
      merkle_path_elements: ['0', '0', '0'],
      merkle_path_indices: ['0', '0', '0'],
    },
    {
      ...browserRlnResources,
      rlnVk: await loadRlnVerificationKey(),
    },
  );
  return { ...result, ticketIndex, requestDigest };
}

export async function generateWithdrawalProof(
  secretK: Uint8Array,
  merklePathElements: string[],
  merklePathIndices: string[],
): Promise<MembershipRemovalProofResult> {
  return generateMembershipRemovalProofSelfVerified(
    {
      secret_k: skToField(secretK),
      merkle_path_elements: merklePathElements,
      merkle_path_indices: merklePathIndices,
    },
    {
      ...browserMembershipRemovalResources,
      membershipRemovalVk: await loadMembershipRemovalVerificationKey(),
    },
  );
}
