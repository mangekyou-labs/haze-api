/**
 * Shared operator-local proof runtime. Launch and listening remain caller-owned.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { acquireCredentialRuntimeLease, type CredentialRuntimeLease } from './runtime-owner.js';
import type { CreditCredential } from '@zk-credits/shared/base';
import type { BaseAuthorizationBridge } from './base-sidecar.js';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BASE_SEPOLIA_NETWORK, createZkPrepaidLifecycleMetrics } from '@zk-credits/x402-zk-prepaid';
import { nativeCredentialStore, readStoredCredential, type CredentialStore } from './credential-store.js';
import { applyRpcConfig, resolveBaseSepoliaRpc } from './rpc-config.js';
import { applySetupConfig, readSetupConfig, type SetupWitnessSource } from './setup-config.js';
import { createBaseEventWitnessProvider } from './base-event-sync.js';
import { createBasePrepaidClient, createFileWitnessProvider, validateBaseCreditWitness, type BaseWitnessProvider } from './base-sidecar.js';
import { createPinnedBaseProofGenerator } from './proof-coordinator.js';
import { createBaseProofMetrics } from './proof-metrics.js';
import { BaseSlotLedger, type BaseSlotLedgerSnapshot } from './slot-ledger.js';
import { runBaseRegisteredTrialExchange, type BaseRegisteredTrialOptions, type BaseRegisteredTrialResult } from './base-registered-trial.js';
import type { SidecarMetricsSnapshot } from './sidecar.js';

export interface SidecarRuntimeOptions {
  credentialStore?: CredentialStore;
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  stateDirectory?: string;
  internalTrialOneProof?: boolean;
  authorization?: BaseAuthorizationBridge;
  prepared?: { credential: CreditCredential; lease: CredentialRuntimeLease };
}

export interface SidecarRuntimeSnapshot {
  readonly tierId: number;
  readonly slots: Readonly<BaseSlotLedgerSnapshot>;
  readonly metrics: Readonly<SidecarMetricsSnapshot>;
}

type FounderTrialRequest = Pick<BaseRegisteredTrialOptions, 'url' | 'body' | 'headers' | 'fetch' | 'onResponse'>;

export interface SidecarRuntime {
  readonly client: ReturnType<typeof createBasePrepaidClient>['client'];
  snapshot(): SidecarRuntimeSnapshot;
  close(): Promise<void>;
  witnessRoot(): Promise<string>;
  runFounderTrial(request: FounderTrialRequest): Promise<BaseRegisteredTrialResult>;
}

/** Lets the founder caller retain its credential_gate evidence phase. */
export class RuntimeCredentialError extends Error {}

/** Shared witness construction for interactive setup and runtime loading. */
export async function witnessProviderForSource(source: SetupWitnessSource, cachePath: string): Promise<BaseWitnessProvider> {
  if (source.kind === 'file') {
    let value: unknown;
    try { value = JSON.parse(await readFile(source.path, 'utf8')); }
    catch { throw new Error('The Base witness file could not be read as JSON'); }
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

/** Loads prepared state without importing credentials, acquiring artifacts or listening. */
export async function createSidecarRuntime(options: SidecarRuntimeOptions = {}): Promise<SidecarRuntime> {
  const environment = options.environment ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();
  const stateDirectory = options.stateDirectory ?? (environment.ZK_CREDITS_HOME || join(homeDirectory, '.zk-credits'));
  await applyRpcConfig(environment, stateDirectory);
  const savedConfig = await readSetupConfig(join(stateDirectory, 'config.json'));
  if (savedConfig) applySetupConfig(environment, savedConfig);

  const credential = options.prepared?.credential ?? await readStoredCredential(options.credentialStore ?? nativeCredentialStore(stateDirectory));
  if (credential.deploymentDomain !== '84532' || credential.expiry <= Math.floor(Date.now() / 1000)) {
    throw new RuntimeCredentialError(`Credential is not active for ${BASE_SEPOLIA_NETWORK}`);
  }
  const lease = options.prepared?.lease ?? await acquireCredentialRuntimeLease({ credential, stateDirectory, homeDirectory });
  try {
    const artifactDirectory = environment.ZK_CREDITS_ARTIFACT_DIR;
    if (!artifactDirectory) throw new Error('Proving bundle is not configured. Run zk-credits setup first to install and verify the pinned proving bundle. Run zk-credits doctor to inspect setup.');

    const witnessPath = environment.ZK_CREDITS_WITNESS_PATH;
    let source: SetupWitnessSource;
    if (witnessPath) source = { kind: 'file', path: witnessPath };
    else {
      const rpcUrl = resolveBaseSepoliaRpc(environment);
      const contractAddress = environment.BASE_PRIVATE_CREDIT_BOND_ADDRESS;
      if (!contractAddress) throw new Error('Set ZK_CREDITS_WITNESS_PATH or configure BASE_RPC_URL and BASE_PRIVATE_CREDIT_BOND_ADDRESS');
      source = {
        kind: 'base-events', rpcUrl, contractAddress,
        ...(environment.BASE_DEPLOYMENT_BLOCK && /^\d+$/u.test(environment.BASE_DEPLOYMENT_BLOCK)
          ? { deploymentBlock: environment.BASE_DEPLOYMENT_BLOCK } : {}),
        ...(environment.BASE_CONFIRMATIONS && /^\d+$/u.test(environment.BASE_CONFIRMATIONS)
          ? { confirmations: environment.BASE_CONFIRMATIONS } : {}),
      };
    }
    const witnessProvider = await witnessProviderForSource(source, join(stateDirectory, 'base-event-sync.json'));
    const proofMetrics = createBaseProofMetrics();
    const exchangeMetrics = createZkPrepaidLifecycleMetrics();
    const slotLedger = await BaseSlotLedger.open({ path: join(stateDirectory, 'base-slots.json') });
    const prove = await createPinnedBaseProofGenerator({ artifactDirectory, metrics: proofMetrics });
    validateBaseCreditWitness(await witnessProvider.witnessForCredential(credential));
    const proofInputs = { credential, witnessProvider, prove, slotLedger, lifecycle: exchangeMetrics.observe, authorization: options.authorization };
    const prepaid = createBasePrepaidClient({ ...proofInputs, internalTrialOneProof: options.internalTrialOneProof });

    let closed = false;
    const pending = new Set<Promise<unknown>>();
    return {
      client: {
        clearRequirements: url => prepaid.client.clearRequirements(url),
        fetch(input, init) {
          if (closed) return Promise.reject(new Error('Credential runtime is closed'));
          const request = prepaid.client.fetch(input, init);
          pending.add(request);
          void request.then(() => pending.delete(request), () => pending.delete(request));
          return request;
        },
      },
      async close() { closed = true; await Promise.allSettled([...pending]); await lease.close(); },
      snapshot: () => ({
        tierId: credential.tierId,
        slots: slotLedger.snapshot(),
        metrics: { ...proofMetrics.snapshot(), exchange: exchangeMetrics.snapshot() },
      }),
      witnessRoot: async () => validateBaseCreditWitness(await witnessProvider.witnessForCredential(credential)).root,
      // Retain the direct registered adapter, independent of the reusable client's trial limit.
      runFounderTrial(request) {
        if (closed) return Promise.reject(new Error('Credential runtime is closed'));
        const trial = runBaseRegisteredTrialExchange({ ...request, ...proofInputs });
        pending.add(trial);
        void trial.then(() => pending.delete(trial), () => pending.delete(trial));
        return trial;
      },
    };
  } catch (error) { await lease.close(); throw error; }
}
