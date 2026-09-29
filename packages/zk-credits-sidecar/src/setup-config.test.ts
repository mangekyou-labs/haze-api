import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCircuitManifest } from './artifact-bundle.js';
import {
  applySetupConfig,
  readSetupConfig,
  resolveSetupInputs,
  writeSetupConfig,
  type SetupWitnessSource,
} from './setup-config.js';

const artifactBytes = {
  'private_credit_spend.wasm': 'pinned wasm fixture',
  'private_credit_spend.zkey': 'pinned proving key fixture',
  'verification_key_private_credit.json': JSON.stringify({
    protocol: 'groth16',
    curve: 'bn128',
    nPublic: 6,
  }),
};

const V2_DEPLOYMENT = {
  chainId: 84532,
  bondAddress: '0xcc1909dD30485d6D9a46e3d33cf04C1378b586Ab',
  deploymentBlock: '47372040',
  deploymentDomain: '84532',
  circuitId: 'private-credit-depth-20',
  verifyingKeyId: 'private-credit-spend-vk-dev-sepolia-v2',
  spendVerifierAddress: '0x37663bC461AB8EccD3b7D69Bde7eeF13D489723e',
  groth16VerifierAddress: '0x5870117EA7ACb28B3f36fb64284b77c4eD2B7148',
};

function fixtureManifest(deployment?: typeof V2_DEPLOYMENT) {
  const artifacts = Object.entries(artifactBytes).map(([file, bytes]) => ({
    file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }));
  return parseCircuitManifest({
    version: 1,
    scheme: 'groth16',
    network: deployment ? 'eip155:84532' : 'base-sepolia',
    circuit: {
      id: 'private-credit-depth-20',
      depth: 20,
      wasm: 'private_credit_spend.wasm',
      zkey: 'private_credit_spend.zkey',
      verificationKey: 'verification_key_private_credit.json',
    },
    artifacts,
    ...(deployment ? { deployment } : {}),
  });
}

async function installFixtureBundle(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  for (const [file, bytes] of Object.entries(artifactBytes)) {
    await writeFile(join(directory, file), bytes);
  }
}

describe('local setup input discovery', () => {
  it('acquires the hash-pinned private release into local state on a clean install', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zk-credits-clean-setup-'));
    const homeDirectory = join(root, 'home');
    const stateDirectory = join(homeDirectory, '.zk-credits');
    const target = join(stateDirectory, 'artifacts', 'base-sepolia');
    const witnessPath = join(stateDirectory, 'witnesses', 'base-tree.json');
    await mkdir(join(stateDirectory, 'witnesses'), { recursive: true });
    await writeFile(witnessPath, JSON.stringify({ leaves: [] }));
    let acquiredAt = '';

    const manifest = parseCircuitManifest({
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
      artifacts: Object.entries(artifactBytes).map(([file, bytes]) => ({
        file,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })),
      release: {
        repository: 'mangekyou-labs/zk-credits-base-sepolia-v2-bundle',
        tag: 'v2.0.0',
        releaseId: 1234,
        assetName: 'base-sepolia-v2.tar.gz',
        sha256: 'a'.repeat(64),
      },
    });

    const config = await resolveSetupInputs({
      environment: {},
      homeDirectory,
      stateDirectory,
      configPath: join(stateDirectory, 'config.json'),
      manifest,
      acquireArtifactBundle: async (directory) => {
        acquiredAt = directory;
        await installFixtureBundle(directory);
      },
      validateWitness: async (source) => {
        expect(source).toEqual({ kind: 'file', path: resolve(witnessPath) });
      },
    });

    expect(acquiredAt).toBe(resolve(target));
    expect(config.artifactDirectory).toBe(resolve(target));
    expect(config.witness).toEqual({ kind: 'file', path: resolve(witnessPath) });
  });

  it('finds and verifies the pinned bundle and public tree in standard local folders', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zk-credits-setup-'));
    const homeDirectory = join(root, 'home');
    const stateDirectory = join(homeDirectory, '.zk-credits');
    const artifactDirectory = join(homeDirectory, 'Downloads', 'pilot-proving-bundle');
    const witnessPath = join(homeDirectory, 'Downloads', 'base-tree.json');
    await installFixtureBundle(artifactDirectory);
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(witnessPath, JSON.stringify({ leaves: [] }));
    const validated: SetupWitnessSource[] = [];

    const config = await resolveSetupInputs({
      environment: {},
      homeDirectory,
      stateDirectory,
      configPath: join(stateDirectory, 'config.json'),
      manifest: fixtureManifest(),
      validateWitness: async (source) => {
        validated.push(source);
      },
    });

    expect(config.artifactDirectory).toBe(resolve(artifactDirectory));
    expect(config.witness).toEqual({ kind: 'file', path: resolve(witnessPath) });
    expect(validated).toEqual([config.witness]);
  });

  it('keeps the saved runtime configuration local and owner-readable only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zk-credits-config-'));
    const path = join(root, '.zk-credits', 'config.json');
    const config = {
      version: 1 as const,
      artifactDirectory: '/local/pinned-bundle',
      witness: {
        kind: 'base-events' as const,
        rpcUrl: 'https://rpc.example/key',
        contractAddress: '0x0000000000000000000000000000000000000001',
      },
    };

    await writeSetupConfig(path, config);

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(config);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const loaded = await readSetupConfig(path);
    expect(loaded).toEqual(config);
    const environment: NodeJS.ProcessEnv = { ZK_CREDITS_ARTIFACT_DIR: '/explicit/bundle' };
    applySetupConfig(environment, loaded!);
    expect(environment).toMatchObject({
      ZK_CREDITS_ARTIFACT_DIR: '/explicit/bundle',
      BASE_RPC_URL: 'https://rpc.example/key',
      BASE_PRIVATE_CREDIT_BOND_ADDRESS: '0x0000000000000000000000000000000000000001',
    });
  });

  it('derives the witness from configured Base events when no witness path is set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zk-credits-event-setup-'));
    const homeDirectory = join(root, 'home');
    const stateDirectory = join(homeDirectory, '.zk-credits');
    const artifactDirectory = join(stateDirectory, 'artifacts', 'base-sepolia');
    await installFixtureBundle(artifactDirectory);
    await mkdir(stateDirectory, { recursive: true });
    let validatedSource: SetupWitnessSource | undefined;

    const config = await resolveSetupInputs({
      environment: {
        BASE_RPC_URL: 'https://base-sepolia.example/key',
        BASE_PRIVATE_CREDIT_BOND_ADDRESS: '0x0000000000000000000000000000000000000001',
        BASE_DEPLOYMENT_BLOCK: '123',
      },
      homeDirectory,
      stateDirectory,
      configPath: join(stateDirectory, 'config.json'),
      manifest: fixtureManifest(),
      validateWitness: async (source) => {
        validatedSource = source;
      },
    });

    expect(config.witness).toEqual({
      kind: 'base-events',
      rpcUrl: 'https://base-sepolia.example/key',
      contractAddress: '0x0000000000000000000000000000000000000001',
      deploymentBlock: '123',
    });
    expect(validatedSource).toEqual(config.witness);
  });

  it('uses the manifest-pinned V2 bond and deployment block for Base event sync', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zk-credits-v2-event-setup-'));
    const homeDirectory = join(root, 'home');
    const stateDirectory = join(homeDirectory, '.zk-credits');
    await installFixtureBundle(join(stateDirectory, 'artifacts', 'base-sepolia'));
    let validatedSource: SetupWitnessSource | undefined;

    const config = await resolveSetupInputs({
      environment: { BASE_RPC_URL: 'https://base-sepolia.example/key' },
      homeDirectory,
      stateDirectory,
      configPath: join(stateDirectory, 'config.json'),
      manifest: fixtureManifest(V2_DEPLOYMENT),
      validateWitness: async (source) => { validatedSource = source; },
    });

    const expected = {
      kind: 'base-events',
      rpcUrl: 'https://base-sepolia.example/key',
      contractAddress: V2_DEPLOYMENT.bondAddress,
      deploymentBlock: V2_DEPLOYMENT.deploymentBlock,
    };
    expect(config.witness).toEqual(expected);
    expect(validatedSource).toEqual(expected);
  });

  it('fails before witness sync when environment bond or block conflicts with V2 pins', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zk-credits-v2-pin-mismatch-'));
    const homeDirectory = join(root, 'home');
    const stateDirectory = join(homeDirectory, '.zk-credits');
    await installFixtureBundle(join(stateDirectory, 'artifacts', 'base-sepolia'));
    let witnessValidationStarted = false;

    await expect(resolveSetupInputs({
      environment: {
        BASE_RPC_URL: 'https://base-sepolia.example/key',
        BASE_PRIVATE_CREDIT_BOND_ADDRESS: '0x0000000000000000000000000000000000000001',
        BASE_DEPLOYMENT_BLOCK: '47372039',
      },
      homeDirectory,
      stateDirectory,
      configPath: join(stateDirectory, 'config.json'),
      manifest: fixtureManifest(V2_DEPLOYMENT),
      validateWitness: async () => { witnessValidationStarted = true; },
    })).rejects.toThrow('does not match the pinned Base Sepolia V2 bond');

    expect(witnessValidationStarted).toBe(false);
  });

  it('does not fall back to discovery when an explicit proving bundle is invalid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zk-credits-explicit-bundle-'));
    const homeDirectory = join(root, 'home');
    const stateDirectory = join(homeDirectory, '.zk-credits');
    await installFixtureBundle(join(homeDirectory, 'Downloads', 'valid-bundle'));

    await expect(resolveSetupInputs({
      environment: { ZK_CREDITS_ARTIFACT_DIR: '/missing/explicit-bundle' },
      homeDirectory,
      stateDirectory,
      configPath: join(stateDirectory, 'config.json'),
      manifest: fixtureManifest(),
      validateWitness: async () => undefined,
    })).rejects.toThrow('configured proving bundle');
  });

  it('does not fall back to a discovered witness or event sync when an explicit witness is invalid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zk-credits-explicit-witness-'));
    const homeDirectory = join(root, 'home');
    const stateDirectory = join(homeDirectory, '.zk-credits');
    const artifactDirectory = join(stateDirectory, 'artifacts', 'base-sepolia');
    await installFixtureBundle(artifactDirectory);
    await mkdir(join(homeDirectory, 'Downloads'), { recursive: true });
    await writeFile(join(homeDirectory, 'Downloads', 'base-tree.json'), JSON.stringify({ leaves: [] }));
    const attempted: SetupWitnessSource[] = [];

    await expect(resolveSetupInputs({
      environment: {
        ZK_CREDITS_WITNESS_PATH: '/missing/explicit-witness.json',
        BASE_RPC_URL: 'https://base-sepolia.example/key',
        BASE_PRIVATE_CREDIT_BOND_ADDRESS: '0x0000000000000000000000000000000000000001',
      },
      homeDirectory,
      stateDirectory,
      configPath: join(stateDirectory, 'config.json'),
      manifest: fixtureManifest(),
      validateWitness: async (source) => {
        attempted.push(source);
        throw new Error('does not resolve the activated credential');
      },
    })).rejects.toThrow('configured Base witness');

    expect(attempted).toEqual([{
      kind: 'file',
      path: '/missing/explicit-witness.json',
    }]);
  });
});
