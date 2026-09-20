import path from 'node:path';
import fs from 'node:fs';
import packageJson from '../../package.json';
import { describe, expect, it } from 'vitest';

describe('Vercel build configuration', () => {
  it('materializes the linked shared package before the Vercel build', () => {
    expect(packageJson.scripts.prebuild).toContain('prepare-shared-package.mjs');
    expect(path.resolve(process.cwd(), '../packages/zk-credits-shared')).toContain(
      'packages/zk-credits-shared',
    );
    const materializer = fs.readFileSync(
      path.resolve(process.cwd(), 'scripts/prepare-shared-package.mjs'),
      'utf8',
    );
    expect(materializer.indexOf("'../packages/zk-credits-shared'")).toBeLessThan(
      materializer.indexOf("'vendor/zk-credits-shared'"),
    );
  });

  it('keeps production typography offline-safe', () => {
    const layout = fs.readFileSync(path.resolve(process.cwd(), 'src/app/layout.tsx'), 'utf8');
    expect(layout).not.toContain("next/font/google");
  });

  it('declares the shared browser crypto runtime dependencies directly', () => {
    const dependencies = {
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {}),
    };
    expect(dependencies.circomlibjs).toBeTruthy();
  });

  it('vendors the active Base credential export for isolated builds', () => {
    const sharedIndex = fs.readFileSync(
      path.resolve(process.cwd(), 'vendor/zk-credits-shared/dist/index.js'),
      'utf8',
    );
    expect(sharedIndex).toContain('computeCommitment');
    expect(sharedIndex).toContain('decryptAnyCredentialExport');
    expect(sharedIndex).not.toContain('generateMembershipRemovalProofSelfVerified');
  });

  it('keeps the Vercel output directory out of lint', () => {
    const eslintConfig = fs.readFileSync(path.resolve(process.cwd(), 'eslint.config.mjs'), 'utf8');
    expect(eslintConfig).toContain('.vercel/**');
  });
});
