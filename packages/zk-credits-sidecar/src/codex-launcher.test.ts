import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { launchCodexProcess, type SpawnCommand } from './codex-launcher.js';

describe('Codex launcher', () => {
  it('uses the managed profile, preserves arguments, and returns the Codex exit code', async () => {
    const child = new EventEmitter();
    const spawn = vi.fn(() => child) as unknown as SpawnCommand;

    const result = launchCodexProcess(
      ['--cd', '/tmp/project', 'fix the tests'],
      spawn,
    );
    queueMicrotask(() => child.emit('exit', 17, null));

    await expect(result).resolves.toBe(17);
    expect(spawn).toHaveBeenCalledWith(
      'codex',
      ['--profile', 'zk-credits', '--cd', '/tmp/project', 'fix the tests'],
      { stdio: 'inherit' },
    );
  });

  it('reports a missing Codex executable with installation guidance', async () => {
    const child = new EventEmitter();
    const spawn = vi.fn(() => child) as unknown as SpawnCommand;

    const result = launchCodexProcess([], spawn);
    queueMicrotask(() => {
      const error = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
      child.emit('error', error);
    });

    await expect(result).rejects.toThrow('Codex CLI was not found; install it before running zk-credits codex');
  });
});
