import { describe, expect, it, vi } from 'vitest';
import { runCliCommand } from './cli-runtime.js';

describe('CLI commands', () => {
  it('emits normal OpenAI environment variables from the active local token', async () => {
    const write = vi.fn();

    await runCliCommand(['env'], {
      loopbackBaseUrl: 'http://127.0.0.1:3210',
      readToken: async () => 'zk-local-token',
      importMnemonic: async () => undefined,
      readMnemonic: async () => '',
      write,
    });

    expect(write).toHaveBeenCalledWith(
      'export OPENAI_BASE_URL=http://127.0.0.1:3210/v1\nexport OPENAI_API_KEY=zk-local-token',
    );
  });

  it('imports a non-echoed mnemonic without printing it', async () => {
    const write = vi.fn();
    const mnemonic = 'test only mnemonic that must never be written to output';
    const importMnemonic = vi.fn(async () => undefined);

    await runCliCommand(['import-mnemonic'], {
      loopbackBaseUrl: 'http://127.0.0.1:3210',
      readToken: async () => 'unused',
      importMnemonic,
      readMnemonic: async () => mnemonic,
      write,
    });

    expect(importMnemonic).toHaveBeenCalledWith(mnemonic);
    expect(write.mock.calls.flat().join('\n')).not.toContain(mnemonic);
  });
});
