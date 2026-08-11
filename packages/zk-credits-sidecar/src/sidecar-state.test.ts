import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readLoopbackToken, writeLoopbackToken } from './sidecar-state.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('loopback sidecar state', () => {
  it('persists the active local bearer with owner-only permissions for the env command', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zk-credits-state-'));
    temporaryDirectories.push(directory);
    const tokenPath = join(directory, 'private', 'loopback-token');

    await writeLoopbackToken(tokenPath, 'zk-local-token');

    await expect(readLoopbackToken(tokenPath)).resolves.toBe('zk-local-token');
    expect((await stat(tokenPath)).mode & 0o777).toBe(0o600);
  });
});
