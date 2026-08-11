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
}

export interface NodeSidecarLifecycleOptions {
  loopbackBaseUrl: string;
  stateDirectory: string;
  tokenPath: string;
  logPath: string;
  cliEntryPath: string;
}

export interface NodeSidecarLifecycleRuntime {
  fetchHealth(url: string): Promise<Response>;
  startDetachedProcess(specification: DetachedSidecarProcess): Promise<void>;
  wait(milliseconds: number): Promise<void>;
}

async function startDetachedProcess(specification: DetachedSidecarProcess): Promise<void> {
  await mkdir(dirname(specification.logPath), { recursive: true, mode: 0o700 });
  const log = await open(specification.logPath, 'a', 0o600);
  await chmod(specification.logPath, 0o600);
  try {
    const child = spawn(specification.executable, specification.args, {
      detached: true,
      env: specification.env,
      stdio: ['ignore', log.fd, log.fd],
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
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
      await runtime.startDetachedProcess({
        executable: process.execPath,
        args: [options.cliEntryPath, 'serve', '--port', url.port],
        env: {
          ...process.env,
          ZK_CREDITS_HOME: options.stateDirectory,
          ZK_CREDITS_SIDECAR_PORT: url.port,
        },
        logPath: options.logPath,
      });
    },
    readToken: () => readLoopbackToken(options.tokenPath),
    wait: runtime.wait,
  };
}
