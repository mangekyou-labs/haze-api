import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  generateRlnProofSelfVerified,
  requestDigestToField,
  skToField,
  type RlnCircuitResources,
  type RlnProofInput,
  type RlnProofResult,
} from '@zk-credits/shared';
import { verifyArtifactManifest } from './artifact-manifest.js';
import { MembershipClient } from './membership-client.js';
import type { ProofGenerator } from './sidecar.js';

export interface MembershipWitnessReader {
  witnessForSecret(secretK: Uint8Array): ReturnType<MembershipClient['witnessForSecret']>;
}

export type SelfVerifyingRlnProver = (
  input: RlnProofInput,
  resources: RlnCircuitResources,
) => Promise<Pick<RlnProofResult, 'proof' | 'publicSignals'>>;

export interface LocalProofGeneratorOptions {
  secretK: Uint8Array;
  membershipClient: MembershipWitnessReader;
  artifactDirectory?: string;
  prove?: SelfVerifyingRlnProver;
}

/**
 * Builds the sidecar's local prover after checking every installed circuit
 * byte against its release manifest. No proving asset is fetched at runtime.
 */
export async function createLocalProofGenerator(
  options: LocalProofGeneratorOptions,
): Promise<ProofGenerator> {
  const artifactDirectory = options.artifactDirectory ?? resolve(import.meta.dirname!, '..', 'circuits');
  await verifyArtifactManifest(artifactDirectory);
  const verificationKey: unknown = JSON.parse(
    await readFile(resolve(artifactDirectory, 'verification_key_rln.json'), 'utf8'),
  );
  const prove = options.prove ?? generateRlnProofSelfVerified;

  return async ({ ticketIndex, request }) => {
    const [requestDigest, witness] = await Promise.all([
      requestDigestToField(request),
      options.membershipClient.witnessForSecret(options.secretK),
    ]);
    const result = await prove({
      secret_k: skToField(options.secretK),
      ticket_index: ticketIndex.toString(),
      request_digest: requestDigest.field,
      merkle_path_elements: witness.merklePathElements,
      merkle_path_indices: witness.merklePathIndices,
    }, {
      rlnWasm: resolve(artifactDirectory, 'rln_nullifier.wasm'),
      rlnZkey: resolve(artifactDirectory, 'rln_nullifier_final.zkey'),
      rlnVk: verificationKey,
    });
    return { proof: result.proof, pubSignals: result.publicSignals };
  };
}
