// Browser-side crypto: re-exports the isomorphic core from @zk-credits/shared.
// DI: circuit resources are the browser-served static URLs (`/circuits/*`),
// matching how the shared package is consumed in Node (filesystem paths).

import {
  deriveMembershipWitness,
  generateSecretK,
  recoverSecretK,
  deriveMnemonic,
  skToField,
  generateRlnProofSelfVerified,
  generateMembershipRemovalProofSelfVerified,
  mimcHash,
  requestDigestToField,
  type MembershipWitness,
  type PublicMembershipSnapshot,
  type RlnProofResult,
  type MembershipRemovalProofResult,
} from '@zk-credits/shared';

const GATEWAY_BASE = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001';
const MEMBERSHIP_SNAPSHOT_MAX_AGE_MS = 60_000;

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

// The deposit circuit defines commitment = MiMCSponge(secret_k). Derive that
// public value directly; generating a Groth16 proof here is unnecessary and
// can strand a browser worker during onboarding or recovery.
export async function computeCommitment(secretK: Uint8Array): Promise<string> {
  return mimcHash([BigInt(skToField(secretK))]);
}

export interface ChatProofResult extends RlnProofResult {
  ticketIndex: number;
  requestDigest: Awaited<ReturnType<typeof requestDigestToField>>;
}

function isStringMatrix(value: unknown): value is string[][] {
  return Array.isArray(value) && value.every(
    (layer) => Array.isArray(layer) && layer.every((node) => typeof node === 'string'),
  );
}

function parseMembershipSnapshot(value: unknown): PublicMembershipSnapshot {
  if (!value || typeof value !== 'object') throw new Error('The membership snapshot is malformed');
  const snapshot = value as Record<string, unknown>;
  if (
    typeof snapshot.root !== 'string'
    || typeof snapshot.depth !== 'number'
    || !Array.isArray(snapshot.leaves)
    || !snapshot.leaves.every((leaf) => typeof leaf === 'string')
    || (snapshot.layers !== undefined && !isStringMatrix(snapshot.layers))
    || typeof snapshot.generatedAt !== 'string'
  ) {
    throw new Error('The membership snapshot is malformed');
  }
  return {
    root: snapshot.root,
    depth: snapshot.depth,
    leaves: snapshot.leaves,
    layers: snapshot.layers as string[][] | undefined,
    generatedAt: snapshot.generatedAt,
  };
}

/** Fetches the public tree without a commitment or witness query parameter. */
export async function fetchMembershipTreeSnapshot(): Promise<PublicMembershipSnapshot> {
  const response = await fetch(`${GATEWAY_BASE}/v1/membership-tree`, { cache: 'no-store' });
  if (!response.ok) throw new Error('The current membership tree could not be loaded');
  const snapshot = parseMembershipSnapshot(await response.json());
  const generatedAt = Date.parse(snapshot.generatedAt!);
  const age = Date.now() - generatedAt;
  if (!Number.isFinite(generatedAt) || age > MEMBERSHIP_SNAPSHOT_MAX_AGE_MS || age < -5_000) {
    throw new Error('The membership snapshot is stale; refresh and try again');
  }
  return snapshot;
}

/** Derives the caller-specific path locally from a public, freshly fetched tree. */
export async function membershipWitnessForSecret(secretK: Uint8Array): Promise<MembershipWitness> {
  const commitment = await mimcHash([BigInt(skToField(secretK))]);
  return deriveMembershipWitness(commitment, await fetchMembershipTreeSnapshot());
}

export async function generateChatProof(
  secretK: Uint8Array,
  ticketIndex: number,
  requestBody: unknown,
): Promise<ChatProofResult> {
  const requestDigest = await requestDigestToField(requestBody);
  const membershipWitness = await membershipWitnessForSecret(secretK);
  const result = await generateRlnProofSelfVerified(
    {
      secret_k: skToField(secretK),
      ticket_index: ticketIndex.toString(),
      request_digest: requestDigest.field,
      merkle_path_elements: membershipWitness.merklePathElements,
      merkle_path_indices: membershipWitness.merklePathIndices,
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

/** Preferred withdrawal path: use the same freshly fetched public snapshot as RLN. */
export async function generateCurrentMembershipWithdrawalProof(
  secretK: Uint8Array,
): Promise<MembershipRemovalProofResult> {
  const membershipWitness = await membershipWitnessForSecret(secretK);
  return generateWithdrawalProof(
    secretK,
    membershipWitness.merklePathElements,
    membershipWitness.merklePathIndices,
  );
}
