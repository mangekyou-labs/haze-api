/**
 * Replaces the sidecar's checkout-local `file:` dependencies with the exact
 * published registry versions and regenerates its lockfile.
 *
 * This runs as its own command because it is the one point in the release where
 * the sidecar stops being buildable from the checkout alone: before it, the
 * leaves are published and the versions resolve; after it, the sidecar's build
 * depends on the registry. Keeping it a separate, re-runnable command is what
 * lets the launch resume across that boundary.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { redact } from './redact.js';
import { SIDECAR_RELEASE_PACKAGE, rewriteSidecarDependencies, type PackageManifest } from './release.js';

const execFileAsync = promisify(execFile);

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const manifestPath = resolve(repositoryRoot, SIDECAR_RELEASE_PACKAGE.directory, 'package.json');

const raw = await readFile(manifestPath, 'utf8');
const manifest = JSON.parse(raw) as PackageManifest;
const { manifest: rewritten, changed } = rewriteSidecarDependencies(manifest);

if (changed.length === 0) {
  console.log('the sidecar already depends on the published versions; nothing to rewrite');
  process.exit(0);
}

await writeFile(manifestPath, `${JSON.stringify(rewritten, null, 2)}\n`, 'utf8');
for (const entry of changed) console.log(`  ${entry.name}: ${entry.from} -> ${entry.to}`);

try {
  // The lockfile has to be regenerated so it records the registry resolutions
  // rather than the symlinks the checkout-local paths produced.
  await execFileAsync('npm', ['install', '--package-lock-only', '--no-audit', '--no-fund'], {
    cwd: resolve(repositoryRoot, SIDECAR_RELEASE_PACKAGE.directory),
  });
} catch (error) {
  console.error(redact(`regenerating the sidecar lockfile failed: ${error instanceof Error ? error.message : 'unknown'}`));
  process.exit(1);
}

console.log('the sidecar dependency rewrite is complete; reinstall, build, and test before publishing');
