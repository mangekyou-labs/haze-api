import { randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { resolvePinnedArtifactBundle, type CircuitManifest } from './artifact-bundle.js';
import { acquirePinnedArtifactBundle } from './artifact-release.js';

export type SetupWitnessSource =
  | { kind: 'file'; path: string }
  | {
      kind: 'base-events';
      rpcUrl: string;
      contractAddress: string;
      deploymentBlock?: string;
      confirmations?: string;
    };

export interface SetupConfig {
  version: 1;
  artifactDirectory: string;
  witness: SetupWitnessSource;
}

export interface ResolveSetupInputsOptions {
  environment: NodeJS.ProcessEnv;
  homeDirectory: string;
  stateDirectory: string;
  configPath: string;
  manifest: CircuitManifest;
  /** Must prove this source resolves a valid witness for the activated credential. */
  validateWitness(source: SetupWitnessSource): Promise<void>;
  /** Called only when more than one valid local candidate exists. */
  chooseCandidate?(kind: 'proving bundle' | 'witness file', candidates: readonly string[]): Promise<string>;
  /** Test seam for clean-install acquisition; production uses gh-authenticated release download. */
  acquireArtifactBundle?(targetDirectory: string, manifest: CircuitManifest): Promise<void>;
  workingDirectory?: string;
}

const WITNESS_FILENAMES = new Set([
  'base-tree.json',
  'base-sepolia-tree.json',
  'base-tree-artifact.json',
  'public-tree.json',
  'base-witness.json',
  'zk-credits-witness.json',
  'witness.json',
  'tree.json',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function absolutePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Setup configuration ' + label + ' is required');
  }
  return resolve(value);
}

function optionalUnsignedString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) {
    throw new Error('Local setup config ' + label + ' must be a non-negative integer');
  }
  return value;
}

function parseSetupConfig(value: unknown): SetupConfig {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.witness)) {
    throw new Error('Local setup config is malformed; remove ~/.zk-credits/config.json and run setup again.');
  }
  const artifactDirectory = absolutePath(value.artifactDirectory, 'artifactDirectory');
  const witnessValue = value.witness;
  let witness: SetupWitnessSource;
  if (witnessValue.kind === 'file') {
    witness = { kind: 'file', path: absolutePath(witnessValue.path, 'witness.path') };
  } else if (witnessValue.kind === 'base-events') {
    if (typeof witnessValue.rpcUrl !== 'string' || !/^https?:\/\//u.test(witnessValue.rpcUrl)) {
      throw new Error('Local setup config has an invalid Base RPC URL');
    }
    if (typeof witnessValue.contractAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/u.test(witnessValue.contractAddress)) {
      throw new Error('Local setup config has an invalid Base bond contract address');
    }
    const deploymentBlock = optionalUnsignedString(witnessValue.deploymentBlock, 'deploymentBlock');
    const confirmations = optionalUnsignedString(witnessValue.confirmations, 'confirmations');
    witness = {
      kind: 'base-events',
      rpcUrl: witnessValue.rpcUrl,
      contractAddress: witnessValue.contractAddress,
      ...(deploymentBlock === undefined ? {} : { deploymentBlock }),
      ...(confirmations === undefined ? {} : { confirmations }),
    };
  } else {
    throw new Error('Local setup config has an unknown witness source');
  }
  return { version: 1, artifactDirectory, witness };
}

function optionalEnvironmentInteger(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = environment[name]?.trim();
  if (!value) return undefined;
  if (!/^\d+$/u.test(value)) throw new Error(name + ' must be a non-negative integer');
  return value;
}

async function candidateDirectories(homeDirectory: string, stateDirectory: string): Promise<string[]> {
  const roots = [
    join(stateDirectory, 'artifacts', 'base-sepolia'),
    join(homeDirectory, '.zk-credits', 'artifacts', 'base-sepolia'),
    join(homeDirectory, 'Downloads'),
  ];
  const candidates = [...roots];
  for (const root of roots) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) candidates.push(join(root, entry.name));
    }
  }
  return [...new Set(candidates.map((path) => resolve(path)))];
}

async function chooseOne(
  kind: 'proving bundle' | 'witness file',
  candidates: string[],
  chooseCandidate?: ResolveSetupInputsOptions['chooseCandidate'],
): Promise<string> {
  if (candidates.length === 1) return candidates[0]!;
  if (!chooseCandidate) {
    const variable = kind === 'proving bundle' ? 'ZK_CREDITS_ARTIFACT_DIR' : 'ZK_CREDITS_WITNESS_PATH';
    throw new Error('Found more than one valid ' + kind + '; set ' + variable + ' to choose one.');
  }
  const selected = await chooseCandidate(kind, candidates);
  if (!candidates.includes(resolve(selected))) {
    throw new Error('The selected ' + kind + ' is not one of the validated local candidates');
  }
  return resolve(selected);
}

async function resolveArtifactDirectory(options: ResolveSetupInputsOptions, saved?: SetupConfig): Promise<string> {
  const explicit = options.environment.ZK_CREDITS_ARTIFACT_DIR?.trim();
  const candidates = explicit
    ? [resolve(options.workingDirectory ?? process.cwd(), explicit)]
    : [
        ...(saved ? [saved.artifactDirectory] : []),
        ...await candidateDirectories(options.homeDirectory, options.stateDirectory),
      ];
  const valid = new Map<string, string>();
  let explicitError: unknown;
  for (const candidate of candidates) {
    try {
      const bundle = await resolvePinnedArtifactBundle({
        artifactDirectory: candidate,
        manifest: options.manifest,
      });
      let identity = resolve(bundle.directory);
      try { identity = await realpath(bundle.directory); } catch { /* resolve already validated the directory */ }
      valid.set(identity, bundle.directory);
    } catch (error) {
      if (explicit) explicitError = error;
    }
  }
  if (explicit && valid.size === 0) {
    const reason = explicitError instanceof Error ? ' ' + explicitError.message : '';
    throw new Error('The configured proving bundle at ' + explicit + ' failed its pinned checks.' + reason);
  }
  if (valid.size === 0) {
    if (options.manifest.release && !explicit) {
      const targetDirectory = resolve(options.stateDirectory, 'artifacts', 'base-sepolia');
      const acquire = options.acquireArtifactBundle ?? (async (target: string, manifest: CircuitManifest) => {
        await acquirePinnedArtifactBundle({ manifest, targetDirectory: target });
      });
      await acquire(targetDirectory, options.manifest);
      const bundle = await resolvePinnedArtifactBundle({ artifactDirectory: targetDirectory, manifest: options.manifest });
      return resolve(bundle.directory);
    }
    throw new Error(
      'Could not find a valid pinned proving bundle. Set ZK_CREDITS_ARTIFACT_DIR to a verified local bundle.',
    );
  }
  const selected = await chooseOne('proving bundle', [...valid.values()], options.chooseCandidate);
  return resolve(selected);
}

function eventSourceFromEnvironment(
  environment: NodeJS.ProcessEnv,
  manifest: CircuitManifest,
): SetupWitnessSource | undefined {
  const rpcUrl = environment.BASE_RPC_URL?.trim();
  const configuredContract = environment.BASE_PRIVATE_CREDIT_BOND_ADDRESS?.trim();
  const configuredBlock = optionalEnvironmentInteger(environment, 'BASE_DEPLOYMENT_BLOCK');
  const deployment = manifest.deployment;
  if (deployment) {
    if (configuredContract && configuredContract.toLowerCase() !== deployment.bondAddress.toLowerCase()) {
      throw new Error('BASE_PRIVATE_CREDIT_BOND_ADDRESS does not match the pinned Base Sepolia V2 bond');
    }
    if (configuredBlock && configuredBlock !== deployment.deploymentBlock) {
      throw new Error('BASE_DEPLOYMENT_BLOCK does not match the pinned Base Sepolia V2 deployment block');
    }
  }
  const contractAddress = deployment?.bondAddress ?? configuredContract;
  if (!rpcUrl || !contractAddress) return undefined;
  const confirmations = optionalEnvironmentInteger(environment, 'BASE_CONFIRMATIONS');
  return {
    kind: 'base-events',
    rpcUrl,
    contractAddress,
    ...(deployment ? { deploymentBlock: deployment.deploymentBlock } : configuredBlock === undefined ? {} : { deploymentBlock: configuredBlock }),
    ...(confirmations === undefined ? {} : { confirmations }),
  };
}

function assertPinnedEventSource(source: SetupWitnessSource, manifest: CircuitManifest): void {
  const deployment = manifest.deployment;
  if (!deployment) return;
  if (source.kind !== 'base-events'
    || source.contractAddress.toLowerCase() !== deployment.bondAddress.toLowerCase()
    || source.deploymentBlock !== deployment.deploymentBlock) {
    throw new Error('Saved Base event witness source does not match the pinned Base Sepolia V2 deployment');
  }
}

function witnessCandidates(homeDirectory: string, stateDirectory: string): string[] {
  const roots = [
    join(stateDirectory, 'witnesses'),
    join(stateDirectory, 'witness'),
    join(homeDirectory, '.zk-credits', 'witnesses'),
    join(homeDirectory, 'Downloads'),
  ];
  return [...new Set(roots.flatMap((root) => [...WITNESS_FILENAMES].map((name) => resolve(root, name))))];
}

async function resolveWitnessSource(
  options: ResolveSetupInputsOptions,
  saved?: SetupConfig,
): Promise<SetupWitnessSource> {
  const environment = options.environment;
  const explicitPath = environment.ZK_CREDITS_WITNESS_PATH?.trim();
  if (explicitPath) {
    if (options.manifest.deployment) {
      throw new Error('Base Sepolia V2 setup requires a witness synchronized from the pinned public Base events');
    }
    const source: SetupWitnessSource = {
      kind: 'file',
      path: resolve(options.workingDirectory ?? process.cwd(), explicitPath),
    };
    try {
      await options.validateWitness(source);
      return source;
    } catch (error) {
      const reason = error instanceof Error ? ' ' + error.message : '';
      throw new Error('The configured Base witness at ' + explicitPath + ' failed validation.' + reason);
    }
  }

  const environmentSource = eventSourceFromEnvironment(environment, options.manifest);
  if (environmentSource) {
    try {
      await options.validateWitness(environmentSource);
      return environmentSource;
    } catch (error) {
      const reason = error instanceof Error ? ' ' + error.message : '';
      throw new Error('Base event witness sync failed.' + reason);
    }
  }

  if (saved?.witness.kind === 'base-events') {
    try {
      assertPinnedEventSource(saved.witness, options.manifest);
      await options.validateWitness(saved.witness);
      return saved.witness;
    } catch (error) {
      const reason = error instanceof Error ? ' ' + error.message : '';
      throw new Error('Saved Base event witness source failed validation.' + reason);
    }
  }
  if (options.manifest.deployment) {
    throw new Error('Base Sepolia V2 setup requires BASE_RPC_URL to sync the pinned V2 bond from its deployment block');
  }
  if (saved?.witness.kind === 'file') {
    try {
      await options.validateWitness(saved.witness);
      return saved.witness;
    } catch {
      // A saved local witness can become stale for a different activated credential.
    }
  }

  const valid: string[] = [];
  for (const path of witnessCandidates(options.homeDirectory, options.stateDirectory)) {
    try {
      const info = await lstat(path);
      if (!info.isFile()) continue;
      const source: SetupWitnessSource = { kind: 'file', path };
      await options.validateWitness(source);
      valid.push(path);
    } catch {
      // Ignore absent, unrelated, and non-resolving local files while searching.
    }
  }
  if (valid.length > 0) {
    return { kind: 'file', path: await chooseOne('witness file', valid, options.chooseCandidate) };
  }
  throw new Error(
    'Could not find a public Base witness for this credential. Put base-tree.json or witness.json in ~/.zk-credits/witnesses or ~/Downloads, set ZK_CREDITS_WITNESS_PATH, or configure BASE_RPC_URL and BASE_PRIVATE_CREDIT_BOND_ADDRESS.',
  );
}

/** Finds only known local locations and validates both sources before setup continues. */
export async function resolveSetupInputs(options: ResolveSetupInputsOptions): Promise<SetupConfig> {
  const saved = await readSetupConfig(options.configPath);
  const artifactDirectory = await resolveArtifactDirectory(options, saved);
  const witness = await resolveWitnessSource(options, saved);
  return { version: 1, artifactDirectory, witness };
}

/** Reads the operator-local setup config. Missing config is normal on first run. */
export async function readSetupConfig(path: string): Promise<SetupConfig | undefined> {
  let raw: string;
  try {
    const info = await lstat(path);
    if (!info.isFile()) throw new Error('Local setup config must be a regular file');
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    return parseSetupConfig(JSON.parse(raw) as unknown);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Local setup config is not valid JSON; remove ~/.zk-credits/config.json and run setup again.');
    }
    throw error;
  }
}

/** Atomically writes paths and witness configuration with owner-only permissions. */
export async function writeSetupConfig(path: string, config: SetupConfig): Promise<void> {
  const normalized = parseSetupConfig(config);
  const directory = dirname(resolve(path));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = resolve(path);
  try {
    const existing = await lstat(destination);
    if (existing.isSymbolicLink()) throw new Error('Local setup config cannot be a symbolic link');
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const temporary = join(directory, '.config-' + randomUUID() + '.tmp');
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(normalized, null, 2) + '\n', 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, destination);
    await chmod(destination, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Applies saved paths to a process environment while preserving explicit overrides. */
export function applySetupConfig(environment: NodeJS.ProcessEnv, config: SetupConfig): void {
  if (!environment.ZK_CREDITS_ARTIFACT_DIR?.trim()) {
    environment.ZK_CREDITS_ARTIFACT_DIR = config.artifactDirectory;
  }
  if (config.witness.kind === 'file') {
    if (!environment.ZK_CREDITS_WITNESS_PATH?.trim()) {
      environment.ZK_CREDITS_WITNESS_PATH = config.witness.path;
    }
    return;
  }
  if (!environment.BASE_RPC_URL?.trim()) environment.BASE_RPC_URL = config.witness.rpcUrl;
  if (!environment.BASE_PRIVATE_CREDIT_BOND_ADDRESS?.trim()) {
    environment.BASE_PRIVATE_CREDIT_BOND_ADDRESS = config.witness.contractAddress;
  }
  if (!environment.BASE_DEPLOYMENT_BLOCK?.trim() && config.witness.deploymentBlock !== undefined) {
    environment.BASE_DEPLOYMENT_BLOCK = config.witness.deploymentBlock;
  }
  if (!environment.BASE_CONFIRMATIONS?.trim() && config.witness.confirmations !== undefined) {
    environment.BASE_CONFIRMATIONS = config.witness.confirmations;
  }
}
