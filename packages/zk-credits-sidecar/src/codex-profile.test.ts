import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  codexModelsResponse,
  codexProfilePath,
  isCodexProfileInstalled,
  renderCodexProfile,
  resolveCodexHome,
  writeCodexProfile,
} from './codex-profile.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

async function temporaryCodexHome(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'zk-credits-codex-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('Codex profile configuration', () => {
  it('does not advertise parallel tool calls for the pinned provider route', () => {
    expect(codexModelsResponse()).toMatchObject({
      models: [{ supports_parallel_tool_calls: false }],
    });
  });

  it('uses CODEX_HOME when set and otherwise follows the user home', () => {
    expect(resolveCodexHome({ CODEX_HOME: '/private/codex' }, '/Users/test')).toBe('/private/codex');
    expect(resolveCodexHome({}, '/Users/test')).toBe('/Users/test/.codex');
  });

  it('renders a Responses provider with command-backed auth and no bearer', () => {
    const profile = renderCodexProfile({
      loopbackBaseUrl: 'http://127.0.0.1:4567',
      model: 'openai/test-model',
    });

    expect(profile).toContain('model = "openai/test-model"');
    expect(profile).toContain('model_provider = "zk_credits"');
    expect(profile).toContain('base_url = "http://127.0.0.1:4567/v1"');
    expect(profile).toContain('wire_api = "responses"');
    expect(profile).toContain('command = "zk-credits"');
    expect(profile).toContain('args = ["token"]');
    expect(profile).not.toContain('zk-local-secret');
    expect(profile).not.toContain('experimental_bearer_token');
  });

  it('writes only the managed profile with owner-only permissions', async () => {
    const codexHome = await temporaryCodexHome();
    const baseConfigPath = join(codexHome, 'config.toml');
    await writeFile(baseConfigPath, 'model = "existing-model"\n', 'utf8');

    const profilePath = await writeCodexProfile({
      codexHome,
      loopbackBaseUrl: 'http://127.0.0.1:3210',
      model: 'openai/gpt-4o-mini',
    });

    expect(profilePath).toBe(codexProfilePath(codexHome));
    expect(await readFile(baseConfigPath, 'utf8')).toBe('model = "existing-model"\n');
    expect((await stat(profilePath)).mode & 0o777).toBe(0o600);
    await expect(isCodexProfileInstalled(codexHome)).resolves.toBe(true);
  });

  it('writes a profile that overrides a user reasoning default for the supported model', async () => {
    const codexHome = await temporaryCodexHome();
    await writeFile(join(codexHome, 'config.toml'), 'model_reasoning_effort = "medium"\n');

    const profilePath = await writeCodexProfile({
      codexHome,
      loopbackBaseUrl: 'http://127.0.0.1:3210',
    });

    expect(await readFile(profilePath, 'utf8')).toContain('model_reasoning_effort = "none"');
  });
});
