/**
 * Hash-pinned local proving artifacts.
 *
 * The sidecar never fetches proving material at runtime. The shipped manifest
 * pins the SHA-256 of every artifact of one frozen bundle; the bytes are
 * installed out of band next to the operator's state. A missing, relocated,
 * swapped, or partially installed bundle fails closed before any prove.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ARTIFACT_HASHES = ['wasm', 'zkey', 'verificationKey'] as const;
export type ArtifactRole = (typeof ARTIFACT_HASHES)[number];

export type ArtifactFailure =
  | 'artifact_remote'
  | 'artifact_missing'
  | 'artifact_escaped'
  | 'artifact_hash_mismatch'
  | 'artifact_manifest_malformed';

export class ArtifactBundleError extends Error {
  constructor(
    readonly category: ArtifactFailure,
    message: string,
  ) {
    super(message);
    this.name = 'ArtifactBundleError';
  }
}

export interface PinnedArtifact {
  file: string;
  sha256: string;
}

export interface CircuitManifest {
  version: number;
  scheme: string;
  network: string;
  circuit: {
    id: string;
    depth: number;
    wasm: string;
    zkey: string;
    verificationKey: string;
  };
  artifacts: PinnedArtifact[];
}

export interface PinnedArtifactBundle {
  directory: string;
  circuitId: string;
  depth: number;
  wasmPath: string;
  zkeyPath: string;
  verificationKey: unknown;
  artifacts: readonly PinnedArtifact[];
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
/** A pinned artifact is a bare file name, never a path or a remote location. */
const SAFE_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const REMOTE_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ArtifactBundleError('artifact_manifest_malformed', `Circuit manifest field ${key} is required`);
  }
  return value;
}

function pinnedFile(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_FILE_PATTERN.test(value) || value.includes('..')) {
    throw new ArtifactBundleError('artifact_manifest_malformed', `Circuit manifest ${label} must be a bare file name`);
  }
  return value;
}

/** Parses the shipped manifest. Unknown pins and malformed hashes fail closed. */
export function parseCircuitManifest(value: unknown): CircuitManifest {
  if (!isRecord(value)) throw new ArtifactBundleError('artifact_manifest_malformed', 'Circuit manifest must be an object');
  if (value.version !== 1) throw new ArtifactBundleError('artifact_manifest_malformed', 'Unsupported circuit manifest version');
  if (!isRecord(value.circuit)) throw new ArtifactBundleError('artifact_manifest_malformed', 'Circuit manifest is missing the circuit block');
  const circuit = value.circuit;
  const depth = circuit.depth;
  if (!Number.isSafeInteger(depth) || (depth as number) <= 0) {
    throw new ArtifactBundleError('artifact_manifest_malformed', 'Circuit depth must be a positive integer');
  }
  if (!Array.isArray(value.artifacts) || value.artifacts.length === 0) {
    throw new ArtifactBundleError('artifact_manifest_malformed', 'Circuit manifest must pin at least one artifact');
  }
  const artifacts: PinnedArtifact[] = value.artifacts.map((artifact, index) => {
    if (!isRecord(artifact)) throw new ArtifactBundleError('artifact_manifest_malformed', `Pinned artifact ${index} must be an object`);
    const file = pinnedFile(artifact.file, `artifact ${index} file`);
    if (typeof artifact.sha256 !== 'string' || !SHA256_PATTERN.test(artifact.sha256)) {
      throw new ArtifactBundleError('artifact_manifest_malformed', `Pinned artifact ${file} must carry a lowercase SHA-256 digest`);
    }
    return { file, sha256: artifact.sha256 };
  });
  const unique = new Set(artifacts.map((artifact) => artifact.file));
  if (unique.size !== artifacts.length) throw new ArtifactBundleError('artifact_manifest_malformed', 'Pinned artifacts must be unique');
  const resolved: CircuitManifest = {
    version: 1,
    scheme: requiredString(value, 'scheme'),
    network: requiredString(value, 'network'),
    circuit: {
      id: requiredString(circuit, 'id'),
      depth: depth as number,
      wasm: pinnedFile(circuit.wasm, 'wasm'),
      zkey: pinnedFile(circuit.zkey, 'zkey'),
      verificationKey: pinnedFile(circuit.verificationKey, 'verificationKey'),
    },
    artifacts,
  };
  const pinned = new Set(artifacts.map((artifact) => artifact.file));
  for (const role of ARTIFACT_HASHES) {
    const file = resolved.circuit[role];
    if (!pinned.has(file)) {
      throw new ArtifactBundleError('artifact_manifest_malformed', `Circuit ${role} ${file} is not pinned with a SHA-256 digest`);
    }
  }
  return resolved;
}

/** Loads the manifest shipped inside this package unless the caller supplies one. */
export async function loadCircuitManifest(manifestPath?: string): Promise<CircuitManifest> {
  const path = manifestPath ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', 'circuits', 'manifest.json');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new ArtifactBundleError('artifact_missing', `Circuit manifest is missing at ${path}`);
  }
  try {
    return parseCircuitManifest(JSON.parse(raw) as unknown);
  } catch (error) {
    if (error instanceof ArtifactBundleError) throw error;
    throw new ArtifactBundleError('artifact_manifest_malformed', 'Circuit manifest is not valid JSON');
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

interface VerificationKeyShape {
  protocol?: unknown;
  curve?: unknown;
  nPublic?: unknown;
}

/** The frozen verification key must describe the six-signal Groth16/BN254 ABI. */
export function assertVerificationKeyShape(value: unknown, expectedPublicSignals: number): void {
  if (!isRecord(value)) throw new ArtifactBundleError('artifact_hash_mismatch', 'Verification key must be a JSON object');
  const shape = value as VerificationKeyShape;
  if (shape.protocol !== 'groth16' || shape.curve !== 'bn128' || shape.nPublic !== expectedPublicSignals) {
    throw new ArtifactBundleError(
      'artifact_hash_mismatch',
      `Verification key must be Groth16 on bn128 with ${expectedPublicSignals} public signals`,
    );
  }
}

export interface ResolvePinnedBundleOptions {
  /** Operator-installed directory that holds the frozen bytes. */
  artifactDirectory: string;
  manifest: CircuitManifest;
  /** Public outputs of the circuits, checked against the verification key. */
  expectedPublicSignals?: number;
}

function assertLocalDirectory(artifactDirectory: string): string {
  if (typeof artifactDirectory !== 'string' || artifactDirectory.length === 0) {
    throw new ArtifactBundleError('artifact_missing', 'An artifact directory is required');
  }
  if (REMOTE_PATTERN.test(artifactDirectory)) {
    throw new ArtifactBundleError('artifact_remote', 'Proving artifacts must be installed locally, never fetched');
  }
  if (!isAbsolute(artifactDirectory)) {
    throw new ArtifactBundleError('artifact_missing', 'Artifact directory must be an absolute local path');
  }
  return resolve(artifactDirectory);
}

function assertWithinDirectory(directory: string, candidate: string, file: string): void {
  if (candidate !== directory && !candidate.startsWith(`${directory}${sep}`)) {
    throw new ArtifactBundleError('artifact_escaped', `Artifact ${file} resolves outside the pinned artifact directory`);
  }
}

/** Resolves one complete, hash-matching bundle or throws before any prove. */
export async function resolvePinnedArtifactBundle(options: ResolvePinnedBundleOptions): Promise<PinnedArtifactBundle> {
  const directory = assertLocalDirectory(options.artifactDirectory);
  const manifest = options.manifest;
  let realDirectory: string;
  try {
    const info = await stat(directory);
    if (!info.isDirectory()) throw new ArtifactBundleError('artifact_missing', 'Artifact directory is not a directory');
    realDirectory = await realpath(directory);
  } catch (error) {
    if (error instanceof ArtifactBundleError) throw error;
    throw new ArtifactBundleError('artifact_missing', `Artifact directory ${directory} is not installed`);
  }

  for (const artifact of manifest.artifacts) {
    const path = join(directory, artifact.file);
    let realFile: string;
    try {
      const info = await stat(path);
      if (!info.isFile()) throw new ArtifactBundleError('artifact_missing', `Artifact ${artifact.file} is not a regular file`);
      realFile = await realpath(path);
    } catch (error) {
      if (error instanceof ArtifactBundleError) throw error;
      throw new ArtifactBundleError('artifact_missing', `Artifact ${artifact.file} is missing from the pinned bundle`);
    }
    assertWithinDirectory(realDirectory, realFile, artifact.file);
    const digest = await sha256File(realFile);
    if (digest !== artifact.sha256) {
      throw new ArtifactBundleError('artifact_hash_mismatch', `Artifact ${artifact.file} does not match the pinned SHA-256 digest`);
    }
  }

  const verificationKeyPath = join(directory, manifest.circuit.verificationKey);
  let verificationKey: unknown;
  try {
    verificationKey = JSON.parse(await readFile(verificationKeyPath, 'utf8')) as unknown;
  } catch {
    throw new ArtifactBundleError('artifact_missing', `Verification key ${manifest.circuit.verificationKey} is not valid JSON`);
  }
  assertVerificationKeyShape(verificationKey, options.expectedPublicSignals ?? 6);

  return {
    directory,
    circuitId: manifest.circuit.id,
    depth: manifest.circuit.depth,
    wasmPath: join(directory, manifest.circuit.wasm),
    zkeyPath: join(directory, manifest.circuit.zkey),
    verificationKey,
    artifacts: manifest.artifacts,
  };
}
