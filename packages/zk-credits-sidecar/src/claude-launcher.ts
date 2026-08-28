import { spawn } from 'node:child_process';
import { chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

interface SpawnedProcess {
  once(event: 'error', listener: (error: NodeJS.ErrnoException) => void): this;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}

export type ClaudeSpawnCommand = (
  command: string,
  args: readonly string[],
  options: { stdio: 'inherit'; env: NodeJS.ProcessEnv },
) => SpawnedProcess;

export interface LaunchClaudeOptions {
  args: readonly string[];
  loopbackBaseUrl: string;
  localToken: string;
  stateDirectory: string;
}

const spawnCommand: ClaudeSpawnCommand = (command, args, options) =>
  spawn(command, [...args], options);

function anthropicBaseUrl(loopbackBaseUrl: string): string {
  const url = new URL(loopbackBaseUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    throw new Error('Claude Code companion must use a 127.0.0.1 HTTP sidecar URL');
  }
  // Claude Code appends /v1/messages, so base URL must NOT have trailing /v1
  return url.origin;
}

async function prepareClaudeDirectory(stateDirectory: string): Promise<string> {
  const configDirectory = join(stateDirectory, 'claude');
  await mkdir(configDirectory, { recursive: true, mode: 0o700 });
  await chmod(configDirectory, 0o700);
  return configDirectory;
}

function waitForClaude(child: SpawnedProcess): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    child.once('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(
          new Error(
            'Claude Code CLI was not found; install it with npm install -g @anthropic-ai/claude-code before running zk-credits claude',
          ),
        );
        return;
      }
      reject(error);
    });
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

/** Configures and launches Claude Code against the proof-aware loopback transport. */
export async function launchClaudeProcess(
  options: LaunchClaudeOptions,
  spawnImpl: ClaudeSpawnCommand = spawnCommand,
): Promise<number> {
  const configDirectory = await prepareClaudeDirectory(options.stateDirectory);
  const baseUrl = anthropicBaseUrl(options.loopbackBaseUrl);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_CONFIG_DIR: configDirectory,
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: options.localToken,
    DISABLE_TELEMETRY: '1',
  };

  const child = spawnImpl('claude', [...options.args], {
    stdio: 'inherit',
    env,
  });

  return waitForClaude(child);
}
