import { describe, expect, it, vi } from 'vitest';
import { runCliCommand, type CliCommandDependencies } from './cli-runtime.js';

function dependencies(overrides: Partial<CliCommandDependencies> = {}): CliCommandDependencies {
  return {
    loopbackBaseUrl: 'http://127.0.0.1:3210',
    readToken: async () => 'zk-local-token',
    write: () => undefined,
    isCredentialConfigured: async () => true,
    validateSetupPrerequisites: async () => undefined,
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

  it('does not leave Codex configured when the sidecar cannot start', async () => {
    const events: string[] = [];
    await expect(runCliCommand(['setup', 'codex'], dependencies({
      configureCodex: async () => { events.push('configure-codex'); },
      ensureSidecar: async () => {
        events.push('start-sidecar');
        throw new Error('sidecar failed to start');
      },
    }))).rejects.toThrow('sidecar failed to start');
    expect(events).toEqual(['start-sidecar']);
  });

  it('reports missing local proving inputs before starting the sidecar', async () => {
    const ensureSidecar = vi.fn(async () => 'must-not-start');
    const configureCodex = vi.fn(async () => undefined);
    await expect(runCliCommand(['setup', 'codex'], dependencies({
      validateSetupPrerequisites: async () => {
        throw new Error('Get the pinned proving bundle from your pilot contact, then set ZK_CREDITS_ARTIFACT_DIR.');
      },
      ensureSidecar,
      configureCodex,
    }))).rejects.toThrow('Get the pinned proving bundle from your pilot contact');
    expect(ensureSidecar).not.toHaveBeenCalled();
    expect(configureCodex).not.toHaveBeenCalled();
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
