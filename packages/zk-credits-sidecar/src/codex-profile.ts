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

/** Returns the Codex-specific model catalog served by its `/v1/models` probe. */
export function codexModelsResponse(): object {
  return {
    models: [{
      slug: DEFAULT_CODEX_MODEL,
      display_name: 'GPT-4o Mini (ZK Credits)',
      description: 'OpenRouter coding model paid with private ZK Credits tickets.',
      default_reasoning_level: null,
      supported_reasoning_levels: [],
      shell_type: 'shell_command',
      visibility: 'list',
      supported_in_api: true,
      priority: 1,
      additional_speed_tiers: [],
      service_tiers: [],
      default_service_tier: null,
      availability_nux: null,
      upgrade: null,
      base_instructions: [
        'You are Codex, a coding agent. Follow the user\'s instructions carefully.',
        'Use the provided tools when needed, preserve existing work, and verify changes before claiming completion.',
      ].join(' '),
      include_skills_usage_instructions: true,
      include_plugin_usage_instructions: true,
      include_apps_usage_instructions: true,
      supports_reasoning_summary_parameter: false,
      default_reasoning_summary: 'none',
      support_verbosity: false,
      default_verbosity: null,
      apply_patch_tool_type: 'freeform',
      web_search_tool_type: 'text',
      truncation_policy: { mode: 'tokens', limit: 10_000 },
      supports_parallel_tool_calls: true,
      supports_image_detail_original: false,
      context_window: 128_000,
      max_context_window: 128_000,
      experimental_supported_tools: [],
      input_modalities: ['text', 'image'],
      supports_search_tool: false,
      use_responses_lite: false,
      tool_mode: 'direct',
    }],
  };
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
