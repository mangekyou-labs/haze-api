import { spawn } from 'node:child_process';
import { CODEX_PROFILE_NAME } from './codex-profile.js';

interface SpawnedProcess {
  once(event: 'error', listener: (error: NodeJS.ErrnoException) => void): this;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}

export type SpawnCommand = (
  command: string,
  args: readonly string[],
  options: { stdio: 'inherit' },
) => SpawnedProcess;

const spawnCommand: SpawnCommand = (command, args, options) => spawn(command, args, options);

/** Launches interactive Codex with the isolated ZK Credits provider profile. */
export async function launchCodexProcess(
  args: readonly string[],
  spawnImpl: SpawnCommand = spawnCommand,
): Promise<number> {
  const child = spawnImpl('codex', ['--profile', CODEX_PROFILE_NAME, ...args], { stdio: 'inherit' });
  return new Promise<number>((resolve, reject) => {
    child.once('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(new Error('Codex CLI was not found; install it before running zk-credits codex'));
        return;
      }
      reject(error);
    });
    child.once('exit', (code) => resolve(code ?? 1));
  });
}
