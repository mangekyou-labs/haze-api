/**
 * The npm release sequence, expressed as checks rather than as prose.
 *
 * A published version is permanent, so the sequence is ordered so that the one
 * irreversible step per package happens only after everything reversible has
 * already passed:
 *
 *   1. the working tree is clean, the commit is pushed, and the packed contents
 *      hash to what the release expects;
 *   2. the two leaf packages publish first, because they have no local
 *      dependencies;
 *   3. only then may the sidecar's checkout-local `file:` dependencies be
 *      replaced with the exact published versions, because before the leaves
 *      are public those versions do not resolve;
 *   4. the dependency-only change is committed, pushed, and re-verified; and
 *   5. the sidecar publishes last.
 *
 * An existing registry version is never republished. New packages cannot be
 * staged either: npm staged publishing only supports packages that already
 * exist, so the first publish is direct.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createHash } from 'node:crypto';
import { PINNED_ACTIVATION_VERSIONS } from '../activation-evidence.js';

export interface ReleasePackage {
  /** Directory in the repository. */
  directory: string;
  /** Published name. */
  name: string;
  version: string;
}

/** The two leaves, then the sidecar that depends on them. */
export const LEAF_RELEASE_PACKAGES: readonly ReleasePackage[] = [
  { directory: 'packages/zk-credits-shared', name: '@zk-credits/shared', version: PINNED_ACTIVATION_VERSIONS.shared },
  { directory: 'packages/x402-zk-prepaid', name: '@zk-credits/x402-zk-prepaid', version: PINNED_ACTIVATION_VERSIONS.adapter },
];

export const SIDECAR_RELEASE_PACKAGE: ReleasePackage = {
  directory: 'packages/zk-credits-sidecar',
  name: 'zk-credits',
  version: PINNED_ACTIVATION_VERSIONS.sidecar,
};

export const RELEASE_PACKAGES: readonly ReleasePackage[] = [...LEAF_RELEASE_PACKAGES, SIDECAR_RELEASE_PACKAGE];

/** The sidecar's checkout-local runtime dependencies. */
export const SIDECAR_LOCAL_DEPENDENCIES = ['@zk-credits/shared', '@zk-credits/x402-zk-prepaid'] as const;

export interface PackedFile {
  path: string;
  size: number;
  integrity?: string;
}

export interface PackReport {
  filename: string;
  files: PackedFile[];
}

export interface NpmPackEntry {
  filename?: unknown;
  files?: unknown;
}

/**
 * Reads `npm pack --json`. The packed list is the contract: two machines that
 * pack the same source must produce the same list, so the list is sorted here
 * and never trusted in the order npm happened to emit.
 */
export function parsePackOutput(raw: string): PackReport[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error('npm pack did not report an array');
  return parsed.map((entry, index) => {
    const record = (entry ?? {}) as NpmPackEntry;
    if (typeof record.filename !== 'string') throw new Error(`pack entry ${index} has no filename`);
    if (!Array.isArray(record.files)) throw new Error(`pack entry ${index} has no file list`);
    const files = record.files.map((file) => {
      const item = (file ?? {}) as { path?: unknown; size?: unknown; integrity?: unknown };
      if (typeof item.path !== 'string') throw new Error(`pack entry ${index} has a file with no path`);
      return {
        path: item.path,
        size: typeof item.size === 'number' ? item.size : 0,
        ...(typeof item.integrity === 'string' ? { integrity: item.integrity } : {}),
      };
    });
    files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    return { filename: record.filename, files };
  });
}

/** A stable digest of exactly what would ship, independent of file order. */
export function packContentDigest(report: PackReport): string {
  const canonical = report.files.map((file) => `${file.path}\u0000${file.size}\u0000${file.integrity ?? ''}`).join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}

export interface RegistryVersionState {
  name: string;
  version: string;
  /** Digest of the already-published tarball, when the registry reports one. */
  publishedDigest: string | null;
  /** Digest of the artifact this checkout would publish. */
  expectedDigest: string;
}

/**
 * Decides whether an existing registry version matches the artifact about to be
 * published. A consumed version whose contents differ is an unrecoverable
 * conflict: it must stop the release rather than be overwritten or ignored.
 */
export function assertVersionMatchesArtifact(state: RegistryVersionState): void {
  if (state.publishedDigest === null) return;
  if (state.publishedDigest !== state.expectedDigest) {
    throw new Error(
      `${state.name}@${state.version} is already published with different contents ` +
        `(published ${state.publishedDigest}, expected ${state.expectedDigest}); bump the version instead of republishing`,
    );
  }
}

export interface PackageManifest {
  name?: unknown;
  version?: unknown;
  dependencies?: Record<string, string>;
  [key: string]: unknown;
}

export interface DependencyRewrite {
  manifest: PackageManifest;
  /** Dependencies whose local path was replaced by a registry version. */
  changed: { name: string; from: string; to: string }[];
}

/**
 * Replaces the sidecar's `file:` runtime dependencies with the exact published
 * versions. An exact version, never a range: the pilot's evidence pins these
 * versions, so a floating range would let a later publish invalidate a recorded
 * activation.
 */
export function rewriteSidecarDependencies(
  manifest: PackageManifest,
  versions: Record<string, string> = {
    '@zk-credits/shared': PINNED_ACTIVATION_VERSIONS.shared,
    '@zk-credits/x402-zk-prepaid': PINNED_ACTIVATION_VERSIONS.adapter,
  },
): DependencyRewrite {
  const dependencies = { ...(manifest.dependencies ?? {}) };
  const changed: DependencyRewrite['changed'] = [];
  for (const name of SIDECAR_LOCAL_DEPENDENCIES) {
    const current = dependencies[name];
    const target = versions[name];
    if (target === undefined) throw new Error(`no pinned registry version is known for ${name}`);
    if (current === target) continue;
    if (current === undefined) throw new Error(`${name} is not a declared dependency of the sidecar`);
    dependencies[name] = target;
    changed.push({ name, from: current, to: target });
  }
  return { manifest: { ...manifest, dependencies }, changed };
}

/** True when a commit touched only the sidecar's dependency fields. */
export function isDependencyOnlyChange(changedPaths: readonly string[]): boolean {
  const allowed = new Set(['packages/zk-credits-sidecar/package.json', 'packages/zk-credits-sidecar/package-lock.json']);
  return changedPaths.length > 0 && changedPaths.every((path) => allowed.has(path));
}

export interface WorktreeState {
  /** Paths reported by `git status --porcelain`. */
  dirtyPaths: readonly string[];
  /** Whether the current commit exists on the upstream branch. */
  pushed: boolean;
  branch: string;
  headCommit: string;
}

export interface ReleaseGate {
  ok: boolean;
  reasons: string[];
}

/** The state a working tree must be in before anything publishes. */
export function assertReleaseReady(state: WorktreeState, options: { reviewed: boolean } = { reviewed: false }): ReleaseGate {
  const reasons: string[] = [];
  if (state.dirtyPaths.length > 0) reasons.push(`the working tree has uncommitted changes: ${state.dirtyPaths.join(', ')}`);
  if (!state.pushed) reasons.push(`the commit ${state.headCommit} has not been pushed`);
  if (!options.reviewed) reasons.push('the commit has not been confirmed as reviewed');
  if (state.headCommit.length === 0) reasons.push('the head commit is unreadable');
  return { ok: reasons.length === 0, reasons };
}

/**
 * The publish plan. The sidecar cannot be published until its dependencies
 * resolve from the registry, which is why the rewrite is a step between the two
 * groups rather than part of the packages themselves.
 */
export interface PublishPlanStep {
  kind: 'publish' | 'rewrite-dependencies' | 'verify' | 'commit-and-push' | 'verify-tarball-install';
  package?: ReleasePackage;
  description: string;
}

export function publishPlan(): PublishPlanStep[] {
  return [
    ...LEAF_RELEASE_PACKAGES.map((entry) => ({
      kind: 'publish' as const,
      package: entry,
      description: `publish ${entry.name}@${entry.version} directly, since a new package cannot be staged`,
    })),
    {
      kind: 'rewrite-dependencies',
      description: `replace the sidecar's file: dependencies with the exact published versions and regenerate its lockfile`,
    },
    { kind: 'verify', description: 'reinstall, build, and test the sidecar against the registry versions' },
    { kind: 'verify-tarball-install', description: 'install the packed sidecar tarball into a throwaway directory and run it' },
    { kind: 'commit-and-push', description: 'commit the dependency-only change and push it before publishing' },
    { kind: 'verify', description: 'rerun the release verification against the pushed dependency change' },
    {
      kind: 'publish',
      package: SIDECAR_RELEASE_PACKAGE,
      description: `publish ${SIDECAR_RELEASE_PACKAGE.name}@${SIDECAR_RELEASE_PACKAGE.version}`,
    },
  ];
}
