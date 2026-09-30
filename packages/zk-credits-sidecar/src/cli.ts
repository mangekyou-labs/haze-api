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
import { createBasePrepaidClient, createFileWitnessProvider, validateBaseCreditWitness, type BaseWitnessProvider } from './base-sidecar.js';
import { createLocalX402Agent } from './local-x402-agent.js';
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
import {
  applySetupConfig,
  readSetupConfig,
  resolveSetupInputs,
  writeSetupConfig,
  type SetupWitnessSource,
} from './setup-config.js';
import { ensureSidecarReady } from './sidecar-lifecycle.js';
import { readLoopbackToken, writeLoopbackToken } from './sidecar-state.js';
import { createSidecarServer } from './sidecar.js';
import { buildBaseRegisteredTrialRequestBody, runBaseRegisteredTrialExchange } from './base-registered-trial.js';
import { loadCircuitManifest } from './artifact-bundle.js';
import { BASE_SEPOLIA_NETWORK } from '@zk-credits/x402-zk-prepaid';
import { requireGatewayKnownRoot as checkGatewayKnownRoot } from './gateway-root-check.js';
import { evaluateGatewayReadiness, isGatewayStatusFresh } from './gateway-trial-status.js';

const DEFAULT_GATEWAY_URL = 'https://zk-credits-gateway.onrender.com';
const DEFAULT_PORT = 3210;

function stateDirectory(): string {
  return process.env.ZK_CREDITS_HOME || join(homedir(), '.zk-credits');
}

function setupConfigPath(directory = stateDirectory()): string {
  return join(directory, 'config.json');
}

async function applySavedSetupConfig(environment: NodeJS.ProcessEnv, directory = stateDirectory()): Promise<void> {
  const config = await readSetupConfig(setupConfigPath(directory));
  if (config) applySetupConfig(environment, config);
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

async function chooseSetupCandidate(
  kind: 'proving bundle' | 'witness file',
  candidates: readonly string[],
): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const variable = kind === 'proving bundle' ? 'ZK_CREDITS_ARTIFACT_DIR' : 'ZK_CREDITS_WITNESS_PATH';
    throw new Error(
      'Found more than one valid local ' + kind + '. Rerun in an interactive terminal or set ' + variable + ' explicitly.',
    );
  }
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('Found multiple valid ' + kind + 's:');
    candidates.forEach((candidate, index) => console.log('  ' + (index + 1) + ') ' + candidate));
    const answer = await input.question('Select a number: ');
    const index = Number(answer);
    if (!Number.isInteger(index) || index < 1 || index > candidates.length) {
      throw new Error('Choose one of the listed local candidates');
    }
    return candidates[index - 1]!;
  } finally {
    input.close();
  }
}

async function witnessProviderForSource(
  source: SetupWitnessSource,
  cachePath: string,
): Promise<BaseWitnessProvider> {
  if (source.kind === 'file') {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(source.path, 'utf8')) as unknown;
    } catch {
      throw new Error('The Base witness file could not be read as JSON');
    }
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

/** Reads a password written to the private stdin pipe by the foreground CLI. */
async function readCredentialPasswordFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += bytes.length;
    if (byteLength > 4096) throw new Error('Credential password input is too long');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
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
      process.stdin.pause();
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
  zk-credits serve [--port <port>] [--internal-trial-one-proof]
  zk-credits x402-agent
  zk-credits founder-demo-agent
  eval "$(zk-credits env)"

"zk-credits cline" and the Codex companion configure and launch coding agents
against the x402 zk-prepaid loopback sidecar. The gateway spend path is
non-streaming POST /v1/chat/completions; Codex Responses requests pass through
the sidecar's bounded local compatibility bridge.
"zk-credits founder-demo-agent" asks for one local task and runs it through
the request-aware x402 adapter and local proof engine. It requires explicit
confirmation before one billable internal exchange; the task and response are
displayed locally and never added to activation evidence.
"zk-credits x402-agent" is a small task-running starter for the participant's
own x402 agent loop. It asks for tasks locally and sends each through the same
request-aware adapter and local proof engine; aggregate metrics stay on the
loopback-only authenticated endpoint.
"zk-credits serve --internal-trial-one-proof" limits this sidecar process to
one authenticated, valid spend request and one local proof attempt.
Set ZK_CREDITS_CREDENTIAL_PATH and BASE_RPC_URL before setup. For Base Sepolia
V2, setup can download the immutable bundle pinned by the package manifest by
using this machine's authenticated GitHub CLI session, then synchronizes the
witness from the pinned public Base events and checks the resulting root with
the gateway. It saves local paths and prompts for the credential password
without echo; the encrypted export is decrypted only in local memory.`);
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
async function loadBaseClientRuntime(passwordInput?: string): Promise<BaseClientRuntime> {
  const credentialPath = process.env.ZK_CREDITS_CREDENTIAL_PATH;
  if (!credentialPath) throw new Error('Set ZK_CREDITS_CREDENTIAL_PATH to the encrypted browser export');
  const password = passwordInput ?? await readHiddenValue('Credential backup password: ');
  const credential = await readEncryptedCredential(credentialPath, password);
  const witnessPath = process.env.ZK_CREDITS_WITNESS_PATH;
  const artifactDirectory = process.env.ZK_CREDITS_ARTIFACT_DIR;
  if (!artifactDirectory) {
    throw new Error('Set ZK_CREDITS_ARTIFACT_DIR to the directory holding the installed pinned proving bundle');
  }
  const baseRpcUrl = process.env.BASE_RPC_URL;
  const baseContractAddress = process.env.BASE_PRIVATE_CREDIT_BOND_ADDRESS;
  const witnessProvider = witnessPath
    ? createFileWitnessProvider(JSON.parse(await readFile(witnessPath, 'utf8')))
    : baseRpcUrl && baseContractAddress
      ? await witnessProviderForSource(
          {
            kind: 'base-events',
            rpcUrl: baseRpcUrl,
            contractAddress: baseContractAddress,
            ...(process.env.BASE_DEPLOYMENT_BLOCK && /^\d+$/u.test(process.env.BASE_DEPLOYMENT_BLOCK)
              ? { deploymentBlock: process.env.BASE_DEPLOYMENT_BLOCK }
              : {}),
            ...(process.env.BASE_CONFIRMATIONS && /^\d+$/u.test(process.env.BASE_CONFIRMATIONS)
              ? { confirmations: process.env.BASE_CONFIRMATIONS }
              : {}),
          },
          join(stateDirectory(), 'base-event-sync.json'),
        )
      : (() => { throw new Error('Set ZK_CREDITS_WITNESS_PATH or configure BASE_RPC_URL and BASE_PRIVATE_CREDIT_BOND_ADDRESS'); })();
  const proofMetrics = createBaseProofMetrics();
  const exchangeMetrics = createZkPrepaidLifecycleMetrics();
  const slotLedger = await BaseSlotLedger.open({ path: join(stateDirectory(), 'base-slots.json') });
  const prove = await createPinnedBaseProofGenerator({ artifactDirectory, metrics: proofMetrics });
  validateBaseCreditWitness(await witnessProvider.witnessForCredential(credential));
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

async function requireGatewayKnownRoot(root: string): Promise<void> {
  await checkGatewayKnownRoot(root, gatewayOrigin());
}

async function gatewayReadiness(origin: URL): Promise<{
  status: number | null;
  passed: boolean;
  failedChecks: string[];
  timestampFresh: boolean;
}> {
  const response = await readGatewayJson(new URL('/ready', origin), { accept: 'application/json' });
  const gate = evaluateGatewayReadiness(response.status, response.body);
  return {
    status: response.status,
    ...gate,
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
      && isGatewayStatusFresh(body?.generatedAt)
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

async function readFounderDemoTask(): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('the founder demo requires a local interactive terminal');
  }
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const task = (await input.question('Task for the founder x402 demo agent (up to 4000 characters): ')).trim();
    if (task.length === 0 || task.length > 4_000) {
      throw new Error('Task must contain between 1 and 4000 characters');
    }
    return task;
  } finally {
    input.close();
  }
}

async function readX402AgentTask(): Promise<string | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('the x402 starter agent requires a local interactive terminal');
  }
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const task = (await input.question('Task for your x402 agent (or :quit): ')).trim();
    if (task === ':quit') return null;
    if (task.length === 0 || task.length > 4_000) {
      throw new Error('Task must contain between 1 and 4000 characters');
    }
    return task;
  } finally {
    input.close();
  }
}

async function runX402Agent(): Promise<void> {
  const gateway = gatewayOrigin();
  const runtime = await createLocalX402Agent();
  const url = new URL('/v1/chat/completions', gateway).toString();
  console.log(`Local aggregate metrics: ${runtime.metricsUrl}`);
  console.log('Enter one task at a time. Each task can spend one founder-provisioned test credit.');
  try {
    while (true) {
      const task = await readX402AgentTask();
      if (task === null) break;
      const response = await runtime.client.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: buildBaseRegisteredTrialRequestBody(task),
      });
      await displayAgentResponse(response);
      if (!response.ok) console.log(`Request ended with HTTP ${response.status}.`);
    }
  } finally {
    await runtime.close();
  }
}

async function displayAgentResponse(response: Response): Promise<void> {
  let content: unknown;
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && Array.isArray(body.choices) && isRecord(body.choices[0])) {
      const message = body.choices[0].message;
      if (isRecord(message)) content = message.content;
    }
  } catch {
    // The response is a local display convenience; activation recording uses
    // only the closed exchange and counter summaries below.
  }
  console.log('\nAgent response (shown locally only):');
  if (typeof content === 'string') {
    console.log(content);
    return;
  }
  if (Array.isArray(content)) {
    const textParts = content
      .filter((part): part is Record<string, unknown> => isRecord(part))
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text as string);
    if (textParts.length > 0) {
      console.log(textParts.join('\n'));
      return;
    }
  }
  console.log('[The response completed, but its text content was not available for local display.]');
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

async function trialRegisteredAdapter(task: string): Promise<void> {
  if (!await confirmDirectTrial()) {
    console.log(JSON.stringify({ path: 'founder-demo-agent', status: 'not_run' }));
    return;
  }
  try {
    const runtime = await loadBaseClientRuntime();
    if (
      runtime.credential.tierId !== 0
      || runtime.credential.deploymentDomain !== '84532'
      || runtime.credential.expiry <= Math.floor(Date.now() / 1000)
    ) {
      console.log(JSON.stringify({ path: 'founder-demo-agent', status: 'stopped', failurePhase: 'credential_gate' }));
      return;
    }
    const startingSlots = runtime.slotLedger.snapshot();
    if (startingSlots.committed >= startingSlots.capacity) {
      console.log(JSON.stringify({
        path: 'founder-demo-agent',
        status: 'stopped',
        failurePhase: 'local_credit_gate',
        localCredits: { capacity: startingSlots.capacity, committed: startingSlots.committed, available: 0 },
      }));
      return;
    }
    const gateway = gatewayOrigin();
    const adminToken = process.env.BILLING_INTERNAL_TOKEN || await readHiddenValue('Gateway admin token: ');
    if (!adminToken.trim()) {
      console.log(JSON.stringify({ path: 'founder-demo-agent', status: 'stopped', failurePhase: 'admin_auth' }));
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
      console.log(JSON.stringify({ path: 'founder-demo-agent', status: 'stopped', failurePhase: 'sidecar_running', launcherStatus }));
      return;
    }
    const witness = await runtime.witnessProvider.witnessForCredential(runtime.credential);
    const readiness = await gatewayReadiness(gateway);
    if (!readiness.passed) {
      console.log(JSON.stringify({ path: 'founder-demo-agent', status: 'stopped', failurePhase: 'readiness', launcherStatus, readiness }));
      return;
    }
    const adminBefore = await gatewayTrialSnapshot(gateway, adminToken);
    if (!adminBefore.gatePassed || !adminBefore.snapshot) {
      console.log(JSON.stringify({ path: 'founder-demo-agent', status: 'stopped', failurePhase: 'admin_status', launcherStatus, readiness, adminStatus: adminBefore.status }));
      return;
    }
    if (witness.root !== adminBefore.snapshot.currentRoot) {
      console.log(JSON.stringify({ path: 'founder-demo-agent', status: 'stopped', failurePhase: 'root_mismatch', launcherStatus, readiness, adminStatus: adminBefore.status }));
      return;
    }

    const baselineSlots = runtime.slotLedger.snapshot();
    const baselineProof = runtime.proofMetrics.snapshot();
    const baselineLifecycle = runtime.exchangeMetrics.snapshot();
    const requestUrl = new URL('/v1/chat/completions', gateway).toString();
    const requestBody = buildBaseRegisteredTrialRequestBody(task);
    const exchange = await runBaseRegisteredTrialExchange({
      url: requestUrl,
      body: requestBody,
      headers: { 'content-type': 'application/json' },
      credential: runtime.credential,
      witnessProvider: runtime.witnessProvider,
      prove: runtime.prove,
      slotLedger: runtime.slotLedger,
      lifecycle: runtime.exchangeMetrics.observe,
      onResponse: displayAgentResponse,
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
      path: 'founder-demo-agent',
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
    console.log(JSON.stringify({ path: 'founder-demo-agent', status: 'stopped', failurePhase: 'local_setup' }));
  }
}

async function serve(args: readonly string[], passwordInput?: string): Promise<void> {
  const port = readPort(args);
  const internalTrialOneProof = args.includes('--internal-trial-one-proof');
  const statePaths = sidecarStatePaths(stateDirectory());
  const localToken = createLoopbackToken();
  const { credential, witnessProvider, proofMetrics, exchangeMetrics, slotLedger, prove } = await loadBaseClientRuntime(passwordInput);
  const prepaid = createBasePrepaidClient({
    credential,
    witnessProvider,
    prove,
    slotLedger,
    internalTrialOneProof,
    lifecycle: exchangeMetrics.observe,
  });
  const gatewayBaseUrl = process.env.ZK_CREDITS_GATEWAY_URL || DEFAULT_GATEWAY_URL;
  const sidecar = createSidecarServer({
    localToken,
    gatewayBaseUrl,
    prepaidClient: prepaid.client,
    internalTrialOneProof,
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
  const sidecarHome = stateDirectory();
  if (args[0] !== 'setup' && args[0] !== 'status' && args[0] !== 'env') {
    await applySavedSetupConfig(process.env, sidecarHome);
  }
  if (args[0] === 'serve') {
    const passwordFromStdin = args.includes('--credential-password-stdin')
      ? await readCredentialPasswordFromStdin()
      : undefined;
    await serve(args.slice(1).filter((argument) => argument !== '--credential-password-stdin'), passwordFromStdin);
    return;
  }
  if (args[0] === 'founder-demo-agent') {
    if (args.length !== 1) throw new Error('founder-demo-agent does not accept arguments; it reads the task locally');
    const task = await readFounderDemoTask();
    await trialRegisteredAdapter(task);
    return;
  }
  if (args[0] === 'x402-agent') {
    if (args.length !== 1) throw new Error('x402-agent does not accept arguments; it reads tasks locally');
    await runX402Agent();
    return;
  }

  const statePaths = sidecarStatePaths(sidecarHome);
  const codexHome = resolveCodexHome(process.env, homedir());
  const cliEntryPath = process.argv[1];
  if (!cliEntryPath) throw new Error('Unable to resolve the zk-credits executable path');
  let setupCredentialPassword: string | undefined;
  const lifecycle = createNodeSidecarLifecycle({
    loopbackBaseUrl: loopbackBaseUrl(),
    stateDirectory: sidecarHome,
    tokenPath: statePaths.tokenPath,
    logPath: statePaths.logPath,
    cliEntryPath,
    readCredentialPassword: async () => {
      if (setupCredentialPassword !== undefined) {
        const password = setupCredentialPassword;
        setupCredentialPassword = undefined;
        return password;
      }
      return readHiddenValue('Credential backup password: ');
    },
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
    validateSetupPrerequisites: async () => {
      const credentialPath = process.env.ZK_CREDITS_CREDENTIAL_PATH;
      if (!credentialPath?.trim()) throw new Error('Set ZK_CREDITS_CREDENTIAL_PATH to the encrypted browser export');
      const password = await readHiddenValue('Credential backup password: ');
      const credential = await readEncryptedCredential(credentialPath, password);
      const manifest = await loadCircuitManifest();
      const config = await resolveSetupInputs({
        environment: process.env,
        homeDirectory: homedir(),
        stateDirectory: sidecarHome,
        configPath: setupConfigPath(sidecarHome),
        manifest,
        validateWitness: async (source) => {
          const provider = await witnessProviderForSource(
            source,
            join(stateDirectory(), 'base-event-sync.json'),
          );
          const witness = validateBaseCreditWitness(await provider.witnessForCredential(credential));
          if (manifest.deployment) await requireGatewayKnownRoot(witness.root);
        },
        chooseCandidate: chooseSetupCandidate,
      });
      const artifactDirectory = config.artifactDirectory;
      try {
        await createPinnedBaseProofGenerator({
          artifactDirectory,
          metrics: createBaseProofMetrics(),
        });
      } catch (error) {
        if (error instanceof Error) throw new Error(`Pinned proving bundle check failed: ${error.message}`);
        throw new Error('Pinned proving bundle check failed. Reinstall the bundle from your pilot invite.');
      }
      await writeSetupConfig(setupConfigPath(sidecarHome), config);
      applySetupConfig(process.env, config);
      setupCredentialPassword = password;
      console.log('Pinned proving bundle and witness validated for this activated credential.');
      console.log('Local setup paths saved to ' + setupConfigPath(sidecarHome));
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
