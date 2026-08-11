import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { launchClineProcess, type ClineSpawnCommand } from './cline-launcher.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

async function temporaryStateDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'zk-credits-cline-launcher-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('Cline launcher', () => {
  it('configures and launches only the isolated OpenAI-compatible provider', async () => {
    const children: EventEmitter[] = [];
    const spawn = vi.fn((_command: string, args: readonly string[]) => {
      const child = new EventEmitter();
      children.push(child);
      queueMicrotask(() => child.emit('exit', args[0] === 'auth' ? 0 : 17, null));
      return child;
    }) as unknown as ClineSpawnCommand;
    const stateDirectory = await temporaryStateDirectory();

    await expect(launchClineProcess({
      args: ['--json', 'explain this repository'],
      loopbackBaseUrl: 'http://127.0.0.1:3210',
      localToken: 'zk-local-cline-token',
      stateDirectory,
    }, spawn)).resolves.toBe(17);

    const dataDirectory = join(stateDirectory, 'cline');
    expect(children).toHaveLength(2);
    expect(spawn).toHaveBeenNthCalledWith(1, 'cline', [
      'auth',
      '--provider', 'openai-compatible',
      '--apikey', 'zk-local-cline-token',
      '--modelid', 'openai/gpt-4o-mini',
      '--baseurl', 'http://127.0.0.1:3210/v1',
      '--data-dir', dataDirectory,
    ], expect.objectContaining({
      env: expect.objectContaining({
        OPENAI_BASE_URL: 'http://127.0.0.1:3210/v1',
        OPENAI_API_KEY: 'zk-local-cline-token',
      }),
    }));
    expect(spawn).toHaveBeenNthCalledWith(2, 'cline', [
      '--provider', 'openai-compatible',
      '--model', 'openai/gpt-4o-mini',
      '--data-dir', dataDirectory,
      '--json',
      'explain this repository',
    ], expect.objectContaining({
      stdio: 'inherit',
      env: expect.objectContaining({
        OPENAI_BASE_URL: 'http://127.0.0.1:3210/v1',
        OPENAI_API_KEY: 'zk-local-cline-token',
      }),
    }));
  });

  it('uses an explicit Cline model for both provider setup and the run', async () => {
    const spawn = vi.fn((_command: string, args: readonly string[]) => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', args[0] === 'auth' ? 0 : 0, null));
      return child;
    }) as unknown as ClineSpawnCommand;

    await launchClineProcess({
      args: ['--model', 'anthropic/claude-3.5-haiku', 'answer only'],
      loopbackBaseUrl: 'http://127.0.0.1:3210',
      localToken: 'zk-local-cline-token',
      stateDirectory: await temporaryStateDirectory(),
    }, spawn);

    expect(spawn.mock.calls[0]?.[1]).toEqual(expect.arrayContaining([
      '--modelid', 'anthropic/claude-3.5-haiku',
    ]));
    expect(spawn.mock.calls[1]?.[1]).toEqual(expect.arrayContaining([
      '--model', 'anthropic/claude-3.5-haiku',
    ]));
  });

  it('reports a missing Cline executable with installation guidance', async () => {
    const spawn = vi.fn(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('error', Object.assign(new Error('spawn cline ENOENT'), {
        code: 'ENOENT',
      })));
      return child;
    }) as unknown as ClineSpawnCommand;

    await expect(launchClineProcess({
      args: [],
      loopbackBaseUrl: 'http://127.0.0.1:3210',
      localToken: 'zk-local-cline-token',
      stateDirectory: await temporaryStateDirectory(),
    }, spawn)).rejects.toThrow(
      'Cline CLI was not found; install it with npm install --global cline',
    );
  });
});
