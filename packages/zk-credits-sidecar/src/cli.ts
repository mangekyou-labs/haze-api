#!/usr/bin/env node

import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { codingTaskEvidence, codingTaskProviderArgs, validateCodingTaskArgs } from './task-evidence.js';
import { launchCodexProcess } from './codex-launcher.js';
import { launchClineProcess } from './cline-launcher.js';
import {
  isCodexProfileInstalled,
  resolveCodexHome,
  writeCodexProfile,
} from './codex-profile.js';
import { createSidecarRuntime, RuntimeCredentialError } from './sidecar-runtime.js';
import { setupActivatedCredential } from './activated-credential-setup.js';
import { createLocalX402Agent } from './local-x402-agent.js';
import { nativeCredentialStore } from './credential-store.js';
import { applyRpcConfig, checkBaseSepoliaRpc, writeRpcConfig, RPC_GUIDANCE } from './rpc-config.js';
import { diagnoseSidecar, stopSidecar } from './sidecar-diagnostics.js';
import { runCliCommand } from './cli-runtime.js';
import { createNodeSidecarLifecycle } from './node-sidecar-lifecycle.js';
import { activateSidecarServer } from './server-startup.js';
import { createLoopbackToken, sidecarStatePaths } from './sidecar-config.js';
import {
  applySetupConfig,
  readSetupConfig,
} from './setup-config.js';
import { ensureSidecarReady } from './sidecar-lifecycle.js';
import { readLoopbackToken, writeLoopbackToken } from './sidecar-state.js';
import { createSidecarServer } from './sidecar.js';
import { buildBaseRegisteredTrialRequestBody } from './base-registered-trial.js';
import { BASE_SEPOLIA_NETWORK } from '@zk-credits/x402-zk-prepaid';
import { DEFAULT_GATEWAY_URL, resolveGatewayOrigin } from './gateway-root-check.js';
import { evaluateGatewayReadiness, isGatewayStatusFresh } from './gateway-trial-status.js';

const DEFAULT_PORT = 3210;

function stateDirectory(): string {
  return process.env.ZK_CREDITS_HOME || join(homedir(), '.zk-credits');
}

function setupConfigPath(directory = stateDirectory()): string {
  return join(directory, 'config.json');
}

async function applySavedSetupConfig(environment: NodeJS.ProcessEnv, directory = stateDirectory()): Promise<void> {
  await applyRpcConfig(environment, directory);
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

/** Reads a local secret value without terminal echo or shell history. */
async function readHiddenValue(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error('Hidden input requires an interactive local terminal.');
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

function printHelp(): void {
  console.log(`Usage:
  zk-credits --version
  zk-credits cline [cline arguments...]
  zk-credits config rpc
  zk-credits setup [codex|x402] [--legacy] [--model <model>]
  zk-credits codex [--task-evidence] [codex arguments...]
  zk-credits investigate --chain <base|base-sepolia> <transaction-hash>
  zk-credits status
  zk-credits doctor
  zk-credits stop
  zk-credits serve [--port <port>] [--internal-trial-one-proof]
  zk-credits x402-agent
  zk-credits founder-demo-agent
  eval "$(zk-credits env)"

"zk-credits cline" and the Codex companion configure and launch coding agents
against the x402 zk-prepaid loopback sidecar. The gateway spend path is
non-streaming POST /v1/chat/completions; Codex Responses requests pass through
the sidecar's bounded local compatibility bridge.
"zk-credits codex --task-evidence" selects the supported model and reasoning
defaults automatically, then prints this session's aggregate payment counters
after Codex exits. Enter your coding task interactively; no model flags are needed.
"zk-credits founder-demo-agent" asks for one local task and runs it through
the request-aware x402 adapter and local proof engine. It requires explicit
confirmation before one billable internal exchange; the task and response are
displayed locally and never added to activation evidence.
"zk-credits x402-agent" is a small task-running starter for the participant's
own x402 agent loop. It starts its own metrics server on the selected sidecar port;
stop an existing sidecar before launching it. It asks for tasks locally and sends each through the same
request-aware adapter and local proof engine; aggregate metrics stay on the
loopback-only authenticated endpoint.
"zk-credits serve --internal-trial-one-proof" limits this sidecar process to
one authenticated, valid spend request and one local proof attempt.
"zk-credits doctor" reports health, authenticated PID, setup and RPC configuration
presence, and log location without starting a server or revealing secrets.
"zk-credits stop" gracefully drains the authenticated sidecar. For older versions,
inspect the listener with lsof -nP -iTCP:3210 -sTCP:LISTEN, verify its PID with
ps -p <PID> -o pid,ppid,etime,command, then kill -TERM <PID>. Foreground: Ctrl+C.
Use ZK_CREDITS_SIDECAR_PORT for doctor, stop, status and env with a custom port.
If serve reports missing setup, run:
  ZK_CREDITS_CREDENTIAL_PATH=/path/to/activated-credential.json zk-credits setup
If the sidecar is stopped after setup, run zk-credits serve.
For RPC witness synchronization failures, run zk-credits config rpc and then
zk-credits stop followed by zk-credits serve. BASE_RPC_URL overrides the saved RPC.
Base Sepolia uses the launch endpoint baked into the package automatically. RPC endpoints
are rate-limited; run "zk-credits config rpc" to use your own endpoint.
Provider guide: https://docs.base.org/base-chain/node-operators/node-providers
Set ZK_CREDITS_CREDENTIAL_PATH to the activated browser download for first setup.
The passwordless credential is imported into your OS credential store. OS access
approval may be needed. Later restarts do not need the export or a password.
Use --legacy only for old encrypted exports with their original password.
The pinned proving archive is packaged, checked locally and installed without
GitHub sign-in. Setup synchronizes the public Base witness and checks its root.
No version of the published 0.2.8 package implements this new passwordless flow.
`);
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
  return resolveGatewayOrigin(process.env);
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
    const runtime = await createSidecarRuntime();
    try {
    if (runtime.snapshot().tierId !== 0) {
      console.log(JSON.stringify({ path: 'founder-demo-agent', status: 'stopped', failurePhase: 'credential_gate' }));
      return;
    }
    const startingSlots = runtime.snapshot().slots;
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
    const witnessRoot = await runtime.witnessRoot();
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
    if (witnessRoot !== adminBefore.snapshot.currentRoot) {
      console.log(JSON.stringify({ path: 'founder-demo-agent', status: 'stopped', failurePhase: 'root_mismatch', launcherStatus, readiness, adminStatus: adminBefore.status }));
      return;
    }

    const baseline = runtime.snapshot();
    const baselineSlots = baseline.slots;
    const baselineProof = baseline.metrics;
    const baselineLifecycle = baseline.metrics.exchange;
    const requestUrl = new URL('/v1/chat/completions', gateway).toString();
    const requestBody = buildBaseRegisteredTrialRequestBody(task);
    const exchange = await runtime.runFounderTrial({
      url: requestUrl,
      body: requestBody,
      headers: { 'content-type': 'application/json' },
      onResponse: displayAgentResponse,
    });
    const adminAfter = await gatewayTrialSnapshot(gateway, adminToken);
    const after = runtime.snapshot();
    const proofAfter = after.metrics;
    const lifecycleAfter = after.metrics.exchange;
    const slotAfter = after.slots;
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
    } finally { await runtime.close(); }
  } catch (error) {
    console.log(JSON.stringify({ path: 'founder-demo-agent', status: 'stopped', failurePhase: error instanceof RuntimeCredentialError ? 'credential_gate' : 'local_setup' }));
  }
}

async function serve(args: readonly string[]): Promise<void> {
  const port = readPort(args);
  const internalTrialOneProof = args.includes('--internal-trial-one-proof');
  const statePaths = sidecarStatePaths(stateDirectory());
  const localToken = createLoopbackToken();
  const runtime = await createSidecarRuntime({ internalTrialOneProof });
  const gatewayBaseUrl = process.env.ZK_CREDITS_GATEWAY_URL || DEFAULT_GATEWAY_URL;
  const sidecar = createSidecarServer({
    localToken,
    gatewayBaseUrl,
    prepaidClient: runtime.client,
    internalTrialOneProof,
    metrics: () => runtime.snapshot().metrics,
    onShutdown: () => { void shutdown().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Sidecar shutdown failed');
      process.exitCode = 1;
    }); },
  });
  let address: string;
  try {
    address = await activateSidecarServer({
      listen: () => sidecar.listen(port),
      publishToken: () => writeLoopbackToken(statePaths.tokenPath, localToken),
    });
  } catch (error: unknown) {
    await sidecar.close();
    await runtime.close();
    throw error;
  }
  console.log(`ZK Credits sidecar listening on ${address}/v1`);
  console.log('Run eval "$(zk-credits env)" in the client shell.');

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    shutdownPromise ??= sidecar.close().then(() => runtime.close()).then(() => { process.exit(0); });
    return shutdownPromise;
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
}

async function runCodingTask(args: readonly string[]): Promise<void> {
  validateCodingTaskArgs(args);
  const runtime = await createSidecarRuntime();
  const localToken = createLoopbackToken();
  const sidecar = createSidecarServer({ localToken,
    gatewayBaseUrl: process.env.ZK_CREDITS_GATEWAY_URL || DEFAULT_GATEWAY_URL, prepaidClient: runtime.client });
  try {
    // A random port and unpublished token isolate this process from other agents.
    const address = await sidecar.listen(0);
    const exitCode = await launchCodexProcess([
      ...codingTaskProviderArgs(address), ...args,
    ], undefined, { ...process.env, ZK_CREDITS_TASK_TOKEN: localToken });
    await sidecar.close(); // drain outstanding requests before taking counters
    console.log(JSON.stringify(codingTaskEvidence(runtime.snapshot().metrics, exitCode)));
    process.exitCode = exitCode;
  } finally { await sidecar.close(); await runtime.close(); }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === '--version' || args[0] === '-v') {
    const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    console.log(metadata.version);
    return;
  }
  const localHelp = ['doctor', 'stop', 'status', 'serve', 'setup', 'config', 'investigate'].includes(args[0] ?? '')
    && args.slice(1).some((arg) => arg === '--help' || arg === '-h');
  if (args[0] === '--help' || args[0] === '-h' || !args[0] || localHelp) {
    printHelp();
    return;
  }
  const sidecarHome = stateDirectory();
  if (args[0] === 'doctor' || args[0] === 'stop') {
    if (args.length !== 1) throw new Error(`Usage: zk-credits ${args[0]} (use ZK_CREDITS_SIDECAR_PORT to select a port)`);
    const options = { baseUrl: loopbackBaseUrl(), stateDirectory: sidecarHome, write: (line: string) => console.log(line) };
    if (args[0] === 'doctor') await diagnoseSidecar(options);
    else await stopSidecar(options);
    return;
  }
  if (args[0] === 'config' && args[1] === 'rpc' && args.length === 2) {
    console.log(RPC_GUIDANCE);
    const rpc = await checkBaseSepoliaRpc(await readHiddenValue('Base Sepolia RPC URL (hidden): '));
    await writeRpcConfig(sidecarHome, rpc);
    console.log('Base Sepolia RPC saved with owner-only access. BASE_RPC_URL overrides this setting.');
    console.log('A running sidecar keeps its current RPC. Stop and restart it to apply this change.');
    return;
  }

  if (args[0] === 'investigate') {
    const { runLiveInvestigation, formatLiveReport } = await import(new URL('./investigator.mjs', import.meta.url).href);
    const report = await runLiveInvestigation(args.slice(1));
    console.log(formatLiveReport(report));
    if (report.paymentEvidence.confirmed === 0 || report.paymentEvidence.unknown > 0 || !report.paymentEvidence.modelDeliveryObserved) process.exitCode = 1;
    return;
  }

  if (args[0] === 'codex' && args.includes('--task-evidence')) {
    if (!await isCodexProfileInstalled(resolveCodexHome(process.env, homedir()))) throw new Error('Run zk-credits setup codex first');
    await runCodingTask(args.slice(1).filter(arg => arg !== '--task-evidence'));
    return;
  }
  if (args[0] === 'serve') {
    await serve(args.slice(1));
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

  if (args[0] !== 'setup' && args[0] !== 'status' && args[0] !== 'env') {
    await applySavedSetupConfig(process.env, sidecarHome);
  }

  const statePaths = sidecarStatePaths(sidecarHome);
  const codexHome = resolveCodexHome(process.env, homedir());
  const cliEntryPath = process.argv[1];
  if (!cliEntryPath) throw new Error('Unable to resolve the zk-credits executable path');
  const credentialStore = nativeCredentialStore(sidecarHome);
  const lifecycle = createNodeSidecarLifecycle({
    loopbackBaseUrl: loopbackBaseUrl(), stateDirectory: sidecarHome,
    tokenPath: statePaths.tokenPath, logPath: statePaths.logPath, cliEntryPath,
  });
  const exitCode = await runCliCommand(args, {
    loopbackBaseUrl: loopbackBaseUrl(),
    readToken: () => readLoopbackToken(statePaths.tokenPath),
    write: (line) => console.log(line),
    isCredentialConfigured: async () => {
      if (process.env.ZK_CREDITS_CREDENTIAL_PATH) return true;
      return Boolean(await credentialStore.read());
    },
    validateSetupPrerequisites: async () => {
      await setupActivatedCredential({
        environment: process.env,
        homeDirectory: homedir(),
        stateDirectory: sidecarHome,
        credentialStore,
        chooseCandidate: chooseSetupCandidate,
        ...(args.includes('--legacy') ? { readLegacyPassword: () => readHiddenValue('Legacy export password: ') } : {}),
      });

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
  if ((error as NodeJS.ErrnoException)?.code === 'EADDRINUSE') {
    console.error('The local port is already occupied. Run zk-credits doctor to identify the listener. Stop the existing sidecar with zk-credits stop (older sidecars: inspect the PID before kill -TERM <PID>), then retry. x402-agent starts its own local metrics server and does not reuse serve.');
  } else {
    console.error(error instanceof Error ? error.message : 'zk-credits failed');
  }
  process.exitCode = 1;
});
