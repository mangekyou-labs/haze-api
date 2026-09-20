import { describe, expect, it, vi } from 'vitest';
import { runCliCommand, type CliCommandDependencies } from './cli-runtime.js';

function dependencies(overrides: Partial<CliCommandDependencies> = {}): CliCommandDependencies {
  return {
    loopbackBaseUrl: 'http://127.0.0.1:3210',
    readToken: async () => 'zk-local-token',
    write: () => undefined,
    isCredentialConfigured: async () => true,
    configureCodex: async () => undefined,
    ensureSidecar: async () => 'zk-local-token',
    isCodexProfileInstalled: async () => true,
    isSidecarHealthy: async () => true,
    launchCodex: async () => 0,
    launchCline: async () => 0,
    ...overrides,
  };
}

describe('CLI commands', () => {
  it('emits local OpenAI environment variables without exposing credential material', async () => {
    const write = vi.fn();
    await runCliCommand(['env'], dependencies({ write }));
    expect(write).toHaveBeenCalledWith(
      'export OPENAI_BASE_URL=http://127.0.0.1:3210/v1\nexport OPENAI_API_KEY=zk-local-token',
    );
  });

  it('requires an encrypted credential export before setup', async () => {
    await expect(runCliCommand(['setup', 'codex'], dependencies({ isCredentialConfigured: async () => false })))
      .rejects.toThrow('ZK_CREDITS_CREDENTIAL_PATH');
  });

  it('configures Codex and starts the sidecar with a configured export', async () => {
    const configureCodex = vi.fn(async () => undefined);
    const ensureSidecar = vi.fn(async () => 'private-token');
    const write = vi.fn();
    await expect(runCliCommand(
      ['setup', 'codex', '--model', 'openai/test-model'],
      dependencies({ configureCodex, ensureSidecar, write }),
    )).resolves.toBe(0);
    expect(configureCodex).toHaveBeenCalledWith('openai/test-model');
    expect(ensureSidecar).toHaveBeenCalledOnce();
    expect(write.mock.calls.flat().join('\n')).toContain('Run: zk-credits codex');
    expect(write.mock.calls.flat().join('\n')).not.toContain('private-token');
  });

  it('reports credential and sidecar state without starting the sidecar', async () => {
    const write = vi.fn();
    const ensureSidecar = vi.fn(async () => 'must-not-be-read');
    await runCliCommand(['status'], dependencies({
      write,
      isCredentialConfigured: async () => true,
      isCodexProfileInstalled: async () => true,
      isSidecarHealthy: async () => false,
      ensureSidecar,
    }));
    expect(write.mock.calls.map(([line]) => line)).toEqual([
      'Credential export: configured',
      'Codex profile: installed',
      'Sidecar: stopped',
    ]);
    expect(ensureSidecar).not.toHaveBeenCalled();
  });

  it('requires a credential export before companion launch', async () => {
    const ensureSidecar = vi.fn(async () => 'must-not-start');
    await expect(runCliCommand(['cline'], dependencies({
      isCredentialConfigured: async () => false,
      ensureSidecar,
    }))).rejects.toThrow('ZK_CREDITS_CREDENTIAL_PATH');
    expect(ensureSidecar).not.toHaveBeenCalled();
  });

  it('no longer advertises an Anthropic companion command', async () => {
    await expect(runCliCommand(['claude'], dependencies())).rejects.toThrow(
      'Usage: zk-credits <cline|setup codex|codex|status|token|serve|env>',
    );
  });
});
