import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface CircuitArtifact {
  file: string;
  sha256: string;
}

/** Version-pinned contents of the circuits directory shipped in this package. */
export const CIRCUIT_MANIFEST: readonly CircuitArtifact[] = [
  {
    file: 'rln_nullifier.wasm',
    sha256: '38370baebbafb76562d5c94e15354c04152c388bffe1bf85faeeb4dd221538c1',
  },
  {
    file: 'rln_nullifier_final.zkey',
    sha256: '11cd9e881437283701dcebd75be469d57ec7428de3495d229268eb75f2413cc8',
  },
  {
    file: 'verification_key_rln.json',
    sha256: '9a521e0e19dc272c281f1a41abf79571bb0094cda653c890bdd95aa5b4c5f1ee',
  },
];

/** Refuses to prove when an installed circuit differs from the pinned release. */
export async function verifyArtifactManifest(
  artifactDirectory: string,
  manifest: readonly CircuitArtifact[] = CIRCUIT_MANIFEST,
): Promise<readonly CircuitArtifact[]> {
  for (const artifact of manifest) {
    const content = await readFile(join(artifactDirectory, artifact.file));
    const digest = createHash('sha256').update(content).digest('hex');
    if (digest !== artifact.sha256) {
      throw new Error(`Circuit artifact hash mismatch: ${artifact.file}`);
    }
  }
  return manifest;
}
