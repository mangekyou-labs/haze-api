/** Interactive credential preparation; runtime loading and launch remain separate. */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadCircuitManifest } from './artifact-bundle.js';
import { validateBaseCreditWitness } from './base-sidecar.js';
import {
  importCredentialPath,
  nativeCredentialStore,
  readStoredCredential,
  type CredentialStore,
} from './credential-store.js';
import { requireGatewayKnownRoot, resolveGatewayOrigin } from './gateway-root-check.js';
import { createPinnedBaseProofGenerator } from './proof-coordinator.js';
import { createBaseProofMetrics } from './proof-metrics.js';
import { applyRpcConfig, checkBaseSepoliaRpc, resolveBaseSepoliaRpc } from './rpc-config.js';
import {
  applySetupConfig,
  readSetupConfig,
  resolveSetupInputs,
  writeSetupConfig,
  type ResolveSetupInputsOptions,
  type SetupConfig,
} from './setup-config.js';
import { witnessProviderForSource } from './sidecar-runtime.js';

export interface ActivatedCredentialSetupOptions {
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  stateDirectory?: string;
  credentialStore?: CredentialStore;
  chooseCandidate?: ResolveSetupInputsOptions['chooseCandidate'];
  /** The caller owns hidden terminal input for explicit legacy import. */
  readLegacyPassword?(): Promise<string>;
}

/**
 * Imports or loads the credential and prepares validated runtime configuration.
 * Configuration is saved only after all checks pass. Credential import, artifact
 * acquisition and witness synchronization may persist progress on failure so a
 * retry can reuse it. Applies RPC and successful setup paths to the environment.
 */
export async function setupActivatedCredential(options: ActivatedCredentialSetupOptions = {}): Promise<SetupConfig> {
  const environment = options.environment ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();
  const stateDirectory = options.stateDirectory ?? (environment.ZK_CREDITS_HOME || join(homeDirectory, '.zk-credits'));
  const configPath = join(stateDirectory, 'config.json');
  const credentialStore = options.credentialStore ?? nativeCredentialStore(stateDirectory);

  await applyRpcConfig(environment, stateDirectory);
  const saved = await readSetupConfig(configPath);
  const rpc = resolveBaseSepoliaRpc(environment, saved?.witness.kind === 'base-events' ? saved.witness.rpcUrl : undefined);
  await checkBaseSepoliaRpc(rpc);
  environment.BASE_RPC_URL = rpc;

  const credentialPath = environment.ZK_CREDITS_CREDENTIAL_PATH;
  const legacyPassword = await options.readLegacyPassword?.();
  const credential = credentialPath
    ? await importCredentialPath(credentialPath, credentialStore, legacyPassword)
    : await readStoredCredential(credentialStore);
  const manifest = await loadCircuitManifest();
  const config = await resolveSetupInputs({
    environment,
    homeDirectory,
    stateDirectory,
    configPath,
    manifest,
    validateWitness: async (source) => {
      const provider = await witnessProviderForSource(source, join(stateDirectory, 'base-event-sync.json'));
      const witness = validateBaseCreditWitness(await provider.witnessForCredential(credential));
      if (manifest.deployment) await requireGatewayKnownRoot(witness.root, resolveGatewayOrigin(environment));
    },
    chooseCandidate: options.chooseCandidate,
  });
  try {
    await createPinnedBaseProofGenerator({
      artifactDirectory: config.artifactDirectory,
      metrics: createBaseProofMetrics(),
    });
  } catch (error) {
    if (error instanceof Error) throw new Error(`Pinned proving bundle check failed: ${error.message}`);
    throw new Error('Pinned proving bundle check failed. Reinstall the bundle from your pilot invite.');
  }
  await writeSetupConfig(configPath, config);
  applySetupConfig(environment, config);
  return config;
}
