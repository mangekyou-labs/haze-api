import { spawn } from 'node:child_process';
import { chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_CLINE_MODEL = 'openai/gpt-4o-mini';

interface SpawnedProcess {
  once(event: 'error', listener: (error: NodeJS.ErrnoException) => void): this;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}

type ClineStdio = 'inherit' | ['ignore', 'ignore', 'inherit'];

export type ClineSpawnCommand = (
  command: string,
  args: readonly string[],
  options: { stdio: ClineStdio; env: NodeJS.ProcessEnv },
) => SpawnedProcess;

export interface LaunchClineOptions {
  args: readonly string[];
  loopbackBaseUrl: string;
  localToken: string;
  stateDirectory: string;
}

const spawnCommand: ClineSpawnCommand = (command, args, options) => spawn(command, [...args], options);

function openAiBaseUrl(loopbackBaseUrl: string): string {
  const url = new URL(loopbackBaseUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    throw new Error('Cline companion must use a 127.0.0.1 HTTP sidecar URL');
  }
  return `${url.origin}/v1`;
}

function selectedModel(args: readonly string[]): string {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--model' || argument === '-m') {
      const model = args[index + 1]?.trim();
      if (!model) throw new Error(`${argument} requires a model ID`);
      return model;
    }
    if (argument?.startsWith('--model=')) {
      const model = argument.slice('--model='.length).trim();
      if (!model) throw new Error('--model requires a model ID');
      return model;
    }
  }
  return DEFAULT_CLINE_MODEL;
}

function assertManagedProviderArguments(args: readonly string[]): void {
  const managed = new Set(['--provider', '-P', '--key', '-k', '--config', '--data-dir']);
  if (args.some((argument) => managed.has(argument) || argument.startsWith('--provider='))) {
    throw new Error('zk-credits cline manages the provider, API key, and profile directory');
  }
}

function waitForCline(child: SpawnedProcess): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    child.once('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(new Error('Cline CLI was not found; install it with npm install --global cline'));
        return;
      }
      reject(error);
    });
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

/** Configures and launches Cline against the proof-aware loopback transport. */
export async function launchClineProcess(
  options: LaunchClineOptions,
  spawnImpl: ClineSpawnCommand = spawnCommand,
): Promise<number> {
  assertManagedProviderArguments(options.args);
  const baseUrl = openAiBaseUrl(options.loopbackBaseUrl);
  const model = selectedModel(options.args);
  const dataDirectory = join(options.stateDirectory, 'cline');
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  await chmod(dataDirectory, 0o700);

  const environment = {
    ...process.env,
    OPENAI_BASE_URL: baseUrl,
    OPENAI_API_KEY: options.localToken,
  };
  const authCode = await waitForCline(spawnImpl('cline', [
    'auth',
    '--provider', 'openai-compatible',
    '--apikey', options.localToken,
    '--modelid', model,
    '--baseurl', baseUrl,
    '--data-dir', dataDirectory,
  ], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: environment,
  }));
  if (authCode !== 0) {
    throw new Error(`Cline OpenAI-compatible provider setup failed with exit code ${authCode}`);
  }

  return waitForCline(spawnImpl('cline', [
    '--provider', 'openai-compatible',
    '--model', model,
    '--data-dir', dataDirectory,
    ...options.args,
  ], {
    stdio: 'inherit',
    env: environment,
  }));
}
