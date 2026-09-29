import { spawn } from 'node:child_process';
import { chmod, mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SidecarLifecycleDependencies } from './sidecar-lifecycle.js';
import { readLoopbackToken } from './sidecar-state.js';

export interface DetachedSidecarProcess {
  executable: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  logPath: string;
  stdin?: string;
}

export interface NodeSidecarLifecycleOptions {
  loopbackBaseUrl: string;
  stateDirectory: string;
  tokenPath: string;
  logPath: string;
  cliEntryPath: string;
  readCredentialPassword?: () => Promise<string>;
}

export interface NodeSidecarLifecycleRuntime {
  fetchHealth(url: string): Promise<Response>;
  startDetachedProcess(specification: DetachedSidecarProcess): Promise<void>;
  wait(milliseconds: number): Promise<void>;
}

const CHILD_ENVIRONMENT_KEYS = [
  'HOME', 'PATH', 'TMP', 'TEMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ',
  'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT',
  'ZK_CREDITS_CREDENTIAL_PATH', 'ZK_CREDITS_ARTIFACT_DIR', 'ZK_CREDITS_WITNESS_PATH',
  'ZK_CREDITS_GATEWAY_URL', 'BASE_RPC_URL', 'BASE_PRIVATE_CREDIT_BOND_ADDRESS',
  'BASE_DEPLOYMENT_BLOCK', 'BASE_CONFIRMATIONS',
] as const;

function sidecarEnvironment(stateDirectory: string, port: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of CHILD_ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  environment.ZK_CREDITS_HOME = stateDirectory;
  environment.ZK_CREDITS_SIDECAR_PORT = port;
  return environment;
}

async function startDetachedProcess(specification: DetachedSidecarProcess): Promise<void> {
  await mkdir(dirname(specification.logPath), { recursive: true, mode: 0o700 });
  const log = await open(specification.logPath, 'a', 0o600);
  await chmod(specification.logPath, 0o600);
  try {
    const child = spawn(specification.executable, specification.args, {
      detached: true,
      env: specification.env,
      stdio: [specification.stdin === undefined ? 'ignore' : 'pipe', log.fd, log.fd],
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    if (specification.stdin !== undefined && child.stdin) {
      child.stdin.on('error', () => undefined);
      child.stdin.end(specification.stdin);
    }
    child.unref();
  } finally {
    await log.close();
  }
}

const defaultRuntime: NodeSidecarLifecycleRuntime = {
  fetchHealth: async (url) => fetch(url, { signal: AbortSignal.timeout(500) }),
  startDetachedProcess,
  wait: async (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

/** Connects lifecycle orchestration to Node fetch, process, and file APIs. */
export function createNodeSidecarLifecycle(
  options: NodeSidecarLifecycleOptions,
  runtime: NodeSidecarLifecycleRuntime = defaultRuntime,
): SidecarLifecycleDependencies {
  const url = new URL(options.loopbackBaseUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) {
    throw new Error('Sidecar lifecycle requires a 127.0.0.1 HTTP URL with an explicit port');
  }

  return {
    logPath: options.logPath,
    async isHealthy(): Promise<boolean> {
      try {
        const response = await runtime.fetchHealth(`${url.origin}/health`);
        if (!response.ok) return false;
        const body = await response.json() as { service?: unknown; status?: unknown };
        return body.service === 'zk-credits-sidecar' && body.status === 'ok';
      } catch {
        return false;
      }
    },
    async startDetached(): Promise<void> {
      if (!options.readCredentialPassword) throw new Error('Credential password prompt is unavailable');
      const password = await options.readCredentialPassword();
      await runtime.startDetachedProcess({
        executable: process.execPath,
        args: [options.cliEntryPath, 'serve', '--port', url.port, '--credential-password-stdin'],
        env: sidecarEnvironment(options.stateDirectory, url.port),
        logPath: options.logPath,
        stdin: password,
      });
    },
    readToken: () => readLoopbackToken(options.tokenPath),
    wait: runtime.wait,
  };
}
