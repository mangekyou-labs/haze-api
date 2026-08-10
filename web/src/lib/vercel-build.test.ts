import path from 'node:path';
import packageJson from '../../package.json';
import { describe, expect, it } from 'vitest';

describe('Vercel build configuration', () => {
  it('materializes the linked shared package before the Vercel build', () => {
    expect(packageJson.scripts.prebuild).toContain('prepare-shared-package.mjs');
    expect(path.resolve(process.cwd(), '../packages/zk-credits-shared')).toContain(
      'packages/zk-credits-shared',
    );
  });
});
