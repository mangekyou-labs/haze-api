import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ArtifactBundleError,
  loadCircuitManifest,
  parseCircuitManifest,
  resolvePinnedArtifactBundle,
  type CircuitManifest,
} from './artifact-bundle.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'zk-credits-artifacts-'));
  temporaryDirectories.push(directory);
  return directory;
}

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

const VERIFICATION_KEY = JSON.stringify({ protocol: 'groth16', curve: 'bn128', nPublic: 6, vk_alpha_1: ['1'] });

async function installedBundle(contents: Partial<Record<'wasm' | 'zkey' | 'verificationKey', string>> = {}) {
  const directory = await temporaryDirectory();
  const files = {
    'private_credit_spend.wasm': contents.wasm ?? 'wasm-bytes',
    'private_credit_spend.zkey': contents.zkey ?? 'zkey-bytes',
    'verification_key_private_credit.json': contents.verificationKey ?? VERIFICATION_KEY,
  };
  await writeFile(join(directory, 'private_credit_spend.wasm'), files['private_credit_spend.wasm']);
  await writeFile(join(directory, 'private_credit_spend.zkey'), files['private_credit_spend.zkey']);
  await writeFile(join(directory, 'verification_key_private_credit.json'), files['verification_key_private_credit.json']);
  const manifest = parseCircuitManifest({
    version: 1,
    scheme: 'zk-prepaid',
    network: 'eip155:84532',
    circuit: {
      id: 'private-credit-spend-bn254-dev',
      depth: 20,
      wasm: 'private_credit_spend.wasm',
      zkey: 'private_credit_spend.zkey',
      verificationKey: 'verification_key_private_credit.json',
    },
    artifacts: Object.entries(files).map(([file, content]) => ({ file, sha256: digest(content) })),
  });
  return { directory, manifest, files };
}

function failureCategory(error: unknown): string {
  return error instanceof ArtifactBundleError ? error.category : 'not-an-artifact-error';
}

describe('pinned proving artifacts', () => {
  it('parses the shipped Base Sepolia manifest and pins each required artifact', async () => {
    const manifest = await loadCircuitManifest();
    expect(manifest.scheme).toBe('zk-prepaid');
    expect(manifest.network).toBe('eip155:84532');
    expect(manifest.circuit.id).toBe('private-credit-spend-bn254-dev');
    expect(manifest.circuit.depth).toBe(20);
    expect(manifest.artifacts.map((artifact) => artifact.file).sort()).toEqual([
      'private_credit_spend.wasm',
      'private_credit_spend.zkey',
      'verification_key_private_credit.json',
    ]);
    for (const artifact of manifest.artifacts) expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('resolves a complete hash-matching bundle', async () => {
    const { directory, manifest } = await installedBundle();
    const bundle = await resolvePinnedArtifactBundle({ artifactDirectory: directory, manifest });
    expect(bundle.circuitId).toBe('private-credit-spend-bn254-dev');
    expect(bundle.depth).toBe(20);
    expect(bundle.wasmPath).toBe(join(directory, 'private_credit_spend.wasm'));
    expect(bundle.verificationKey).toMatchObject({ protocol: 'groth16', curve: 'bn128', nPublic: 6 });
  });

  it('fails closed when the installed bundle is incomplete or altered', async () => {
    const { directory, manifest } = await installedBundle();
    await rm(join(directory, 'private_credit_spend.zkey'));
    await expect(resolvePinnedArtifactBundle({ artifactDirectory: directory, manifest }))
      .rejects.toSatisfy((error) => failureCategory(error) === 'artifact_missing');

    const altered = await installedBundle();
    await writeFile(join(altered.directory, 'private_credit_spend.wasm'), 'wasm-tampered');
    await expect(resolvePinnedArtifactBundle({ artifactDirectory: altered.directory, manifest: altered.manifest }))
      .rejects.toSatisfy((error) => failureCategory(error) === 'artifact_hash_mismatch');

    const wrongKey = await installedBundle({ verificationKey: JSON.stringify({ protocol: 'groth16', curve: 'bn128', nPublic: 5 }) });
    await expect(resolvePinnedArtifactBundle({ artifactDirectory: wrongKey.directory, manifest: wrongKey.manifest }))
      .rejects.toSatisfy((error) => failureCategory(error) === 'artifact_hash_mismatch');
  });

  it('rejects a missing directory and non-local locations', async () => {
    const { manifest } = await installedBundle();
    await expect(resolvePinnedArtifactBundle({ artifactDirectory: join(tmpdir(), 'zk-credits-missing-bundle'), manifest }))
      .rejects.toSatisfy((error) => failureCategory(error) === 'artifact_missing');
    for (const remote of ['https://cdn.example/bundle', 'file:///tmp/bundle', 'ipfs://bundle']) {
      await expect(resolvePinnedArtifactBundle({ artifactDirectory: remote, manifest }))
        .rejects.toSatisfy((error) => failureCategory(error) === 'artifact_remote');
    }
    await expect(resolvePinnedArtifactBundle({ artifactDirectory: 'relative/bundle', manifest }))
      .rejects.toSatisfy((error) => failureCategory(error) === 'artifact_missing');
  });

  it('rejects a symlink that escapes the installed bundle', async () => {
    const outside = await temporaryDirectory();
    await writeFile(join(outside, 'private_credit_spend.wasm'), 'wasm-bytes');
    const { directory, manifest } = await installedBundle();
    await rm(join(directory, 'private_credit_spend.wasm'));
    await symlink(join(outside, 'private_credit_spend.wasm'), join(directory, 'private_credit_spend.wasm'));
    await expect(resolvePinnedArtifactBundle({ artifactDirectory: directory, manifest }))
      .rejects.toSatisfy((error) => failureCategory(error) === 'artifact_escaped');
  });

  it('rejects manifests with escapes, missing pins, and malformed hashes', () => {
    const base = {
      version: 1,
      scheme: 'zk-prepaid',
      network: 'eip155:84532',
      circuit: {
        id: 'circuit',
        depth: 20,
        wasm: 'private_credit_spend.wasm',
        zkey: 'private_credit_spend.zkey',
        verificationKey: 'verification_key_private_credit.json',
      },
      artifacts: [
        { file: 'private_credit_spend.wasm', sha256: 'a'.repeat(64) },
        { file: 'private_credit_spend.zkey', sha256: 'b'.repeat(64) },
        { file: 'verification_key_private_credit.json', sha256: 'c'.repeat(64) },
      ],
    };
    const parse = (value: unknown): CircuitManifest => parseCircuitManifest(value);

    expect(failureCategory(catchError(() => parse({ ...base, artifacts: base.artifacts.slice(0, 1) })))).toBe('artifact_manifest_malformed');
    expect(failureCategory(catchError(() => parse({ ...base, artifacts: [{ file: '../escape.wasm', sha256: 'a'.repeat(64) }] })))).toBe('artifact_manifest_malformed');
    expect(failureCategory(catchError(() => parse({ ...base, artifacts: [{ file: 'x.wasm', sha256: 'deadbeef' }] })))).toBe('artifact_manifest_malformed');
    expect(failureCategory(catchError(() => parse({ ...base, artifacts: [{ file: 'x.wasm', sha256: 'A'.repeat(64) }] })))).toBe('artifact_manifest_malformed');
    expect(failureCategory(catchError(() => parse({ ...base, circuit: { ...base.circuit, depth: 0 } })))).toBe('artifact_manifest_malformed');
    expect(failureCategory(catchError(() => parse({ ...base, version: 2 })))).toBe('artifact_manifest_malformed');
  });
});

function catchError(task: () => unknown): unknown {
  try {
    task();
    return undefined;
  } catch (error) {
    return error;
  }
}
