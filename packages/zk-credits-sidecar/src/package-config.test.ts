import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('sidecar package distribution', () => {
  it('builds a standalone executable without a checkout-local runtime dependency', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      bin?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      engines?: Record<string, string>;
      scripts?: Record<string, string>;
    };

    expect(packageJson.bin?.['zk-credits']).toBe('dist/zk-credits.js');
    expect(packageJson.dependencies?.['@zk-credits/shared']).toBeUndefined();
    expect(packageJson.devDependencies?.['@zk-credits/shared']).toBe('file:../zk-credits-shared');
    expect(packageJson.scripts?.build).toContain('scripts/bundle.mjs');
    expect(packageJson.scripts?.start).toBe('node dist/zk-credits.js');
    expect(packageJson.engines?.node).toBe('>=20');
  });
});
