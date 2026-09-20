import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('sidecar package distribution', () => {
  it('builds a standalone executable without a checkout-local runtime dependency', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      name?: string;
      bin?: Record<string, string>;
      exports?: Record<string, { types: string; import: string }>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      engines?: Record<string, string>;
      scripts?: Record<string, string>;
    };

    expect(packageJson.name).toBe('zk-credits');
    expect(packageJson.bin?.['zk-credits']).toBe('dist/zk-credits.js');
    expect(packageJson.exports?.['./codex']).toEqual({
      types: './dist/codex-sdk-options.d.ts',
      import: './dist/codex-sdk-options.js',
    });
    expect(packageJson.dependencies).toMatchObject({
      '@zk-credits/shared': 'file:../zk-credits-shared',
      '@zk-credits/x402-zk-prepaid': 'file:../x402-zk-prepaid',
      snarkjs: expect.any(String),
    });
    expect(packageJson.dependencies).not.toHaveProperty('@scure/bip39');
    expect(packageJson.dependencies).not.toHaveProperty('circomlibjs');
    expect(packageJson.dependencies).not.toHaveProperty('keytar');
    expect(packageJson.devDependencies?.['@zk-credits/shared']).toBeUndefined();
    expect(packageJson.scripts?.build).toContain('scripts/bundle.mjs');
    expect(packageJson.scripts?.start).toBe('node dist/zk-credits.js');
    expect(packageJson.engines?.node).toBe('>=20');
  });
});
