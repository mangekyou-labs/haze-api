import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCircuitManifest } from './artifact-bundle.js';
import { acquirePinnedArtifactBundle, type GithubCommand } from './artifact-release.js';

const files = {
  'private_credit_spend.wasm': Buffer.from('pinned wasm fixture'),
  'private_credit_spend.zkey': Buffer.from('pinned proving key fixture'),
  'verification_key_private_credit.json': Buffer.from(JSON.stringify({ protocol: 'groth16', curve: 'bn128', nPublic: 6 })),
};

function octal(value: number, width: number): Buffer {
  const text = value.toString(8).padStart(width - 1, '0') + '\0';
  return Buffer.from(text, 'ascii');
}

function tarFile(name: string, bytes: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'ascii');
  octal(0o600, 8).copy(header, 100);
  octal(0, 8).copy(header, 108);
  octal(0, 8).copy(header, 116);
  octal(bytes.length, 12).copy(header, 124);
  octal(0, 12).copy(header, 136);
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  octal(checksum, 8).copy(header, 148);
  const padding = Buffer.alloc(Math.ceil(bytes.length / 512) * 512 - bytes.length);
  return Buffer.concat([header, bytes, padding]);
}

function bundleArchive(entryNames: readonly string[] = Object.keys(files)): Buffer {
  const entries = entryNames.map((name) => tarFile(name, files[name as keyof typeof files] ?? Buffer.from('unexpected')));
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
}

function manifest(archive: Buffer) {
  return parseCircuitManifest({
    version: 1,
    scheme: 'groth16',
    network: 'base-sepolia',
    circuit: {
      id: 'private-credit-depth-20',
      depth: 20,
      wasm: 'private_credit_spend.wasm',
      zkey: 'private_credit_spend.zkey',
      verificationKey: 'verification_key_private_credit.json',
    },
    artifacts: Object.entries(files).map(([file, bytes]) => ({
      file,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })),
    release: {
      repository: 'mangekyou-labs/zk-credits-base-sepolia-v2-bundle',
      tag: 'v2.0.0',
      releaseId: 1234,
      assetName: 'base-sepolia-v2.tar.gz',
      sha256: createHash('sha256').update(archive).digest('hex'),
    },
  });
}

function commandFor(archive: Buffer, releaseId = 1234): GithubCommand {
  return async (arguments_) => {
    if (arguments_[0] === 'api') {
      return JSON.stringify({
        id: releaseId,
        tag_name: 'v2.0.0',
        draft: false,
        immutable: true,
        assets: [{ name: 'base-sepolia-v2.tar.gz', digest: 'sha256:' + createHash('sha256').update(archive).digest('hex') }],
      });
    }
    if (arguments_[0] === 'release' && arguments_[1] === 'download') {
      const directory = arguments_[arguments_.indexOf('--dir') + 1]!;
      await writeFile(join(directory, 'base-sepolia-v2.tar.gz'), archive);
      return '';
    }
    throw new Error('Unexpected gh command');
  };
}

describe('authenticated immutable artifact acquisition', () => {
  it('verifies release identity and archive hash, then atomically installs owner-only files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zk-credits-release-'));
    const target = join(root, '.zk-credits', 'artifacts', 'base-sepolia');
    const archive = bundleArchive();

    await acquirePinnedArtifactBundle({ manifest: manifest(archive), targetDirectory: target, runGithubCommand: commandFor(archive) });

    expect(await readFile(join(target, 'private_credit_spend.zkey'))).toEqual(files['private_credit_spend.zkey']);
    expect((await stat(target)).mode & 0o777).toBe(0o700);
    expect((await stat(join(target, 'private_credit_spend.wasm'))).mode & 0o777).toBe(0o600);
    expect(await (await import('node:fs/promises')).readdir(root)).toEqual(['.zk-credits']);
  });

  it('rejects unsafe archive paths before writing outside the staging directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zk-credits-release-traversal-'));
    const target = join(root, '.zk-credits', 'artifacts', 'base-sepolia');
    await mkdir(join(root, '.zk-credits'), { recursive: true });
    const archive = bundleArchive(['../escape', ...Object.keys(files).slice(1)]);

    await expect(acquirePinnedArtifactBundle({
      manifest: manifest(archive),
      targetDirectory: target,
      runGithubCommand: commandFor(archive),
    })).rejects.toThrow('unexpected entry');
    await expect(stat(join(root, 'escape'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails closed when GitHub release metadata does not match the pinned identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zk-credits-release-id-'));
    const archive = bundleArchive();
    await expect(acquirePinnedArtifactBundle({
      manifest: manifest(archive),
      targetDirectory: join(root, 'bundle'),
      runGithubCommand: commandFor(archive, 4321),
    })).rejects.toThrow('identity or immutability');
  });
});
