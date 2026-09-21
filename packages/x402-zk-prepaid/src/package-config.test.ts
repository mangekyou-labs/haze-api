import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('adapter package distribution', () => {
  it('never publishes test sources or compiled tests', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      name?: string;
      version?: string;
      files?: string[];
      exports?: Record<string, { types: string; import: string }>;
      peerDependencies?: Record<string, string>;
    };
    const tsconfig = JSON.parse(await readFile(new URL('../tsconfig.json', import.meta.url), 'utf8')) as {
      exclude?: string[];
    };

    expect(packageJson.name).toBe('@zk-credits/x402-zk-prepaid');
    expect(packageJson.version).toBe('0.1.0');
    expect(packageJson.exports?.['.']).toEqual({
      types: './dist/index.d.ts',
      import: './dist/index.js',
      default: './dist/index.js',
    });
    expect(packageJson.peerDependencies?.['@x402/core']).toBe('^2.26.0');

    // The published surface is dist + src with every test artifact excluded,
    // and the build must not emit a compiled test into dist in the first place.
    expect(packageJson.files).toContain('!dist/**/*.test.*');
    expect(packageJson.files).toContain('!src/**/*.test.ts');
    expect(tsconfig.exclude).toContain('**/*.test.ts');
  });
});
