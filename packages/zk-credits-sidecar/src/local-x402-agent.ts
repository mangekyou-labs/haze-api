/**
 * Local runtime for an operator's own x402 agent.
 *
 * This loads the same OS-stored credential, pinned proving artifacts, public
 * Base witness source, proof coordinator, and local slot ledger used by the
 * loopback sidecar. The returned client binds each actual HTTP method, URL,
 * and body into its proof. A loopback-only authenticated metrics endpoint
 * reports aggregate counters for the operator's evidence bundle.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readStoredCredential, nativeCredentialStore, type CredentialStore } from './credential-store.js';
import { applyRpcConfig, RPC_GUIDANCE } from './rpc-config.js';
import {
  BASE_SEPOLIA_NETWORK,
  createZkPrepaidLifecycleMetrics,
} from '@zk-credits/x402-zk-prepaid';
import {
  createBasePrepaidClient,
  createFileWitnessProvider,
  validateBaseCreditWitness,
  type BaseWitnessProvider,
} from './base-sidecar.js';
import { createBaseEventWitnessProvider } from './base-event-sync.js';
import { createPinnedBaseProofGenerator } from './proof-coordinator.js';
import { createBaseProofMetrics } from './proof-metrics.js';
import { BaseSlotLedger } from './slot-ledger.js';
import { readSetupConfig, applySetupConfig, type SetupWitnessSource } from './setup-config.js';
import { loadCircuitManifest } from './artifact-bundle.js';
import { createSidecarServer, type RunningSidecar, type SidecarMetricsSnapshot } from './sidecar.js';
import { createLoopbackToken, sidecarStatePaths } from './sidecar-config.js';
import { writeLoopbackToken } from './sidecar-state.js';

const DEFAULT_GATEWAY_URL = 'https://zk-credits-gateway.onrender.com';
const DEFAULT_PORT = 3210;

export interface LocalX402AgentOptions {
  /** OS storage boundary; defaults to the platform credential store. */
  credentialStore?: CredentialStore;
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  stateDirectory?: string;
  port?: number;
}

export interface LocalX402Agent {
  /** Request-aware client backed by local proving and the x402 adapter. */
  client: ReturnType<typeof createBasePrepaidClient>['client'];
  /** Local authenticated endpoint used only for aggregate activation metrics. */
  metricsUrl: string;
  close(): Promise<void>;
}

async function witnessProviderForSource(source: SetupWitnessSource, cachePath: string): Promise<BaseWitnessProvider> {
  if (source.kind === 'file') {
    const value = JSON.parse(await readFile(source.path, 'utf8')) as unknown;
    return createFileWitnessProvider(value);
  }
  return createBaseEventWitnessProvider({
    rpcUrl: source.rpcUrl,
    contractAddress: source.contractAddress,
    deploymentBlock: source.deploymentBlock === undefined ? undefined : BigInt(source.deploymentBlock),
    confirmations: source.confirmations === undefined ? undefined : BigInt(source.confirmations),
    cachePath,
  });
}

/**
 * Starts the local proof engine for a participant's own agent integration.
 * Call `client.fetch(url, init)` for each real request, then close the runtime
 * when the agent exits. The local server serves only loopback and requires its
 * owner-only token for the aggregate `/metrics` response.
 */
export async function createLocalX402Agent(options: LocalX402AgentOptions = {}): Promise<LocalX402Agent> {
  const environment = options.environment ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();
  const stateDirectory = options.stateDirectory ?? environment.ZK_CREDITS_HOME ?? join(homeDirectory, '.zk-credits');

  await applyRpcConfig(environment, stateDirectory);
  const savedConfig = await readSetupConfig(join(stateDirectory, 'config.json'));
  if (savedConfig) applySetupConfig(environment, savedConfig);
  const credential = await readStoredCredential(options.credentialStore ?? nativeCredentialStore(stateDirectory));
  const artifactDirectory = environment.ZK_CREDITS_ARTIFACT_DIR;
  if (!artifactDirectory) throw new Error('Run `zk-credits setup codex` first to install and verify the pinned proving bundle');

  const witnessPath = environment.ZK_CREDITS_WITNESS_PATH;
  const rpcUrl = environment.BASE_RPC_URL;
  if (!rpcUrl?.trim()) throw new Error(RPC_GUIDANCE);
  const contractAddress = environment.BASE_PRIVATE_CREDIT_BOND_ADDRESS;
  const witnessProvider = witnessPath
    ? await witnessProviderForSource({ kind: 'file', path: witnessPath }, join(stateDirectory, 'base-event-sync.json'))
    : rpcUrl && contractAddress
      ? await witnessProviderForSource({
        kind: 'base-events',
        rpcUrl,
        contractAddress,
        ...(environment.BASE_DEPLOYMENT_BLOCK && /^\d+$/u.test(environment.BASE_DEPLOYMENT_BLOCK)
          ? { deploymentBlock: environment.BASE_DEPLOYMENT_BLOCK }
          : {}),
        ...(environment.BASE_CONFIRMATIONS && /^\d+$/u.test(environment.BASE_CONFIRMATIONS)
          ? { confirmations: environment.BASE_CONFIRMATIONS }
          : {}),
      }, join(stateDirectory, 'base-event-sync.json'))
      : (() => { throw new Error('Local setup is missing its Base witness source; rerun `zk-credits setup codex`'); })();

  const proofMetrics = createBaseProofMetrics();
  const exchangeMetrics = createZkPrepaidLifecycleMetrics();
  const slotLedger = await BaseSlotLedger.open({ path: join(stateDirectory, 'base-slots.json') });
  const prove = await createPinnedBaseProofGenerator({ artifactDirectory, metrics: proofMetrics });
  validateBaseCreditWitness(await witnessProvider.witnessForCredential(credential));
  if (credential.deploymentDomain !== '84532' || credential.expiry <= Math.floor(Date.now() / 1000)) {
    throw new Error(`Credential is not active for ${BASE_SEPOLIA_NETWORK}`);
  }

  const prepaid = createBasePrepaidClient({
    credential,
    witnessProvider,
    prove,
    slotLedger,
    lifecycle: exchangeMetrics.observe,
  });
  const localToken = createLoopbackToken();
  const paths = sidecarStatePaths(stateDirectory);
  const metrics: () => SidecarMetricsSnapshot = () => ({
    ...proofMetrics.snapshot(),
    exchange: exchangeMetrics.snapshot(),
  });
  const server = createSidecarServer({
    localToken,
    gatewayBaseUrl: environment.ZK_CREDITS_GATEWAY_URL || DEFAULT_GATEWAY_URL,
    prepaidClient: prepaid.client,
    metrics,
  });
  let baseUrl: string;
  try {
    const port = options.port ?? Number(environment.ZK_CREDITS_SIDECAR_PORT || DEFAULT_PORT);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Local metrics port is invalid');
    baseUrl = await server.listen(port);
    await writeLoopbackToken(paths.tokenPath, localToken);
  } catch (error) {
    await server.close();
    throw error;
  }
  return {
    client: prepaid.client,
    metricsUrl: `${baseUrl}/metrics`,
    close: async () => server.close(),
  };
}
