import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNodeSidecarLifecycle } from './node-sidecar-lifecycle.js';
import { writeLoopbackToken } from './sidecar-state.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('Node sidecar lifecycle adapter', () => {
  it('recognizes only the ZK Credits health response and reads the protected token', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zk-credits-lifecycle-'));
    temporaryDirectories.push(directory);
    const tokenPath = join(directory, 'loopback-token');
    await writeLoopbackToken(tokenPath, 'active-token');
    const fetchHealth = vi.fn(async () => new Response(JSON.stringify({
      service: 'zk-credits-sidecar',
      status: 'ok',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const lifecycle = createNodeSidecarLifecycle({
      loopbackBaseUrl: 'http://127.0.0.1:3210',
      stateDirectory: directory,
      tokenPath,
      logPath: join(directory, 'sidecar.log'),
      cliEntryPath: '/opt/zk-credits/dist/cli.js',
    }, {
      fetchHealth,
      startDetachedProcess: async () => undefined,
      wait: async () => undefined,
    });

    await expect(lifecycle.isHealthy()).resolves.toBe(true);
    await expect(lifecycle.readToken()).resolves.toBe('active-token');
    expect(fetchHealth).toHaveBeenCalledWith('http://127.0.0.1:3210/health');
  });

  it('starts the current CLI on the configured port with state and log isolation', async () => {
    const startDetachedProcess = vi.fn(async () => undefined);
    const lifecycle = createNodeSidecarLifecycle({
      loopbackBaseUrl: 'http://127.0.0.1:4567',
      stateDirectory: '/private/zk-state',
      tokenPath: '/private/zk-state/loopback-token',
      logPath: '/private/zk-state/sidecar.log',
      cliEntryPath: '/opt/zk-credits/dist/cli.js',
    }, {
      fetchHealth: async () => new Response(null, { status: 503 }),
      startDetachedProcess,
      wait: async () => undefined,
    });

    await lifecycle.startDetached();

    expect(startDetachedProcess).toHaveBeenCalledWith({
      executable: process.execPath,
      args: ['/opt/zk-credits/dist/cli.js', 'serve', '--port', '4567'],
      env: expect.objectContaining({
        ZK_CREDITS_HOME: '/private/zk-state',
        ZK_CREDITS_SIDECAR_PORT: '4567',
      }),
      logPath: '/private/zk-state/sidecar.log',
    });
  });

  it('rejects a different process that happens to return HTTP 200', async () => {
    const lifecycle = createNodeSidecarLifecycle({
      loopbackBaseUrl: 'http://127.0.0.1:3210',
      stateDirectory: '/private/zk-state',
      tokenPath: '/private/zk-state/loopback-token',
      logPath: '/private/zk-state/sidecar.log',
      cliEntryPath: '/opt/zk-credits/dist/cli.js',
    }, {
      fetchHealth: async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
      startDetachedProcess: async () => undefined,
      wait: async () => undefined,
    });

    await expect(lifecycle.isHealthy()).resolves.toBe(false);
  });
});
