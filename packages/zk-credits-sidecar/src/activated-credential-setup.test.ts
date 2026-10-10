import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRecoveryCapsuleFile,
  generateSecret,
  verifyRecoveryCapsule,
  wrapActivatedCredential,
} from '@zk-credits/shared/base';
import { setupActivatedCredential, type ActivatedCredentialSetupOptions } from './activated-credential-setup.js';
import { parseCircuitManifest, type CircuitManifest } from './artifact-bundle.js';
import { readStoredCredential, type CredentialStore } from './credential-store.js';
import { writeRpcConfig } from './rpc-config.js';
import { readSetupConfig, writeSetupConfig, type SetupConfig } from './setup-config.js';
import { createSidecarRuntime } from './sidecar-runtime.js';

const adapters = vi.hoisted(() => ({
  manifest: vi.fn(), acquire: vi.fn(), events: vi.fn(), proof: vi.fn(),
}));
vi.mock('./artifact-bundle.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./artifact-bundle.js')>(),
  loadCircuitManifest: adapters.manifest,
}));
vi.mock('./artifact-release.js', () => ({ acquirePinnedArtifactBundle: adapters.acquire }));
vi.mock('./base-event-sync.js', () => ({ createBaseEventWitnessProvider: adapters.events }));
vi.mock('./proof-coordinator.js', () => ({ createPinnedBaseProofGenerator: adapters.proof }));

const artifactBytes = {
  'private_credit_spend.wasm': 'pinned wasm fixture',
  'private_credit_spend.zkey': 'pinned proving key fixture',
  'verification_key_private_credit.json': JSON.stringify({ protocol: 'groth16', curve: 'bn128', nPublic: 6 }),
};
const deployment = {
  chainId: 84532,
  bondAddress: '0xcc1909dD30485d6D9a46e3d33cf04C1378b586Ab',
  deploymentBlock: '47372040',
  deploymentDomain: '84532',
  circuitId: 'private-credit-depth-20',
  verifyingKeyId: 'private-credit-spend-vk-dev-sepolia-v2',
  spendVerifierAddress: '0x37663bC461AB8EccD3b7D69Bde7eeF13D489723e',
  groth16VerifierAddress: '0x5870117EA7ACb28B3f36fb64284b77c4eD2B7148',
};
const witness = {
  root: '123', pathElements: Array.from({ length: 20 }, () => '0'),
  pathIndices: Array.from({ length: 20 }, () => 0),
};

function fixtureManifest(pinnedDeployment = true): CircuitManifest {
  return parseCircuitManifest({
    version: 1, scheme: 'groth16', network: 'eip155:84532',
    circuit: {
      id: 'private-credit-depth-20', depth: 20,
      wasm: 'private_credit_spend.wasm', zkey: 'private_credit_spend.zkey',
      verificationKey: 'verification_key_private_credit.json',
    },
    artifacts: Object.entries(artifactBytes).map(([file, bytes]) => ({
      file, sha256: createHash('sha256').update(bytes).digest('hex'),
    })),
    ...(pinnedDeployment ? { deployment } : {}),
  });
}

async function installBundle(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  for (const [file, bytes] of Object.entries(artifactBytes)) await writeFile(join(directory, file), bytes);
}

describe('activated credential setup', () => {
  let directory: string;
  let environment: NodeJS.ProcessEnv;
  let store: CredentialStore;
  let savedCredential: string | undefined;
  let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
  let witnessForCredential: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetAllMocks();
    directory = await mkdtemp(join(tmpdir(), 'activated-credential-setup-'));
    const file = await createRecoveryCapsuleFile(generateSecret());
    const { commitment } = await verifyRecoveryCapsule(file);
    const activated = wrapActivatedCredential(file.capsule, {
      commitment, tierId: 0, expiry: Math.floor(Date.now() / 1000) + 3600,
      deploymentDomain: '84532', network: 'eip155:84532',
      contractAddress: deployment.bondAddress, transactionHash: 'test-activation',
    });
    const credentialPath = join(directory, 'activated.json');
    await writeFile(credentialPath, JSON.stringify(activated));
    environment = {
      BASE_RPC_URL: 'https://rpc.example/provider-key',
      ZK_CREDITS_CREDENTIAL_PATH: credentialPath,
      ZK_CREDITS_GATEWAY_URL: 'https://gateway.example',
    };
    savedCredential = undefined;
    store = {
      read: vi.fn(async () => savedCredential),
      write: vi.fn(async (value: string) => { savedCredential = value; }),
    };
    await installBundle(join(directory, 'artifacts', 'base-sepolia'));
    adapters.manifest.mockResolvedValue(fixtureManifest());
    witnessForCredential = vi.fn(async () => witness);
    adapters.events.mockReturnValue({ witnessForCredential });
    adapters.proof.mockResolvedValue(async () => { throw new Error('Setup must not spend'); });
    fetcher = vi.fn<typeof fetch>(async (input) => String(input).endsWith('/v1/root-known')
      ? Response.json({ known: true }) : Response.json({ result: '0x14a34' }));
    vi.stubGlobal('fetch', fetcher);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(directory, { recursive: true, force: true });
  });

  function setup(options: ActivatedCredentialSetupOptions = {}) {
    return setupActivatedCredential({ environment, homeDirectory: directory, stateDirectory: directory, credentialStore: store, ...options });
  }

  async function existingConfig(): Promise<SetupConfig> {
    const config: SetupConfig = {
      version: 1, artifactDirectory: join(directory, 'artifacts', 'base-sepolia'),
      witness: { kind: 'base-events', rpcUrl: 'https://legacy.example/', contractAddress: deployment.bondAddress, deploymentBlock: deployment.deploymentBlock },
    };
    await writeSetupConfig(join(directory, 'config.json'), config);
    return config;
  }

  it('imports, validates and saves configuration usable by the runtime after restart', async () => {
    const config = await setup();
    const credential = await readStoredCredential(store);
    expect(witnessForCredential).toHaveBeenCalledWith(credential);
    expect(config).toEqual({
      version: 1, artifactDirectory: join(directory, 'artifacts', 'base-sepolia'),
      witness: { kind: 'base-events', rpcUrl: environment.BASE_RPC_URL, contractAddress: deployment.bondAddress, deploymentBlock: deployment.deploymentBlock },
    });
    expect(await readSetupConfig(join(directory, 'config.json'))).toEqual(config);
    expect((await stat(join(directory, 'config.json'))).mode & 0o777).toBe(0o600);
    const configText = await readFile(join(directory, 'config.json'), 'utf8');
    expect(configText).not.toContain(credential.secret);
    expect(configText).not.toContain(credential.commitment);
    expect(environment.ZK_CREDITS_ARTIFACT_DIR).toBe(config.artifactDirectory);
    expect(environment.BASE_PRIVATE_CREDIT_BOND_ADDRESS).toBe(deployment.bondAddress);
    expect(fetcher.mock.calls[1]).toEqual([
      new URL('https://gateway.example/v1/root-known'),
      expect.objectContaining({ body: '{"root":"123"}', headers: { accept: 'application/json', 'content-type': 'application/json' } }),
    ]);

    const restarted = await createSidecarRuntime({ environment: {}, credentialStore: store, homeDirectory: directory, stateDirectory: directory });
    try {
      expect(await restarted.witnessRoot()).toBe('123');
      expect(restarted.snapshot().slots.committed).toBe(0);
    } finally { await restarted.close(); }
  });

  it.each(['environment', 'saved-rpc', 'legacy-config'] as const)('preserves %s RPC precedence in the assembled workflow', async source => {
    await existingConfig();
    if (source !== 'legacy-config') await writeRpcConfig(directory, 'https://saved.example');
    if (source !== 'environment') delete environment.BASE_RPC_URL;
    const expected = source === 'environment' ? 'https://rpc.example/provider-key'
      : source === 'saved-rpc' ? 'https://saved.example/' : 'https://legacy.example/';
    const config = await setup();
    expect(String(fetcher.mock.calls[0]![0])).toBe(expected);
    expect(config.witness).toMatchObject({ rpcUrl: expected });
    expect(environment.BASE_RPC_URL).toBe(expected);
  });

  it('rejects the wrong chain before prompting or importing the credential', async () => {
    const previous = await existingConfig();
    fetcher.mockResolvedValue(Response.json({ result: '0x1' }));
    const readLegacyPassword = vi.fn(async () => 'legacy-password');
    await expect(setup({ readLegacyPassword })).rejects.toThrow('not Base Sepolia');
    expect(readLegacyPassword).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();
    expect(adapters.manifest).not.toHaveBeenCalled();
    expect(await readSetupConfig(join(directory, 'config.json'))).toEqual(previous);
  });

  it('imports an explicit legacy export through the caller-owned hidden prompt', async () => {
    const file = await createRecoveryCapsuleFile(generateSecret(), 'legacy-password');
    const { commitment } = await verifyRecoveryCapsule(file, 'legacy-password');
    const activated = wrapActivatedCredential(file.capsule, {
      commitment, tierId: 0, expiry: Math.floor(Date.now() / 1000) + 3600,
      deploymentDomain: '84532', network: 'eip155:84532',
      contractAddress: deployment.bondAddress, transactionHash: 'legacy-activation',
    });
    await writeFile(environment.ZK_CREDITS_CREDENTIAL_PATH!, JSON.stringify(activated));
    await expect(setup()).rejects.toThrow('setup --legacy');
    const readLegacyPassword = vi.fn(async () => {
      expect(fetcher).toHaveBeenCalledTimes(2); // Both attempts checked the RPC before import.
      expect(store.write).not.toHaveBeenCalled();
      return 'legacy-password';
    });
    await setup({ readLegacyPassword });
    expect(readLegacyPassword).toHaveBeenCalledOnce();
    expect((await readStoredCredential(store)).commitment).toBe(commitment);
  });

  it.each(['artifacts', 'witness', 'gateway', 'proof'] as const)('retains the imported credential and prior config after a %s failure, then retries', async failure => {
    const previous = await existingConfig();
    if (failure === 'artifacts') await writeFile(join(previous.artifactDirectory, 'private_credit_spend.wasm'), 'corrupted');
    if (failure === 'witness') witnessForCredential.mockResolvedValue({ ...witness, pathIndices: [] });
    if (failure === 'gateway') fetcher.mockImplementation(async input => String(input).endsWith('/v1/root-known')
      ? Response.json({ known: false }) : Response.json({ result: '0x14a34' }));
    if (failure === 'proof') adapters.proof.mockRejectedValue(new Error('verification key rejected'));
    const expected = {
      artifacts: 'Could not find a valid pinned proving bundle',
      witness: 'Base membership witness is malformed',
      gateway: 'not in the gateway known-root set',
      proof: 'Pinned proving bundle check failed: verification key rejected',
    };
    await expect(setup()).rejects.toThrow(expected[failure]);
    expect(await readStoredCredential(store)).toBeDefined();
    expect(await readSetupConfig(join(directory, 'config.json'))).toEqual(previous);
    expect(environment.ZK_CREDITS_ARTIFACT_DIR).toBeUndefined();
    if (failure !== 'proof') expect(adapters.proof).not.toHaveBeenCalled();

    delete environment.ZK_CREDITS_CREDENTIAL_PATH;
    await installBundle(previous.artifactDirectory);
    witnessForCredential.mockResolvedValue(witness);
    fetcher.mockImplementation(async input => String(input).endsWith('/v1/root-known')
      ? Response.json({ known: true }) : Response.json({ result: '0x14a34' }));
    adapters.proof.mockResolvedValue(async () => { throw new Error('Setup must not spend'); });
    const config = await setup();
    expect(await readSetupConfig(join(directory, 'config.json'))).toEqual(config);
    expect(store.write).toHaveBeenCalledOnce();
  });

  it('fails without saving setup configuration when native credential storage is unavailable', async () => {
    store.write = vi.fn(async () => { throw new Error('locked'); });
    await expect(setup()).rejects.toThrow('OS credential storage is unavailable');
    expect(await readSetupConfig(join(directory, 'config.json'))).toBeUndefined();
    expect(adapters.manifest).not.toHaveBeenCalled();
  });

  it('acquires and validates the pinned release on a clean install', async () => {
    const targetDirectory = join(directory, 'artifacts', 'base-sepolia');
    await rm(targetDirectory, { recursive: true });
    const manifest = {
      ...fixtureManifest(),
      release: { repository: 'mangekyou-labs/zk-credits-base-sepolia-v2-bundle', tag: 'v2.0.0', releaseId: 1234, assetName: 'base-sepolia-v2.tar.gz', sha256: 'a'.repeat(64) },
    };
    adapters.manifest.mockResolvedValue(manifest);
    adapters.acquire.mockImplementation(async ({ targetDirectory }) => installBundle(targetDirectory));
    const config = await setup();
    expect(adapters.acquire).toHaveBeenCalledWith({ manifest, targetDirectory });
    expect(config.artifactDirectory).toBe(targetDirectory);
    expect(await readSetupConfig(join(directory, 'config.json'))).toEqual(config);
  });

  it('uses the caller selection for multiple pinned bundles while retaining legacy witness files', async () => {
    adapters.manifest.mockResolvedValue(fixtureManifest(false));
    const alternative = join(directory, 'Downloads', 'alternative-bundle');
    await installBundle(alternative);
    const witnessPath = join(directory, 'witness.json');
    await writeFile(witnessPath, JSON.stringify(witness));
    environment.ZK_CREDITS_WITNESS_PATH = witnessPath;
    const chooseCandidate = vi.fn(async (_kind, candidates: readonly string[]) => {
      expect(candidates).toContain(alternative);
      return alternative;
    });
    const config = await setup({ chooseCandidate });
    expect(chooseCandidate).toHaveBeenCalledOnce();
    expect(config).toMatchObject({ artifactDirectory: alternative, witness: { kind: 'file', path: witnessPath } });
    expect(adapters.events).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce(); // Legacy setup does not require a gateway root check.
  });
});
