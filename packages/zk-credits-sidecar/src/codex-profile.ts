import { randomBytes } from 'node:crypto';
import { chmod, mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const CODEX_PROFILE_NAME = 'zk-credits';
export const DEFAULT_CODEX_MODEL = 'openai/gpt-4o-mini';

export interface CodexProfileOptions {
  loopbackBaseUrl: string;
  model?: string;
}

export interface WriteCodexProfileOptions extends CodexProfileOptions {
  codexHome: string;
}

export function resolveCodexHome(
  environment: NodeJS.ProcessEnv,
  userHome: string,
): string {
  return environment.CODEX_HOME || join(userHome, '.codex');
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function providerBaseUrl(loopbackBaseUrl: string): string {
  const url = new URL(loopbackBaseUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    throw new Error('Codex provider must use a 127.0.0.1 HTTP sidecar URL');
  }
  return `${url.origin}/v1`;
}

export function codexProfilePath(codexHome: string): string {
  return join(codexHome, `${CODEX_PROFILE_NAME}.config.toml`);
}

export function renderCodexProfile(options: CodexProfileOptions): string {
  const model = options.model?.trim() || DEFAULT_CODEX_MODEL;
  return [
    `model = ${tomlString(model)}`,
    'model_provider = "zk_credits"',
    '',
    '[model_providers.zk_credits]',
    'name = "ZK Credits"',
    `base_url = ${tomlString(providerBaseUrl(options.loopbackBaseUrl))}`,
    'wire_api = "responses"',
    '',
    '[model_providers.zk_credits.auth]',
    'command = "zk-credits"',
    'args = ["token"]',
    'refresh_interval_ms = 0',
    '',
  ].join('\n');
}

export async function writeCodexProfile(options: WriteCodexProfileOptions): Promise<string> {
  await mkdir(options.codexHome, { recursive: true, mode: 0o700 });
  const profilePath = codexProfilePath(options.codexHome);
  const temporaryPath = `${profilePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporaryPath, renderCodexProfile(options), { encoding: 'utf8', mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, profilePath);
  await chmod(profilePath, 0o600);
  return profilePath;
}

export async function isCodexProfileInstalled(codexHome: string): Promise<boolean> {
  try {
    return (await stat(codexProfilePath(codexHome))).isFile();
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
