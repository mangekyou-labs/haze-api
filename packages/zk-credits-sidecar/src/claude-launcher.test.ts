import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  launchClaudeProcess,
  type ClaudeSpawnCommand,
} from './claude-launcher.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

async function temporaryStateDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), 'zk-credits-claude-launcher-'),
  );
  temporaryDirectories.push(directory);
  return directory;
}

describe('Claude launcher', () => {
  it('configures and launches Claude Code with isolated config dir and loopback env', async () => {
    const children: EventEmitter[] = [];
    const spawn = vi.fn((_command: string, _args: readonly string[]) => {
      const child = new EventEmitter();
      children.push(child);
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    }) as unknown as ClaudeSpawnCommand;

    const stateDirectory = await temporaryStateDirectory();

    await expect(
      launchClaudeProcess(
        {
          args: ['-p', 'Hello from test'],
          loopbackBaseUrl: 'http://127.0.0.1:3210',
          localToken: 'zk-test-local-token',
          stateDirectory,
        },
        spawn,
      ),
    ).resolves.toBe(0);

    const configDirectory = join(stateDirectory, 'claude');
    expect(children).toHaveLength(1);
    expect(spawn).toHaveBeenCalledWith(
      'claude',
      ['-p', 'Hello from test'],
      expect.objectContaining({
        stdio: 'inherit',
        env: expect.objectContaining({
          CLAUDE_CONFIG_DIR: configDirectory,
          ANTHROPIC_BASE_URL: 'http://127.0.0.1:3210',
          ANTHROPIC_AUTH_TOKEN: 'zk-test-local-token',
        }),
      }),
    );
  });

  it('reports a missing Claude Code executable with installation guidance', async () => {
    const spawn = vi.fn(() => {
      const child = new EventEmitter();
      queueMicrotask(() => {
        const error = new Error('spawn claude ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        child.emit('error', error);
      });
      return child;
    }) as unknown as ClaudeSpawnCommand;

    const stateDirectory = await temporaryStateDirectory();

    await expect(
      launchClaudeProcess(
        {
          args: ['-p', 'test'],
          loopbackBaseUrl: 'http://127.0.0.1:3210',
          localToken: 'zk-test-local-token',
          stateDirectory,
        },
        spawn,
      ),
    ).rejects.toThrow(
      'Claude Code CLI was not found; install it with npm install -g @anthropic-ai/claude-code before running zk-credits claude',
    );
  });
});
