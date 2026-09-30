/** Verified packaged acquisition for local proving material. */

import { createHash, randomUUID } from 'node:crypto';
import { execFile as nodeExecFile } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { promisify } from 'node:util';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import type { CircuitManifest, PinnedArtifactRelease } from './artifact-bundle.js';
import { resolvePinnedArtifactBundle } from './artifact-bundle.js';

const execFile = promisify(nodeExecFile);
const MAX_COMPRESSED_BYTES = 20 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
const BLOCK_BYTES = 512;
const SAFE_TAR_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export type GithubCommand = (arguments_: readonly string[]) => Promise<string>;

export interface AcquirePinnedBundleOptions {
  manifest: CircuitManifest;
  targetDirectory: string;
  runGithubCommand?: GithubCommand;
  archivePath?: string;
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function zeroBlock(block: Buffer): boolean {
  return block.every((byte) => byte === 0);
}

function tarText(header: Buffer, start: number, length: number, label: string): string {
  const bytes = header.subarray(start, start + length);
  const terminator = bytes.indexOf(0);
  const value = bytes.subarray(0, terminator < 0 ? bytes.length : terminator);
  if (!value.every((byte) => byte >= 0x20 && byte <= 0x7e)) {
    throw new Error('Pinned proving bundle archive contains an invalid ' + label);
  }
  return value.toString('ascii');
}

function tarOctal(header: Buffer, start: number, length: number, label: string): number {
  const value = tarText(header, start, length, label).trim();
  if (!value) return 0;
  if (!/^[0-7]+$/u.test(value)) throw new Error('Pinned proving bundle archive has an invalid ' + label);
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('Pinned proving bundle archive has an invalid ' + label);
  return parsed;
}

function parseTar(archive: Buffer, allowedNames: ReadonlySet<string>): Map<string, Buffer> {
  if (archive.length === 0 || archive.length > MAX_EXPANDED_BYTES || archive.length % BLOCK_BYTES !== 0) {
    throw new Error('Pinned proving bundle archive has an invalid size');
  }
  const files = new Map<string, Buffer>();
  let offset = 0;
  let endBlocks = 0;
  while (offset + BLOCK_BYTES <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK_BYTES);
    if (zeroBlock(header)) {
      endBlocks += 1;
      offset += BLOCK_BYTES;
      if (endBlocks === 2) break;
      continue;
    }
    if (endBlocks > 0) throw new Error('Pinned proving bundle archive has a malformed end marker');

    const recordedChecksum = tarOctal(header, 148, 8, 'header checksum');
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    const actualChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
    if (recordedChecksum !== actualChecksum) throw new Error('Pinned proving bundle archive failed its header checksum');
    const magic = header.subarray(257, 263).toString('ascii');
    if (magic !== 'ustar\0' && magic !== 'ustar ') {
      throw new Error('Pinned proving bundle archive must use the USTAR format');
    }
    const name = tarText(header, 0, 100, 'entry name');
    const prefix = tarText(header, 345, 155, 'entry prefix');
    if (!name || prefix || !SAFE_TAR_NAME.test(name) || name.includes('..') || !allowedNames.has(name)) {
      throw new Error('Pinned proving bundle archive contains an unexpected entry');
    }
    const type = header[156];
    if (type !== 0 && type !== 0x30) throw new Error('Pinned proving bundle archive contains a non-file entry');
    if (tarText(header, 157, 100, 'link target')) throw new Error('Pinned proving bundle archive contains a link');
    if (files.has(name)) throw new Error('Pinned proving bundle archive contains a duplicate entry');
    const size = tarOctal(header, 124, 12, 'entry size');
    const dataStart = offset + BLOCK_BYTES;
    const dataEnd = dataStart + size;
    const paddedEnd = dataStart + Math.ceil(size / BLOCK_BYTES) * BLOCK_BYTES;
    if (size <= 0 || dataEnd > archive.length || paddedEnd > archive.length) {
      throw new Error('Pinned proving bundle archive entry exceeds its bounds');
    }
    if (!zeroBlock(archive.subarray(dataEnd, paddedEnd))) {
      throw new Error('Pinned proving bundle archive has invalid entry padding');
    }
    files.set(name, Buffer.from(archive.subarray(dataStart, dataEnd)));
    offset = paddedEnd;
  }
  if (endBlocks !== 2) throw new Error('Pinned proving bundle archive is missing its end marker');
  if (!zeroBlock(archive.subarray(offset))) throw new Error('Pinned proving bundle archive has trailing data');
  if (files.size !== allowedNames.size || [...allowedNames].some((name) => !files.has(name))) {
    throw new Error('Pinned proving bundle archive is incomplete');
  }
  return files;
}

async function defaultGithubCommand(arguments_: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFile('gh', [...arguments_], {
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch {
    throw new Error('Pinned proving release could not be read; authenticate with gh and confirm repository access.');
  }
}

function pinnedAsset(release: PinnedArtifactRelease, raw: string): void {
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; } catch {
    throw new Error('Pinned proving release metadata is invalid');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Pinned proving release metadata is invalid');
  }
  const record = value as Record<string, unknown>;
  const assets = Array.isArray(record.assets) ? record.assets : [];
  const asset = assets.find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
    && (entry as Record<string, unknown>).name === release.assetName) as Record<string, unknown> | undefined;
  if (record.id !== release.releaseId
    || record.tag_name !== release.tag
    || record.draft !== false
    || record.immutable !== true
    || !asset
    || (typeof asset.digest === 'string' && asset.digest !== 'sha256:' + release.sha256)) {
    throw new Error('Pinned proving release identity or immutability check failed');
  }
}

async function writeBundleFile(directory: string, name: string, bytes: Buffer): Promise<void> {
  const file = await open(join(directory, name), 'wx', 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}

async function replaceDirectoryAtomically(stage: string, target: string): Promise<void> {
  const parent = dirname(target);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const backup = join(parent, '.base-sepolia-old-' + randomUUID());
  let movedOld = false;
  try {
    try {
      const existing = await lstat(target);
      if (existing.isSymbolicLink() || !existing.isDirectory()) {
        throw new Error('Local proving bundle destination must be a regular directory');
      }
      await rename(target, backup);
      movedOld = true;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        // No previous bundle is a normal first-run case.
      } else {
        throw error;
      }
    }
    try {
      await rename(stage, target);
      await chmod(target, 0o700);
    } catch (error) {
      if (movedOld) await rename(backup, target);
      throw error;
    }
    if (movedOld) await rm(backup, { recursive: true, force: true }).catch(() => undefined);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

/** Installs the packaged pinned archive; explicit legacy callers may acquire it via GitHub. */
export async function acquirePinnedArtifactBundle(options: AcquirePinnedBundleOptions): Promise<string> {
  const release = options.manifest.release;
  if (!release) throw new Error('This sidecar manifest has no pinned artifact release');
  const names = new Set(options.manifest.artifacts.map((artifact) => artifact.file));
  const command = options.runGithubCommand ?? defaultGithubCommand;
  const parent = dirname(resolve(options.targetDirectory));
  const tempDirectory = join(parent, '.base-sepolia-download-' + randomUUID());
  const stage = join(parent, '.base-sepolia-stage-' + randomUUID());
  try {
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await mkdir(tempDirectory, { recursive: false, mode: 0o700 });
    await mkdir(stage, { recursive: false, mode: 0o700 });
    let archivePath = options.archivePath ?? fileURLToPath(new URL('../circuits/' + release.assetName, import.meta.url));
    if (options.runGithubCommand) {
      // Explicit legacy/test acquisition. Normal operator setup is packaged.
      const releaseJson = await command(['api', `repos/${release.repository}/releases/${release.releaseId}`]);
      pinnedAsset(release, releaseJson);
      await command(['release', 'download', release.tag, '--repo', release.repository,
        '--dir', tempDirectory, '--pattern', release.assetName]);
      archivePath = join(tempDirectory, release.assetName);
    }
    const archiveInfo = await lstat(archivePath);
    if (archiveInfo.isSymbolicLink() || !archiveInfo.isFile() || archiveInfo.size > MAX_COMPRESSED_BYTES) {
      throw new Error('Pinned proving bundle archive is missing or too large');
    }
    const compressed = await readFile(archivePath);
    if (digest(compressed) !== release.sha256) throw new Error('Pinned proving bundle archive failed its SHA-256 check');
    let expanded: Buffer;
    try { expanded = gunzipSync(compressed, { maxOutputLength: MAX_EXPANDED_BYTES }); } catch {
      throw new Error('Pinned proving bundle archive is not a bounded gzip tarball');
    }
    const files = parseTar(expanded, names);
    for (const [name, bytes] of files) await writeBundleFile(stage, name, bytes);
    await chmod(stage, 0o700);
    await resolvePinnedArtifactBundle({ artifactDirectory: stage, manifest: options.manifest });
    await replaceDirectoryAtomically(stage, resolve(options.targetDirectory));
    await resolvePinnedArtifactBundle({ artifactDirectory: resolve(options.targetDirectory), manifest: options.manifest });
    return resolve(options.targetDirectory);
  } catch (error) {
    if (error instanceof Error && /^(Pinned proving|This sidecar manifest|Local proving bundle)/u.test(error.message)) throw error;
    throw new Error('Pinned proving bundle acquisition failed; reinstall the package containing its pinned archive.');
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
    await rm(stage, { recursive: true, force: true });
  }
}
