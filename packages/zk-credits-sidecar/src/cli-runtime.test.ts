import { describe, expect, it, vi } from 'vitest';
import {
  runCliCommand,
  type CliCommandDependencies,
} from './cli-runtime.js';

function dependencies(
  overrides: Partial<CliCommandDependencies> = {},
): CliCommandDependencies {
  return {
    loopbackBaseUrl: 'http://127.0.0.1:3210',
    readToken: async () => 'zk-local-token',
    importMnemonic: async () => undefined,
    readMnemonic: async () => '',
    write: () => undefined,
    isIdentityConfigured: async () => true,
    configureCodex: async () => undefined,
    ensureSidecar: async () => 'zk-local-token',
    isCodexProfileInstalled: async () => true,
    isSidecarHealthy: async () => true,
    launchCodex: async () => 0,
    launchCline: async () => 0,
    launchClaude: async () => 0,
    ...overrides,
  };
}

describe('CLI commands', () => {
  it('emits normal OpenAI environment variables from the active local token', async () => {
    const write = vi.fn();

    await runCliCommand(['env'], dependencies({ write }));

    expect(write).toHaveBeenCalledWith(
      'export OPENAI_BASE_URL=http://127.0.0.1:3210/v1\nexport OPENAI_API_KEY=zk-local-token',
    );
  });

  it('imports a non-echoed mnemonic without printing it', async () => {
    const write = vi.fn();
    const mnemonic = 'test only mnemonic that must never be written to output';
    const importMnemonic = vi.fn(async () => undefined);

    await runCliCommand(['import-mnemonic'], dependencies({
      importMnemonic,
      readMnemonic: async () => mnemonic,
      write,
    }));

    expect(importMnemonic).toHaveBeenCalledWith(mnemonic);
    expect(write.mock.calls.flat().join('\n')).not.toContain(mnemonic);
  });

  it('configures Codex and starts the sidecar without reimporting an existing identity', async () => {
    const configureCodex = vi.fn(async () => undefined);
    const ensureSidecar = vi.fn(async () => 'private-token');
    const readMnemonic = vi.fn(async () => 'must not be read');
    const importMnemonic = vi.fn(async () => undefined);
    const write = vi.fn();

    await expect(runCliCommand(
      ['setup', 'codex', '--model', 'openai/test-model'],
      dependencies({ configureCodex, ensureSidecar, readMnemonic, importMnemonic, write }),
    )).resolves.toBe(0);

    expect(configureCodex).toHaveBeenCalledWith('openai/test-model');
    expect(ensureSidecar).toHaveBeenCalledOnce();
    expect(readMnemonic).not.toHaveBeenCalled();
    expect(importMnemonic).not.toHaveBeenCalled();
    expect(write.mock.calls.flat().join('\n')).toContain('Run: zk-credits codex');
    expect(write.mock.calls.flat().join('\n')).not.toContain('private-token');
  });

  it('securely imports a missing identity during Codex setup without printing it', async () => {
    const mnemonic = 'private recovery phrase that must remain hidden';
    const importMnemonic = vi.fn(async () => undefined);
    const write = vi.fn();

    await runCliCommand(['setup', 'codex'], dependencies({
      isIdentityConfigured: async () => false,
      readMnemonic: async () => mnemonic,
      importMnemonic,
      write,
    }));

    expect(importMnemonic).toHaveBeenCalledWith(mnemonic);
    expect(write.mock.calls.flat().join('\n')).not.toContain(mnemonic);
  });

  it('prints exactly the active token for Codex command-backed authentication', async () => {
    const write = vi.fn();

    await runCliCommand(['token'], dependencies({
      ensureSidecar: async () => 'codex-local-token',
      write,
    }));

    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith('codex-local-token');
  });

  it('reports redacted companion status without starting the sidecar', async () => {
    const write = vi.fn();
    const ensureSidecar = vi.fn(async () => 'must-not-be-read');

    await runCliCommand(['status'], dependencies({
      isIdentityConfigured: async () => true,
      isCodexProfileInstalled: async () => true,
      isSidecarHealthy: async () => false,
      ensureSidecar,
      write,
    }));

    expect(write.mock.calls.map(([line]) => line)).toEqual([
      'Identity: configured',
      'Codex profile: installed',
      'Sidecar: stopped',
    ]);
    expect(ensureSidecar).not.toHaveBeenCalled();
  });

  it('starts the sidecar and launches Codex with its profile and original arguments', async () => {
    const ensureSidecar = vi.fn(async () => 'private-token');
    const launchCodex = vi.fn(async () => 17);

    await expect(runCliCommand(
      ['codex', '--cd', '/tmp/project', 'fix the test'],
      dependencies({ ensureSidecar, launchCodex }),
    )).resolves.toBe(17);

    expect(ensureSidecar).toHaveBeenCalledOnce();
    expect(launchCodex).toHaveBeenCalledWith(['--cd', '/tmp/project', 'fix the test']);
  });

  it('requires one-time setup before launching Codex', async () => {
    const ensureSidecar = vi.fn(async () => 'must-not-start');

    await expect(runCliCommand(['codex'], dependencies({
      isCodexProfileInstalled: async () => false,
      ensureSidecar,
    }))).rejects.toThrow('Run zk-credits setup codex first');

    expect(ensureSidecar).not.toHaveBeenCalled();
  });

  it('starts the sidecar and launches Cline with the active local token', async () => {
    const ensureSidecar = vi.fn(async () => 'private-cline-token');
    const launchCline = vi.fn(async () => 19);
    const write = vi.fn();

    await expect(runCliCommand(
      ['cline', '--json', 'explain this repository'],
      dependencies({ ensureSidecar, launchCline, write }),
    )).resolves.toBe(19);

    expect(ensureSidecar).toHaveBeenCalledOnce();
    expect(launchCline).toHaveBeenCalledWith(
      ['--json', 'explain this repository'],
      'private-cline-token',
    );
    expect(write.mock.calls.flat().join('\n')).not.toContain('private-cline-token');
  });

  it('imports a missing identity before the first Cline launch', async () => {
    const mnemonic = 'private recovery phrase that must remain hidden';
    const importMnemonic = vi.fn(async () => undefined);
    const launchCline = vi.fn(async () => 0);
    const write = vi.fn();

    await runCliCommand(['cline', 'hello'], dependencies({
      isIdentityConfigured: async () => false,
      readMnemonic: async () => mnemonic,
      importMnemonic,
      launchCline,
      write,
    }));

    expect(importMnemonic).toHaveBeenCalledWith(mnemonic);
    expect(launchCline).toHaveBeenCalledOnce();
    expect(write.mock.calls.flat().join('\n')).not.toContain(mnemonic);
  });

  it('starts the sidecar and launches Claude with the active local token', async () => {
    const ensureSidecar = vi.fn(async () => 'private-claude-token');
    const launchClaude = vi.fn(async () => 0);
    const write = vi.fn();

    await expect(
      runCliCommand(
        ['claude', '-p', 'explain this repository'],
        dependencies({ ensureSidecar, launchClaude, write }),
      ),
    ).resolves.toBe(0);

    expect(ensureSidecar).toHaveBeenCalledOnce();
    expect(launchClaude).toHaveBeenCalledWith(
      ['-p', 'explain this repository'],
      'private-claude-token',
    );
    expect(write.mock.calls.flat().join('\n')).not.toContain(
      'private-claude-token',
    );
  });

  it('imports a missing identity before the first Claude launch', async () => {
    const mnemonic = 'private recovery phrase that must remain hidden';
    const importMnemonic = vi.fn(async () => undefined);
    const launchClaude = vi.fn(async () => 0);
    const write = vi.fn();

    await runCliCommand(
      ['claude', 'hello'],
      dependencies({
        isIdentityConfigured: async () => false,
        readMnemonic: async () => mnemonic,
        importMnemonic,
        launchClaude,
        write,
      }),
    );

    expect(importMnemonic).toHaveBeenCalledWith(mnemonic);
    expect(launchClaude).toHaveBeenCalledOnce();
    expect(write.mock.calls.flat().join('\n')).not.toContain(mnemonic);
  });
});
