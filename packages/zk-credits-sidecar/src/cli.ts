#!/usr/bin/env node

import { homedir } from 'node:os';
import { join } from 'node:path';
import { launchCodexProcess } from './codex-launcher.js';
import {
  isCodexProfileInstalled,
  resolveCodexHome,
  writeCodexProfile,
} from './codex-profile.js';
import { IdentityStore } from './identity.js';
import { createLocalProofGenerator } from './local-prover.js';
import { MembershipClient } from './membership-client.js';
import { runCliCommand } from './cli-runtime.js';
import { createNodeSidecarLifecycle } from './node-sidecar-lifecycle.js';
import { activateSidecarServer } from './server-startup.js';
import { createLoopbackToken, sidecarStatePaths } from './sidecar-config.js';
import { ensureSidecarReady } from './sidecar-lifecycle.js';
import { readLoopbackToken, writeLoopbackToken } from './sidecar-state.js';
import { createSidecarServer } from './sidecar.js';
import { TicketLedger } from './ticket-ledger.js';

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

/** Reads a recovery phrase from a TTY without terminal echo or shell history. */
async function readHiddenMnemonic(): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error('import-mnemonic requires an interactive terminal');
  }
  process.stdout.write('Enter your 24-word recovery phrase: ');
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
          done(new Error('Mnemonic import cancelled'));
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

function printHelp(): void {
  console.log(`Usage:
  zk-credits setup codex [--model <model>]
  zk-credits codex [codex arguments...]
  zk-credits status
  zk-credits import-mnemonic
  zk-credits serve [--port <port>]
  eval "$(zk-credits env)"

The Codex setup starts the loopback sidecar automatically; daily use is
"zk-credits codex". serve/env remain available for other OpenAI-compatible
clients. Set ZK_CREDITS_MNEMONIC only for a headless process; it is not
persisted by that path.`);
}

async function serve(args: readonly string[]): Promise<void> {
  const port = readPort(args);
  const statePaths = sidecarStatePaths(stateDirectory());
  const localToken = createLoopbackToken();

  const identities = new IdentityStore();
  const secretK = await identities.loadSecretK({ headlessMnemonic: process.env.ZK_CREDITS_MNEMONIC });
  const gatewayBaseUrl = process.env.ZK_CREDITS_GATEWAY_URL || DEFAULT_GATEWAY_URL;
  const proofGenerator = await createLocalProofGenerator({
    secretK,
    membershipClient: new MembershipClient(gatewayBaseUrl),
  });
  const sidecar = createSidecarServer({
    localToken,
    gatewayBaseUrl,
    compatibilityKey: process.env.ZK_CREDITS_COMPATIBILITY_KEY || 'sk-zk-local-demo',
    ledger: new TicketLedger(statePaths.ledgerPath),
    proofGenerator,
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

  const identities = new IdentityStore();
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
    importMnemonic: async (mnemonic) => { await identities.importMnemonic(mnemonic); },
    readMnemonic: readHiddenMnemonic,
    write: (line) => console.log(line),
    isIdentityConfigured: () => identities.hasIdentity(),
    configureCodex: async (model) => {
      await writeCodexProfile({ codexHome, loopbackBaseUrl: loopbackBaseUrl(), model });
    },
    ensureSidecar: () => ensureSidecarReady(lifecycle),
    isCodexProfileInstalled: () => isCodexProfileInstalled(codexHome),
    isSidecarHealthy: () => lifecycle.isHealthy(),
    launchCodex: (codexArgs) => launchCodexProcess(codexArgs),
  });
  if (exitCode !== 0) process.exitCode = exitCode;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'zk-credits failed');
  process.exitCode = 1;
});
