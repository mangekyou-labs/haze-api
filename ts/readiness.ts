/**
 * Public liveness and readiness for the pilot gateway.
 *
 * Liveness is the process being up. Readiness is whether the service can
 * honestly accept new work: Postgres, Base root freshness, verifier assets,
 * provider configuration, and the launch-control state all have to agree.
 *
 * Check details are fixed, privacy-safe strings. They never echo a connection
 * string, an RPC error body, a root value, or any spend-plane identifier.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { LaunchControl, LaunchState } from './launch-control.js';

/** Finalized-root lag beyond this many blocks fails readiness. */
export const DEFAULT_MAX_ROOT_LAG_BLOCKS = 300n;

export interface ReadinessDependencies {
  launchControl?: LaunchControl;
  /** Resolves when Postgres answers. Throwing marks the check failed. */
  database?: () => Promise<void>;
  /** Latest finalized root snapshot maintained by the Base event indexer. */
  rootSnapshot?: () => Promise<{ currentRoot?: string; knownRoots?: string[]; lastScannedBlock?: bigint }>;
  /** Current chain head, used only to measure root lag. */
  baseHead?: () => Promise<bigint>;
  /** Resolves when the pinned verifying-key material is readable and parseable. */
  verifierAssets?: () => Promise<void>;
  /** Whether an upstream provider credential is configured at all. */
  providerConfigured: boolean;
  maxRootLagBlocks?: bigint;
}

export interface ReadinessCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ReadinessReport {
  ready: boolean;
  launchControl: LaunchState | 'unknown';
  checks: ReadinessCheck[];
  generatedAt: string;
}

export async function checkReadiness(dependencies: ReadinessDependencies): Promise<ReadinessReport> {
  const checks: ReadinessCheck[] = [];
  let launchControl: LaunchState | 'unknown' = 'unknown';

  if (dependencies.launchControl) {
    try {
      const status = await dependencies.launchControl.status();
      launchControl = status.state;
      checks.push({
        name: 'launchControl',
        ok: status.state === 'enabled',
        detail: status.state === 'enabled' ? 'enabled' : 'paused',
      });
    } catch {
      checks.push({ name: 'launchControl', ok: false, detail: 'unavailable' });
    }
  }

  if (dependencies.database) {
    try {
      await dependencies.database();
      checks.push({ name: 'database', ok: true, detail: 'reachable' });
    } catch {
      checks.push({ name: 'database', ok: false, detail: 'unreachable' });
    }
  }

  let snapshot: { currentRoot?: string; knownRoots?: string[]; lastScannedBlock?: bigint } | undefined;
  if (dependencies.rootSnapshot) {
    try {
      snapshot = await dependencies.rootSnapshot();
      const roots = snapshot.knownRoots ?? [];
      const known = Boolean(snapshot.currentRoot) || roots.length > 0;
      checks.push({ name: 'baseRoot', ok: known, detail: known ? 'synchronized' : 'not_synchronized' });
    } catch {
      checks.push({ name: 'baseRoot', ok: false, detail: 'unavailable' });
    }
  }

  if (dependencies.baseHead && snapshot?.lastScannedBlock !== undefined) {
    try {
      const head = await dependencies.baseHead();
      const lag = head > snapshot.lastScannedBlock ? head - snapshot.lastScannedBlock : 0n;
      const limit = dependencies.maxRootLagBlocks ?? DEFAULT_MAX_ROOT_LAG_BLOCKS;
      checks.push({
        name: 'baseRpc',
        ok: lag <= limit,
        detail: lag <= limit ? 'within_lag_limit' : 'behind_head',
      });
    } catch {
      checks.push({ name: 'baseRpc', ok: false, detail: 'unreachable' });
    }
  } else if (!dependencies.baseHead) {
    // Without an RPC endpoint the root can never be re-synchronized, so the
    // missing probe is reported rather than silently skipped.
    checks.push({ name: 'baseRpc', ok: false, detail: 'not_configured' });
  }

  if (dependencies.verifierAssets) {
    try {
      await dependencies.verifierAssets();
      checks.push({ name: 'verifierAssets', ok: true, detail: 'loaded' });
    } catch {
      checks.push({ name: 'verifierAssets', ok: false, detail: 'unavailable' });
    }
  } else {
    checks.push({ name: 'verifierAssets', ok: false, detail: 'not_configured' });
  }

  checks.push({
    name: 'provider',
    ok: dependencies.providerConfigured,
    detail: dependencies.providerConfigured ? 'configured' : 'not_configured',
  });

  return {
    ready: checks.every((check) => check.ok),
    launchControl,
    checks,
    generatedAt: new Date().toISOString(),
  };
}
