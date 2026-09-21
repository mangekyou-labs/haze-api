/**
 * npm release sequencing.
 *
 * A published version is permanent, so the assertions here are all about
 * refusing to publish: an existing version whose contents differ, a dirty or
 * unpushed tree, and a rewrite that would have to guess a version. The order
 * matters too — the sidecar cannot publish before its dependencies resolve.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { PINNED_ACTIVATION_VERSIONS } from '../activation-evidence.js';
import {
  LEAF_RELEASE_PACKAGES,
  RELEASE_PACKAGES,
  SIDECAR_RELEASE_PACKAGE,
  assertReleaseReady,
  assertVersionMatchesArtifact,
  isDependencyOnlyChange,
  packContentDigest,
  parsePackOutput,
  publishPlan,
  rewriteSidecarDependencies,
} from './release.js';

const PACK_JSON = JSON.stringify([
  {
    filename: 'zk-credits-0.2.0.tgz',
    files: [
      { path: 'package.json', size: 1_200 },
      { path: 'dist/zk-credits.js', size: 40_000, integrity: 'sha512-abc' },
      { path: 'circuits/manifest.json', size: 900 },
    ],
  },
]);

describe('the release set', () => {
  it('pins the three packages to the versions the evidence pins', () => {
    expect(RELEASE_PACKAGES.map((entry) => `${entry.name}@${entry.version}`)).toEqual([
      `@zk-credits/shared@${PINNED_ACTIVATION_VERSIONS.shared}`,
      `@zk-credits/x402-zk-prepaid@${PINNED_ACTIVATION_VERSIONS.adapter}`,
      `zk-credits@${PINNED_ACTIVATION_VERSIONS.sidecar}`,
    ]);
  });

  it('publishes the sidecar last, after its dependencies resolve from the registry', () => {
    const plan = publishPlan();
    const order = plan.map((step) => step.kind);
    const sidecarPublish = step2Index(plan, SIDECAR_RELEASE_PACKAGE.name);

    expect(order.indexOf('rewrite-dependencies')).toBeGreaterThan(step2Index(plan, '@zk-credits/shared'));
    expect(step2Index(plan, '@zk-credits/x402-zk-prepaid')).toBeLessThan(order.indexOf('rewrite-dependencies'));
    expect(order.indexOf('commit-and-push')).toBeLessThan(sidecarPublish);
    expect(order.indexOf('verify-tarball-install')).toBeLessThan(sidecarPublish);
    expect(plan.at(-1)?.package?.name).toBe(SIDECAR_RELEASE_PACKAGE.name);
  });

  function step2Index(plan: ReturnType<typeof publishPlan>, name: string): number {
    return plan.findIndex((step) => step.package?.name === name);
  }

  it('names a new package as a direct first publish, since only existing packages can be staged', () => {
    const shared = publishPlan().find((step) => step.package?.name === '@zk-credits/shared');
    expect(shared?.description).toMatch(/new package cannot be staged/u);
  });
});

describe('packed contents', () => {
  it('sorts the packed file list so two machines agree on the digest', () => {
    const [report] = parsePackOutput(PACK_JSON);
    expect(report!.files.map((file) => file.path)).toEqual([
      'circuits/manifest.json',
      'dist/zk-credits.js',
      'package.json',
    ]);
  });

  it('changes the digest when a file is added, removed, or resized', () => {
    const [report] = parsePackOutput(PACK_JSON);
    const baseline = packContentDigest(report!);

    const added = parsePackOutput(JSON.stringify([{
      filename: 'zk-credits-0.2.0.tgz',
      files: [...report!.files, { path: 'dist/extra.js', size: 1 }],
    }]))[0]!;
    expect(packContentDigest(added)).not.toBe(baseline);

    const resized = parsePackOutput(JSON.stringify([{
      filename: 'zk-credits-0.2.0.tgz',
      files: report!.files.map((file) => (file.path === 'package.json' ? { ...file, size: 1_201 } : file)),
    }]))[0]!;
    expect(packContentDigest(resized)).not.toBe(baseline);

    // The same contents in a different order must still digest the same.
    const reordered = parsePackOutput(JSON.stringify([{
      filename: 'zk-credits-0.2.0.tgz',
      files: [...report!.files].reverse(),
    }]))[0]!;
    expect(packContentDigest(reordered)).toBe(baseline);
  });

  it('refuses malformed pack output rather than hashing an empty list', () => {
    expect(() => parsePackOutput('{}')).toThrow(/did not report an array/u);
    expect(() => parsePackOutput('[{"files":[]}]')).toThrow(/has no filename/u);
    expect(() => parsePackOutput('[{"filename":"x.tgz"}]')).toThrow(/has no file list/u);
    expect(() => parsePackOutput('[{"filename":"x.tgz","files":[{}]}]')).toThrow(/file with no path/u);
  });
});

describe('an already-published version', () => {
  it('is accepted when its contents match the artifact', () => {
    expect(() => assertVersionMatchesArtifact({
      name: 'zk-credits',
      version: '0.2.0',
      publishedDigest: 'same',
      expectedDigest: 'same',
    })).not.toThrow();
  });

  it('stops the release when its contents differ', () => {
    expect(() => assertVersionMatchesArtifact({
      name: 'zk-credits',
      version: '0.2.0',
      publishedDigest: 'published',
      expectedDigest: 'expected',
    })).toThrow(/already published with different contents .*bump the version instead of republishing/u);
  });

  it('is treated as a first publish when the registry reports no digest', () => {
    expect(() => assertVersionMatchesArtifact({
      name: 'zk-credits',
      version: '0.2.0',
      publishedDigest: null,
      expectedDigest: 'expected',
    })).not.toThrow();
  });
});

describe('the sidecar dependency rewrite', () => {
  const manifest = {
    name: 'zk-credits',
    version: '0.2.0',
    dependencies: {
      '@zk-credits/shared': 'file:../zk-credits-shared',
      '@zk-credits/x402-zk-prepaid': 'file:../x402-zk-prepaid',
      snarkjs: '^0.7.6',
    },
  };

  it('replaces local paths with the exact pinned versions and leaves the rest alone', () => {
    const { manifest: rewritten, changed } = rewriteSidecarDependencies(manifest);
    expect(rewritten.dependencies).toEqual({
      '@zk-credits/shared': '0.1.0',
      '@zk-credits/x402-zk-prepaid': '0.1.0',
      snarkjs: '^0.7.6',
    });
    expect(changed).toEqual([
      { name: '@zk-credits/shared', from: 'file:../zk-credits-shared', to: '0.1.0' },
      { name: '@zk-credits/x402-zk-prepaid', from: 'file:../x402-zk-prepaid', to: '0.1.0' },
    ]);
    // The original manifest is not mutated.
    expect(manifest.dependencies['@zk-credits/shared']).toBe('file:../zk-credits-shared');
  });

  it('is idempotent, so a resumed release does not rewrite again', () => {
    const once = rewriteSidecarDependencies(manifest).manifest;
    expect(rewriteSidecarDependencies(once).changed).toEqual([]);
  });

  it('refuses to invent a version for a dependency it does not know', () => {
    expect(() => rewriteSidecarDependencies(manifest, { '@zk-credits/shared': '0.1.0' }))
      .toThrow(/no pinned registry version is known for @zk-credits\/x402-zk-prepaid/u);
  });

  it('refuses when the dependency is no longer declared', () => {
    expect(() => rewriteSidecarDependencies({ dependencies: {} }))
      .toThrow(/is not a declared dependency of the sidecar/u);
  });
});

describe('the dependency-only commit', () => {
  it('accepts a commit that touched only the sidecar manifest and lockfile', () => {
    expect(isDependencyOnlyChange([
      'packages/zk-credits-sidecar/package.json',
      'packages/zk-credits-sidecar/package-lock.json',
    ])).toBe(true);
  });

  it('refuses a commit that carried anything else along', () => {
    expect(isDependencyOnlyChange(['packages/zk-credits-sidecar/package.json', 'ts/server.ts'])).toBe(false);
    expect(isDependencyOnlyChange([])).toBe(false);
  });
});

describe('the release gate', () => {
  const clean = { dirtyPaths: [], pushed: true, branch: 'feature-base-zk-credits', headCommit: 'a'.repeat(40) };

  it('passes only for a clean, pushed, reviewed commit', () => {
    expect(assertReleaseReady(clean, { reviewed: true })).toEqual({ ok: true, reasons: [] });
  });

  it('lists every reason it refuses', () => {
    const gate = assertReleaseReady({ ...clean, dirtyPaths: ['ts/server.ts'], pushed: false });
    expect(gate.ok).toBe(false);
    expect(gate.reasons).toEqual([
      'the working tree has uncommitted changes: ts/server.ts',
      `the commit ${clean.headCommit} has not been pushed`,
      'the commit has not been confirmed as reviewed',
    ]);
  });

  it('refuses an unreadable head commit', () => {
    expect(assertReleaseReady({ ...clean, headCommit: '' }, { reviewed: true }).reasons)
      .toEqual(['the head commit is unreadable']);
  });

  it('covers every published package in the leaf-first group', () => {
    expect(LEAF_RELEASE_PACKAGES.map((entry) => entry.name)).toEqual([
      '@zk-credits/shared',
      '@zk-credits/x402-zk-prepaid',
    ]);
  });
});
