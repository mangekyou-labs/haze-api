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

import { acquireCredentialRuntimeLease, type CredentialRuntimeLease } from './runtime-owner.js';
import { nativeCredentialStore, readStoredCredential } from './credential-store.js';
import type { BaseAuthorizationBridge } from './base-sidecar.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CredentialStore } from './credential-store.js';
import type { createBasePrepaidClient } from './base-sidecar.js';
import { createSidecarRuntime } from './sidecar-runtime.js';
import { createSidecarServer } from './sidecar.js';
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
  authorization?: BaseAuthorizationBridge;
}

export interface LocalX402Agent {
  /** Request-aware client backed by local proving and the x402 adapter. */
  client: ReturnType<typeof createBasePrepaidClient>['client'];
  /** Local authenticated endpoint used only for aggregate activation metrics. */
  metricsUrl: string;
  close(): Promise<void>;
}

/**
 * Starts the local proof engine for a participant's own agent integration.
 * Call `client.fetch(url, init)` for each real request, then close the runtime
 * when the agent exits. The local server serves only loopback and requires its
 * owner-only token for the aggregate `/metrics` response.
 */
export async function createLocalX402Agent(options: LocalX402AgentOptions = {}): Promise<LocalX402Agent> {
  const prepared = await prepareLocalX402Agent(options);
  return prepared.open(options.authorization);
}

export async function prepareLocalX402Agent(options: LocalX402AgentOptions = {}): Promise<{
  lease: CredentialRuntimeLease;
  credentialExpiry: number;
  open(authorization?: BaseAuthorizationBridge): Promise<LocalX402Agent>;
}> {
  const environment = options.environment ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();
  const stateDirectory = options.stateDirectory ?? environment.ZK_CREDITS_HOME ?? join(homeDirectory, '.zk-credits');

  const credential = await readStoredCredential(options.credentialStore ?? nativeCredentialStore(stateDirectory));
  const lease = await acquireCredentialRuntimeLease({ credential, stateDirectory, homeDirectory });
  let opened = false, released = false;
  const ownership = { stateDirectory: lease.stateDirectory, async close() { released = true; await lease.close(); } };
  return {
    lease: ownership,
    credentialExpiry: credential.expiry,
    async open(authorization) {
      if (opened || released) throw new Error('Prepared credential runtime is already opened or released');
      opened = true;
      try {
        const runtime = await createSidecarRuntime({ ...options, environment, homeDirectory, stateDirectory, authorization, prepared: { credential, lease } });
        const localToken = createLoopbackToken();
        const paths = sidecarStatePaths(stateDirectory);
        const server = createSidecarServer({
          localToken,
          gatewayBaseUrl: environment.ZK_CREDITS_GATEWAY_URL || DEFAULT_GATEWAY_URL,
          prepaidClient: runtime.client,
          metrics: () => runtime.snapshot().metrics,
        });
        let baseUrl: string;
        try {
          const port = options.port ?? Number(environment.ZK_CREDITS_SIDECAR_PORT || DEFAULT_PORT);
          if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Local metrics port is invalid');
          baseUrl = await server.listen(port);
          await writeLoopbackToken(paths.tokenPath, localToken);
        } catch (error) {
          await server.close();
          await runtime.close();
          throw error;
        }
        return {
          client: runtime.client,
          metricsUrl: `${baseUrl}/metrics`,
          close: async () => { await server.close(); await runtime.close(); },
        };
      } catch (error) { await lease.close(); throw error; }
    },
  };
}
