/**
 * The resumable launch state.
 *
 * The launch crosses irreversible operations, so the interesting assertions are
 * about what the store refuses: a secret-shaped value, a git-tracked path, a
 * file that is not mode 0600, and an unsupported schema version. The other half
 * is the `unknown` status, which is the only thing standing between an
 * interrupted broadcast and a duplicated one.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LaunchStateStore, emptyLaunchState, requirePrivateMode } from './state.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function statePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'zk-launch-state-'));
  directories.push(directory);
  return join(directory, '.launch-state.local.json');
}

const NOW = 1_800_000_000_000;

function store(path: string, options: { isTracked?: (path: string) => Promise<boolean> } = {}): LaunchStateStore {
  return new LaunchStateStore({ path, now: () => NOW, isTracked: options.isTracked ?? (async () => false) });
}

describe('launch state store', () => {
  it('starts empty and persists a step at mode 0600', async () => {
    const path = await statePath();
    const launch = store(path);

    expect(await launch.load()).toEqual(emptyLaunchState(() => NOW));

    await launch.record('release:pack', { status: 'succeeded', detail: { digest: 'a'.repeat(64) } });
    const mode = (await stat(path)).mode & 0o777;
    expect(mode.toString(8)).toBe('600');

    const reloaded = await launch.load();
    expect(reloaded.steps['release:pack']).toMatchObject({
      status: 'succeeded',
      detail: { digest: 'a'.repeat(64) },
      updatedAt: new Date(NOW).toISOString(),
    });
  });

  it('tightens a file whose mode drifted', async () => {
    const path = await statePath();
    const launch = store(path);
    await launch.record('release:pack', { status: 'succeeded' });

    const { chmod } = await import('node:fs/promises');
    await chmod(path, 0o644);
    await requirePrivateMode(path);
    expect(((await stat(path)).mode & 0o777).toString(8)).toBe('600');
  });

  it('refuses to persist a secret-shaped value', async () => {
    const path = await statePath();
    const launch = store(path);
    await expect(launch.record('deploy:contracts', {
      status: 'succeeded',
      detail: { signerKey: `0x${'ab'.repeat(32)}` },
    })).rejects.toThrow(/would carry a secret/u);
  });

  it('refuses a state file git tracks', async () => {
    const path = await statePath();
    const launch = store(path, { isTracked: async () => true });
    await expect(launch.record('release:pack', { status: 'succeeded' }))
      .rejects.toThrow(/tracked by git/u);
  });

  it('refuses an unsupported schema version instead of guessing', async () => {
    const path = await statePath();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, JSON.stringify({ version: 99, steps: {} }), { mode: 0o600 });
    await expect(store(path).load()).rejects.toThrow(/version 99 is not supported/u);
  });

  it('reports completed and unresolved steps so a resume can order them', async () => {
    const path = await statePath();
    const launch = store(path);
    await launch.record('release:preflight', { status: 'succeeded' });
    await launch.record('deploy:contracts', { status: 'unknown', note: 'broadcast timed out' });
    await launch.record('hosting:neon', { status: 'failed', note: 'quota' });
    await launch.record('hosting:render', { status: 'pending' });

    expect(await launch.completedSteps()).toEqual(['release:preflight']);
    expect(await launch.unresolvedSteps()).toEqual([
      expect.objectContaining({ name: 'deploy:contracts', note: 'broadcast timed out' }),
    ]);
  });

  it('keeps a step recorded as unknown even after a later attempt succeeds', async () => {
    const path = await statePath();
    const launch = store(path);
    await launch.record('deploy:contracts', { status: 'unknown', note: 'broadcast timed out' });
    await launch.record('deploy:contracts', { status: 'succeeded', detail: { block: 21_000_000 } });

    expect(await launch.unresolvedSteps()).toEqual([]);
    expect((await launch.load()).steps['deploy:contracts']).toMatchObject({
      status: 'succeeded',
      detail: { block: 21_000_000 },
    });
  });
});
