import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CIRCUIT_MANIFEST,
  verifyArtifactManifest,
} from './artifact-manifest.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('circuit artifact manifest', () => {
  it('accepts the version-pinned proving resources shipped with the package', async () => {
    const artifactDirectory = resolve(import.meta.dirname!, '..', 'circuits');

    await expect(verifyArtifactManifest(artifactDirectory)).resolves.toEqual(CIRCUIT_MANIFEST);
  });

  it('rejects an artifact whose content does not match the signed-in manifest hash', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zk-credits-artifacts-'));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, 'test.wasm'), 'tampered');

    await expect(verifyArtifactManifest(directory, [{
      file: 'test.wasm',
      sha256: '0'.repeat(64),
    }])).rejects.toThrow('Circuit artifact hash mismatch');
  });
});
