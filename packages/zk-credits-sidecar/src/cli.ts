#!/usr/bin/env node

import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { launchCodexProcess } from './codex-launcher.js';
import { launchClineProcess } from './cline-launcher.js';
import {
  isCodexProfileInstalled,
  resolveCodexHome,
  writeCodexProfile,
} from './codex-profile.js';
import { createBasePrepaidClient, createFileWitnessProvider, type BaseWitnessProvider } from './base-sidecar.js';
import { createBaseEventWitnessProvider } from './base-event-sync.js';
import { createPinnedBaseProofGenerator } from './proof-coordinator.js';
import { createBaseProofMetrics } from './proof-metrics.js';
import { createZkPrepaidLifecycleMetrics } from '@zk-credits/x402-zk-prepaid';
import { BaseSlotLedger } from './slot-ledger.js';
import { decryptAnyCredentialExport, type CreditCredential } from '@zk-credits/shared/base';
import { runCliCommand } from './cli-runtime.js';
import { createNodeSidecarLifecycle } from './node-sidecar-lifecycle.js';
import { activateSidecarServer } from './server-startup.js';
import { createLoopbackToken, sidecarStatePaths } from './sidecar-config.js';
import { ensureSidecarReady } from './sidecar-lifecycle.js';
import { readLoopbackToken, writeLoopbackToken } from './sidecar-state.js';
import { createSidecarServer } from './sidecar.js';
import { runBaseRegisteredTrialExchange } from './base-registered-trial.js';
import { BASE_SEPOLIA_NETWORK } from '@zk-credits/x402-zk-prepaid';

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
  zk-credits trial-registered-adapter
  eval "$(zk-credits env)"

"zk-credits cline" and the Codex companion configure and launch coding agents
against the x402 zk-prepaid loopback sidecar. The pilot serves non-streaming
POST /v1/chat/completions only.
"zk-credits trial-registered-adapter" runs one confirmed, billable internal
trial request through the directly registered official x402 client adapter.
Set ZK_CREDITS_CREDENTIAL_PATH, ZK_CREDITS_CREDENTIAL_PASSWORD, and
ZK_CREDITS_ARTIFACT_DIR for a headless process. The encrypted export is
decrypted only in local memory.`);
}

interface BaseClientRuntime {
  credential: CreditCredential;
  witnessProvider: BaseWitnessProvider;
  slotLedger: BaseSlotLedger;
  proofMetrics: ReturnType<typeof createBaseProofMetrics>;
  exchangeMetrics: ReturnType<typeof createZkPrepaidLifecycleMetrics>;
  prove: Awaited<ReturnType<typeof createPinnedBaseProofGenerator>>;
}

/** Loads the same credential, witness, proof, and durable ledger used by serve. */
async function loadBaseClientRuntime(): Promise<BaseClientRuntime> {
  const credentialPath = process.env.ZK_CREDITS_CREDENTIAL_PATH;
  if (!credentialPath) throw new Error('Set ZK_CREDITS_CREDENTIAL_PATH to the encrypted browser export');
  const password = process.env.ZK_CREDITS_CREDENTIAL_PASSWORD ?? await readHiddenValue('Credential backup password: ');
  const credential = await readEncryptedCredential(credentialPath, password);
  const witnessPath = process.env.ZK_CREDITS_WITNESS_PATH;
  const artifactDirectory = process.env.ZK_CREDITS_ARTIFACT_DIR;
  if (!artifactDirectory) {
    throw new Error('Set ZK_CREDITS_ARTIFACT_DIR to the directory holding the installed pinned proving bundle');
  }
  const witnessProvider = witnessPath
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
  const proofMetrics = createBaseProofMetrics();
  const exchangeMetrics = createZkPrepaidLifecycleMetrics();
  const slotLedger = await BaseSlotLedger.open({ path: join(stateDirectory(), 'base-slots.json') });
  const prove = await createPinnedBaseProofGenerator({ artifactDirectory, metrics: proofMetrics });
  return { credential, witnessProvider, slotLedger, proofMetrics, exchangeMetrics, prove };
}

const GATEWAY_COUNTER_NAMES = [
  'challenge_issued',
  'proof_valid',
  'proof_invalid',
  'reservation_new',
  'reservation_existing',
  'claim_committed',
  'claim_cancelled',
  'claim_replayed',
  'claim_conflict',
  'dispatch_ok',
  'dispatch_error',
  'dispatch_timeout',
  'cap_exhausted_utc_day',
  'cap_exhausted_rolling_30d',
  'paused_rejected',
  'request_rejected',
] as const;
const GATEWAY_CLAIM_COUNT_NAMES = ['reserved', 'ready', 'committed', 'cancelled'] as const;
const GATEWAY_READINESS_CHECK_NAMES = new Set(['launchControl', 'database', 'baseRoot', 'baseRpc', 'verifierAssets', 'provider']);

interface GatewayTrialSnapshot {
  metrics: Record<(typeof GATEWAY_COUNTER_NAMES)[number], number>;
  claims: Record<(typeof GATEWAY_CLAIM_COUNT_NAMES)[number], number>;
  currentRoot: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function gatewayOrigin(): URL {
  const origin = new URL(process.env.ZK_CREDITS_GATEWAY_URL || DEFAULT_GATEWAY_URL);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
    throw new Error('The internal trial requires a plain HTTPS gateway origin');
  }
  return origin;
}

async function readGatewayJson(url: URL, headers?: HeadersInit): Promise<{ status: number | null; body?: unknown }> {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    let body: unknown;
    try { body = await response.json(); } catch { body = undefined; }
    return { status: response.status, body };
  } catch {
    return { status: null };
  }
}

async function gatewayReadiness(origin: URL): Promise<{ status: number | null; passed: boolean; failedChecks: string[] }> {
  const response = await readGatewayJson(new URL('/ready', origin), { accept: 'application/json' });
  const report = isRecord(response.body) ? response.body : undefined;
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const failedChecks = checks.flatMap((check) => (
    isRecord(check) && check.ok === true
      ? []
      : [isRecord(check) && typeof check.name === 'string' && GATEWAY_READINESS_CHECK_NAMES.has(check.name) ? check.name : 'unknown']
  ));
  const hasLaunchCheck = checks.some((check) => isRecord(check) && check.name === 'launchControl' && check.ok === true);
  return {
    status: response.status,
    passed: response.status === 200 && report?.ready === true && failedChecks.length === 0 && hasLaunchCheck,
    failedChecks,
  };
}

async function gatewayTrialSnapshot(origin: URL, token: string): Promise<{ status: number | null; snapshot?: GatewayTrialSnapshot; gatePassed: boolean }> {
  const response = await readGatewayJson(new URL('/v1/admin/status', origin), {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
  });
  const body = isRecord(response.body) ? response.body : undefined;
  const launch = isRecord(body?.launchControl) ? body.launchControl : undefined;
  const base = isRecord(body?.base) ? body.base : undefined;
  const spend = isRecord(body?.spend) ? body.spend : undefined;
  const rawMetrics = isRecord(body?.metrics) ? body.metrics : undefined;
  const rawClaims = isRecord(body?.claims) ? body.claims : undefined;
  const metrics = {} as GatewayTrialSnapshot['metrics'];
  const claims = {} as GatewayTrialSnapshot['claims'];
  let countersValid = Boolean(rawMetrics && rawClaims);
  for (const name of GATEWAY_COUNTER_NAMES) {
    const count = safeCount(rawMetrics?.[name]);
    if (count === undefined) countersValid = false;
    else metrics[name] = count;
  }
  for (const name of GATEWAY_CLAIM_COUNT_NAMES) {
    const count = safeCount(rawClaims?.[name]);
    if (count !== undefined) claims[name] = count;
    else countersValid = false;
  }
  const headroom = (value: unknown): boolean => typeof value === 'string' && /^\d+$/u.test(value) && BigInt(value) > 0n;
  const currentRoot = typeof base?.currentRoot === 'string' && base.currentRoot.length > 0 ? base.currentRoot : undefined;
  const knownRoot = currentRoot !== undefined;
  const lag = typeof base?.lagBlocks === 'string' && /^\d+$/u.test(base.lagBlocks) ? BigInt(base.lagBlocks) : undefined;
  const snapshot = countersValid && currentRoot ? { metrics, claims, currentRoot } : undefined;
  return {
    status: response.status,
    ...(snapshot ? { snapshot } : {}),
    gatePassed: response.status === 200
      && body?.network === BASE_SEPOLIA_NETWORK
      && launch?.state === 'enabled'
      && knownRoot
      && safeCount(base?.knownRootCount) !== undefined
      && (safeCount(base?.knownRootCount) ?? 0) > 0
      && lag !== undefined
      && lag <= 300n
      && headroom(spend?.dailyHeadroomMicroUsd)
      && headroom(spend?.rollingHeadroomMicroUsd)
      && countersValid,
  };
}

async function confirmDirectTrial(): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('the internal trial requires a local interactive terminal');
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await input.question(
      'Confirm local recovery completed, this slot ledger was not copied to another client, one credit remains, and you approve one billable internal exchange. Type RUN ONE INTERNAL EXCHANGE: ',
    );
    return answer.trim() === 'RUN ONE INTERNAL EXCHANGE';
  } finally {
    input.close();
  }
}

function gatewayCounterDelta(before: GatewayTrialSnapshot, after: GatewayTrialSnapshot): {
  metrics: Record<(typeof GATEWAY_COUNTER_NAMES)[number], number>;
  claims: Record<(typeof GATEWAY_CLAIM_COUNT_NAMES)[number], number>;
} {
  return {
    metrics: Object.fromEntries(GATEWAY_COUNTER_NAMES.map((name) => [name, after.metrics[name] - before.metrics[name]])) as GatewayTrialSnapshot['metrics'],
    claims: Object.fromEntries(GATEWAY_CLAIM_COUNT_NAMES.map((name) => [name, after.claims[name] - before.claims[name]])) as GatewayTrialSnapshot['claims'],
  };
}

async function trialRegisteredAdapter(): Promise<void> {
  if (!await confirmDirectTrial()) {
    console.log(JSON.stringify({ path: 'registered-adapter', status: 'not_run' }));
    return;
  }
  try {
    const runtime = await loadBaseClientRuntime();
    if (
      runtime.credential.tierId !== 0
      || runtime.credential.deploymentDomain !== '84532'
      || runtime.credential.expiry <= Math.floor(Date.now() / 1000)
    ) {
      console.log(JSON.stringify({ path: 'registered-adapter', status: 'stopped', failurePhase: 'credential_gate' }));
      return;
    }
    const startingSlots = runtime.slotLedger.snapshot();
    if (startingSlots.committed >= startingSlots.capacity) {
      console.log(JSON.stringify({
        path: 'registered-adapter',
        status: 'stopped',
        failurePhase: 'local_credit_gate',
        localCredits: { capacity: startingSlots.capacity, committed: startingSlots.committed, available: 0 },
      }));
      return;
    }
    const gateway = gatewayOrigin();
    const adminToken = process.env.BILLING_INTERNAL_TOKEN || await readHiddenValue('Gateway admin token: ');
    if (!adminToken.trim()) {
      console.log(JSON.stringify({ path: 'registered-adapter', status: 'stopped', failurePhase: 'admin_auth' }));
      return;
    }
    const lifecycle = createNodeSidecarLifecycle({
      loopbackBaseUrl: loopbackBaseUrl(),
      stateDirectory: stateDirectory(),
      tokenPath: sidecarStatePaths(stateDirectory()).tokenPath,
      logPath: sidecarStatePaths(stateDirectory()).logPath,
      cliEntryPath: process.argv[1] ?? '',
    });
    const codexHome = resolveCodexHome(process.env, homedir());
    const [sidecarRunning, codexProfileInstalled] = await Promise.all([
      lifecycle.isHealthy(),
      isCodexProfileInstalled(codexHome),
    ]);
    const launcherStatus = { codexProfileInstalled, sidecarRunning };
    if (sidecarRunning) {
      console.log(JSON.stringify({ path: 'registered-adapter', status: 'stopped', failurePhase: 'sidecar_running', launcherStatus }));
      return;
    }
    const witness = await runtime.witnessProvider.witnessForCredential(runtime.credential);
    const readiness = await gatewayReadiness(gateway);
    if (!readiness.passed) {
      console.log(JSON.stringify({ path: 'registered-adapter', status: 'stopped', failurePhase: 'readiness', launcherStatus, readiness }));
      return;
    }
    const adminBefore = await gatewayTrialSnapshot(gateway, adminToken);
    if (!adminBefore.gatePassed || !adminBefore.snapshot) {
      console.log(JSON.stringify({ path: 'registered-adapter', status: 'stopped', failurePhase: 'admin_status', launcherStatus, readiness, adminStatus: adminBefore.status }));
      return;
    }
    if (witness.root !== adminBefore.snapshot.currentRoot) {
      console.log(JSON.stringify({ path: 'registered-adapter', status: 'stopped', failurePhase: 'root_mismatch', launcherStatus, readiness, adminStatus: adminBefore.status }));
      return;
    }

    const baselineSlots = runtime.slotLedger.snapshot();
    const baselineProof = runtime.proofMetrics.snapshot();
    const baselineLifecycle = runtime.exchangeMetrics.snapshot();
    const requestUrl = new URL('/v1/chat/completions', gateway).toString();
    const requestBody = JSON.stringify({
      model: 'deepseek/deepseek-v4-flash',
      messages: [{ role: 'user', content: 'Reply with exactly: internal trial complete.' }],
      stream: false,
    });
    const exchange = await runBaseRegisteredTrialExchange({
      url: requestUrl,
      body: requestBody,
      headers: { 'content-type': 'application/json' },
      credential: runtime.credential,
      witnessProvider: runtime.witnessProvider,
      prove: runtime.prove,
      slotLedger: runtime.slotLedger,
      lifecycle: runtime.exchangeMetrics.observe,
    });
    const adminAfter = await gatewayTrialSnapshot(gateway, adminToken);
    const proofAfter = runtime.proofMetrics.snapshot();
    const lifecycleAfter = runtime.exchangeMetrics.snapshot();
    const slotAfter = runtime.slotLedger.snapshot();
    const localDeltas = {
      proofAttempts: proofAfter.attempts - baselineProof.attempts,
      proofSuccesses: proofAfter.successes - baselineProof.successes,
      proofFailures: proofAfter.failures - baselineProof.failures,
      challengesReceived: lifecycleAfter.challengesReceived - baselineLifecycle.challengesReceived,
      paymentsPrepared: lifecycleAfter.paymentsPrepared - baselineLifecycle.paymentsPrepared,
      settlementsConfirmed: lifecycleAfter.settlementsConfirmed - baselineLifecycle.settlementsConfirmed,
      exchangeSuccesses: lifecycleAfter.exchangeSuccesses - baselineLifecycle.exchangeSuccesses,
      exchangeFailures: lifecycleAfter.failures - baselineLifecycle.failures,
      committedSlots: slotAfter.committed - baselineSlots.committed,
    };
    const counterDelta = adminAfter.snapshot ? gatewayCounterDelta(adminBefore.snapshot, adminAfter.snapshot) : undefined;
    const expectedGatewayCounters = ['challenge_issued', 'proof_valid', 'reservation_new', 'claim_committed', 'dispatch_ok'] as const;
    const gatewayCountersMatch = Boolean(counterDelta)
      && expectedGatewayCounters.every((name) => counterDelta!.metrics[name] === 1)
      && Object.entries(counterDelta?.metrics ?? {}).every(([name, value]) => expectedGatewayCounters.includes(name as (typeof expectedGatewayCounters)[number]) || value === 0)
      && (counterDelta?.claims.committed === 1)
      && Object.entries(counterDelta?.claims ?? {}).every(([name, value]) => name === 'committed' || value === 0);
    const failurePhase = exchange.failurePhase
      ?? (!exchange.responseSucceeded ? 'response_not_ok' : undefined)
      ?? (adminAfter.status !== 200 || !adminAfter.snapshot ? 'postflight_admin_status' : undefined)
      ?? (!gatewayCountersMatch ? 'gateway_counter_delta' : undefined);
    console.log(JSON.stringify({
      path: 'registered-adapter',
      readiness: { status: readiness.status, passed: readiness.passed, failedChecks: readiness.failedChecks },
      launcherStatus,
      adminStatus: { before: adminBefore.status, after: adminAfter.status },
      localCredits: {
        capacity: baselineSlots.capacity,
        committedBefore: baselineSlots.committed,
        committedAfter: slotAfter.committed,
        availableBefore: baselineSlots.capacity - baselineSlots.committed,
        availableAfter: slotAfter.capacity - slotAfter.committed,
      },
      exchange: {
        challengeStatus: exchange.challengeStatus,
        challengeReceived: exchange.challengeReceived,
        proofPrepared: exchange.proofPrepared,
        paymentSignatureSent: exchange.paymentSignatureSent,
        paymentStatus: exchange.paymentStatus,
        paymentResponseConfirmed: exchange.paymentResponseConfirmed,
        responseStatus: exchange.responseStatus,
        responseSucceeded: exchange.responseSucceeded,
        committedSlotDelta: exchange.committedSlotDelta,
      },
      localCounterDelta: localDeltas,
      gatewayCounterDelta: counterDelta ?? null,
      failurePhase,
    }));
  } catch {
    console.log(JSON.stringify({ path: 'registered-adapter', status: 'stopped', failurePhase: 'local_setup' }));
  }
}

async function serve(args: readonly string[]): Promise<void> {
  const port = readPort(args);
  const statePaths = sidecarStatePaths(stateDirectory());
  const localToken = createLoopbackToken();
  const { credential, witnessProvider, proofMetrics, exchangeMetrics, slotLedger, prove } = await loadBaseClientRuntime();
  const prepaid = createBasePrepaidClient({
    credential,
    witnessProvider,
    prove,
    slotLedger,
    lifecycle: exchangeMetrics.observe,
  });
  const gatewayBaseUrl = process.env.ZK_CREDITS_GATEWAY_URL || 'http://127.0.0.1:3001';
  const sidecar = createSidecarServer({
    localToken,
    gatewayBaseUrl,
    prepaidClient: prepaid.client,
    metrics: () => ({ ...proofMetrics.snapshot(), exchange: exchangeMetrics.snapshot() }),
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
  if (args[0] === 'trial-registered-adapter') {
    await trialRegisteredAdapter();
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
