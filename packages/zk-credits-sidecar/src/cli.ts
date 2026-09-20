#!/usr/bin/env node

import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchCodexProcess } from './codex-launcher.js';
import { launchClineProcess } from './cline-launcher.js';
import {
  isCodexProfileInstalled,
  resolveCodexHome,
  writeCodexProfile,
} from './codex-profile.js';
import { createBasePrepaidClient, createFileWitnessProvider } from './base-sidecar.js';
import { createBaseEventWitnessProvider } from './base-event-sync.js';
import { createPinnedBaseProofGenerator } from './proof-coordinator.js';
import { createBaseProofMetrics } from './proof-metrics.js';
import { BaseSlotLedger } from './slot-ledger.js';
import { decryptAnyCredentialExport, type CreditCredential } from '@zk-credits/shared/base';
import { runCliCommand } from './cli-runtime.js';
import { createNodeSidecarLifecycle } from './node-sidecar-lifecycle.js';
import { activateSidecarServer } from './server-startup.js';
import { createLoopbackToken, sidecarStatePaths } from './sidecar-config.js';
import { ensureSidecarReady } from './sidecar-lifecycle.js';
import { readLoopbackToken, writeLoopbackToken } from './sidecar-state.js';
import { createSidecarServer } from './sidecar.js';

const DEFAULT_GATEWAY_URL = 'https://zk-credits-gateway.onrender.com';
const DEFAULT_PORT = 3210;

function stateDirectory(): string {
  return process.env.ZK_CREDITS_HOME || join(homedir(), '.zk-credits');
}

function loopbackBaseUrl(): string {
  const port = Number(process.env.ZK_CREDITS_SIDECAR_PORT || DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('ZK_CREDITS_SIDECAR_PORT must be a port between 1 and 65535');
  }
  return `http://127.0.0.1:${port}`;
}

function readPort(args: readonly string[]): number {
  const portIndex = args.indexOf('--port');
  if (portIndex === -1) return Number(new URL(loopbackBaseUrl()).port);
  const parsed = Number(args[portIndex + 1]);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error('--port must be a port between 1 and 65535');
  }
  return parsed;
}

/** Reads a credential backup password from a TTY without terminal echo or shell history. */
async function readHiddenValue(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error('credential backup requires an interactive terminal');
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let value = '';
    const done = (error?: Error): void => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value.trim());
    };
    const onData = (chunk: Buffer): void => {
      for (const byte of chunk) {
        if (byte === 3) {
          done(new Error('Input cancelled'));
          return;
        }
        if (byte === 13 || byte === 10) {
          done();
          return;
        }
        if (byte === 127 || byte === 8) {
          value = value.slice(0, -1);
          continue;
        }
        value += String.fromCharCode(byte);
      }
    };
    process.stdin.on('data', onData);
  });
}

/**
 * Reads a local credential export. Version-2 activated credentials and legacy
 * version-1 exports are both accepted; decryption stays in local memory.
 */
async function readEncryptedCredential(path: string, password: string): Promise<CreditCredential> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as { format?: unknown; version?: unknown };
  if (parsed.format !== 'zk-credits-credential' || (parsed.version !== 1 && parsed.version !== 2)) {
    throw new Error('Credential file is not a supported zk-credits export');
  }
  return decryptAnyCredentialExport(parsed, password);
}

function printHelp(): void {
  console.log(`Usage:
  zk-credits cline [cline arguments...]
  zk-credits setup codex [--model <model>]
  zk-credits codex [codex arguments...]
  zk-credits status
  zk-credits serve [--port <port>]
  eval "$(zk-credits env)"

"zk-credits cline" and the Codex companion configure and launch coding agents
against the x402 zk-prepaid loopback sidecar. The pilot serves non-streaming
POST /v1/chat/completions only.
Set ZK_CREDITS_CREDENTIAL_PATH, ZK_CREDITS_CREDENTIAL_PASSWORD, and
ZK_CREDITS_ARTIFACT_DIR for a headless process. The encrypted export is
decrypted only in local memory.`);
}
async function serve(args: readonly string[]): Promise<void> {
  const port = readPort(args);
  const statePaths = sidecarStatePaths(stateDirectory());
  const localToken = createLoopbackToken();
  const credentialPath = process.env.ZK_CREDITS_CREDENTIAL_PATH;
  if (!credentialPath) throw new Error('Set ZK_CREDITS_CREDENTIAL_PATH to the encrypted browser export');
  const password = process.env.ZK_CREDITS_CREDENTIAL_PASSWORD ?? await readHiddenValue('Credential backup password: ');
  const credential = await readEncryptedCredential(credentialPath, password);
  const witnessPath = process.env.ZK_CREDITS_WITNESS_PATH;
  const artifactDirectory = process.env.ZK_CREDITS_ARTIFACT_DIR;
  if (!artifactDirectory) {
    throw new Error('Set ZK_CREDITS_ARTIFACT_DIR to the directory holding the installed pinned proving bundle');
  }
  const witness = witnessPath
    ? createFileWitnessProvider(JSON.parse(await readFile(witnessPath, 'utf8')))
    : process.env.BASE_RPC_URL && process.env.BASE_PRIVATE_CREDIT_BOND_ADDRESS
      ? createBaseEventWitnessProvider({
          rpcUrl: process.env.BASE_RPC_URL,
          contractAddress: process.env.BASE_PRIVATE_CREDIT_BOND_ADDRESS,
          deploymentBlock: process.env.BASE_DEPLOYMENT_BLOCK && /^\d+$/u.test(process.env.BASE_DEPLOYMENT_BLOCK) ? BigInt(process.env.BASE_DEPLOYMENT_BLOCK) : undefined,
          confirmations: process.env.BASE_CONFIRMATIONS && /^\d+$/u.test(process.env.BASE_CONFIRMATIONS) ? BigInt(process.env.BASE_CONFIRMATIONS) : undefined,
          cachePath: join(stateDirectory(), 'base-event-sync.json'),
        })
      : (() => { throw new Error('Set ZK_CREDITS_WITNESS_PATH or configure BASE_RPC_URL and BASE_PRIVATE_CREDIT_BOND_ADDRESS'); })();
  const metrics = createBaseProofMetrics();
  const slotLedger = await BaseSlotLedger.open({ path: join(stateDirectory(), 'base-slots.json') });
  const prove = await createPinnedBaseProofGenerator({ artifactDirectory, metrics });
  const prepaid = createBasePrepaidClient({
    credential,
    witnessProvider: witness,
    prove,
    slotLedger,
  });
  const gatewayBaseUrl = process.env.ZK_CREDITS_GATEWAY_URL || 'http://127.0.0.1:3001';
  const sidecar = createSidecarServer({
    localToken,
    gatewayBaseUrl,
    prepaidClient: prepaid.client,
    metrics: () => metrics.snapshot(),
  });
  let address: string;
  try {
    address = await activateSidecarServer({
      listen: () => sidecar.listen(port),
      publishToken: () => writeLoopbackToken(statePaths.tokenPath, localToken),
    });
  } catch (error: unknown) {
    await sidecar.close();
    throw error;
  }
  console.log(`ZK Credits sidecar listening on ${address}/v1`);
  console.log('Run eval "$(zk-credits env)" in the client shell.');

  const shutdown = async (): Promise<void> => {
    await sidecar.close();
    process.exit(0);
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === '--help' || args[0] === '-h' || !args[0]) {
    printHelp();
    return;
  }
  if (args[0] === 'serve') {
    await serve(args.slice(1));
    return;
  }

  const sidecarHome = stateDirectory();
  const statePaths = sidecarStatePaths(sidecarHome);
  const codexHome = resolveCodexHome(process.env, homedir());
  const cliEntryPath = process.argv[1];
  if (!cliEntryPath) throw new Error('Unable to resolve the zk-credits executable path');
  const lifecycle = createNodeSidecarLifecycle({
    loopbackBaseUrl: loopbackBaseUrl(),
    stateDirectory: sidecarHome,
    tokenPath: statePaths.tokenPath,
    logPath: statePaths.logPath,
    cliEntryPath,
  });
  const exitCode = await runCliCommand(args, {
    loopbackBaseUrl: loopbackBaseUrl(),
    readToken: () => readLoopbackToken(statePaths.tokenPath),
    write: (line) => console.log(line),
    isCredentialConfigured: async () => {
      const path = process.env.ZK_CREDITS_CREDENTIAL_PATH;
      if (!path) return false;
      try {
        await readFile(path);
        return true;
      } catch {
        return false;
      }
    },
    configureCodex: async (model) => {
      await writeCodexProfile({ codexHome, loopbackBaseUrl: loopbackBaseUrl(), model });
    },
    ensureSidecar: () => ensureSidecarReady(lifecycle),
    isCodexProfileInstalled: () => isCodexProfileInstalled(codexHome),
    isSidecarHealthy: () => lifecycle.isHealthy(),
    launchCodex: (codexArgs) => launchCodexProcess(codexArgs),
    launchCline: (clineArgs, localToken) => launchClineProcess({
      args: clineArgs,
      loopbackBaseUrl: loopbackBaseUrl(),
      localToken,
      stateDirectory: sidecarHome,
    }),
  });
  if (exitCode !== 0) process.exitCode = exitCode;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'zk-credits failed');
  process.exitCode = 1;
});
