/**
 * Readiness covers Postgres, Base root freshness, verifier assets, provider
 * configuration, and the launch-control state. Liveness never depends on a
 * downstream dependency, and a failed check never echoes its cause.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { DEFAULT_MAX_ROOT_LAG_BLOCKS, checkReadiness, type ReadinessDependencies } from './readiness.js';
import { LaunchControl, MemoryLaunchControlStore } from './launch-control.js';
import { createZkPrepaidGateway } from './zk-prepaid-gateway.js';
import { MockProviderAdapter } from './providerAdapter.js';

const NOW = 1_800_000_000_000;

function healthy(overrides: Partial<ReadinessDependencies> = {}): ReadinessDependencies {
  return {
    launchControl: new LaunchControl({ store: new MemoryLaunchControlStore(), now: () => NOW }),
    database: async () => undefined,
    rootSnapshot: async () => ({ currentRoot: '1', knownRoots: ['1'], lastScannedBlock: 1_000n }),
    baseHead: async () => 1_050n,
    verifierAssets: async () => undefined,
    providerConfigured: true,
    ...overrides,
  };
}

function detailOf(report: Awaited<ReturnType<typeof checkReadiness>>, name: string): string | undefined {
  return report.checks.find((check) => check.name === name)?.detail;
}

describe('readiness checks', () => {
  it('is ready when every dependency answers', async () => {
    const report = await checkReadiness(healthy());
    expect(report.ready).toBe(true);
    expect(report.launchControl).toBe('enabled');
    expect(report.checks.map((check) => check.name)).toEqual([
      'launchControl', 'database', 'baseRoot', 'baseRpc', 'verifierAssets', 'provider',
    ]);
  });

  it('is not ready when the launch is paused', async () => {
    const store = new MemoryLaunchControlStore();
    await store.pause('operator review', NOW);
    const report = await checkReadiness(healthy({
      launchControl: new LaunchControl({ store, now: () => NOW }),
    }));
    expect(report.ready).toBe(false);
    expect(report.launchControl).toBe('paused');
    expect(detailOf(report, 'launchControl')).toBe('paused');
  });

  it('fails closed when the launch state cannot be read', async () => {
    const report = await checkReadiness(healthy({
      launchControl: new LaunchControl({
        now: () => NOW,
        store: { ...new MemoryLaunchControlStore(), status: async () => { throw new Error('down'); } },
      }),
    }));
    expect(report.ready).toBe(false);
    expect(report.launchControl).toBe('unknown');
    expect(detailOf(report, 'launchControl')).toBe('unavailable');
  });

  it('fails when Postgres is unreachable without echoing the cause', async () => {
    const report = await checkReadiness(healthy({
      database: async () => { throw new Error('connect ECONNREFUSED postgres://user:pw@host/db'); },
    }));
    expect(report.ready).toBe(false);
    expect(detailOf(report, 'database')).toBe('unreachable');
    expect(JSON.stringify(report)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(report)).not.toContain('pw@host');
  });

  it('fails when no contract root has been synchronized', async () => {
    const report = await checkReadiness(healthy({ rootSnapshot: async () => ({ knownRoots: [] }) }));
    expect(report.ready).toBe(false);
    expect(detailOf(report, 'baseRoot')).toBe('not_synchronized');
  });

  it('fails when the root indexer falls behind the chain head', async () => {
    const withinLimit = await checkReadiness(healthy({
      rootSnapshot: async () => ({ currentRoot: '1', knownRoots: ['1'], lastScannedBlock: 1_000n }),
      baseHead: async () => 1_000n + DEFAULT_MAX_ROOT_LAG_BLOCKS,
    }));
    expect(detailOf(withinLimit, 'baseRpc')).toBe('within_lag_limit');
    expect(withinLimit.ready).toBe(true);

    const behind = await checkReadiness(healthy({
      rootSnapshot: async () => ({ currentRoot: '1', knownRoots: ['1'], lastScannedBlock: 1_000n }),
      baseHead: async () => 1_000n + DEFAULT_MAX_ROOT_LAG_BLOCKS + 1n,
    }));
    expect(detailOf(behind, 'baseRpc')).toBe('behind_head');
    expect(behind.ready).toBe(false);

    const rpcDown = await checkReadiness(healthy({ baseHead: async () => { throw new Error('rpc down'); } }));
    expect(detailOf(rpcDown, 'baseRpc')).toBe('unreachable');
    expect(rpcDown.ready).toBe(false);
  });

  it('reports a missing Base RPC probe instead of skipping it', async () => {
    const report = await checkReadiness(healthy({ baseHead: undefined }));
    expect(detailOf(report, 'baseRpc')).toBe('not_configured');
    expect(report.ready).toBe(false);
  });

  it('fails when verifier assets or provider configuration are absent', async () => {
    const noVerifier = await checkReadiness(healthy({ verifierAssets: undefined }));
    expect(detailOf(noVerifier, 'verifierAssets')).toBe('not_configured');
    expect(noVerifier.ready).toBe(false);

    const unreadable = await checkReadiness(healthy({ verifierAssets: async () => { throw new Error('ENOENT /app/vk.json'); } }));
    expect(detailOf(unreadable, 'verifierAssets')).toBe('unavailable');
    expect(JSON.stringify(unreadable)).not.toContain('ENOENT');

    const noProvider = await checkReadiness(healthy({ providerConfigured: false }));
    expect(detailOf(noProvider, 'provider')).toBe('not_configured');
    expect(noProvider.ready).toBe(false);
  });
});

describe('readiness route', () => {
  async function gateway(overrides: {
    paused?: boolean;
    readiness?: { database?: () => Promise<void>; baseHead?: () => Promise<bigint>; verifierAssets?: () => Promise<void> };
  } = {}) {
    const store = new MemoryLaunchControlStore();
    if (overrides.paused) await store.pause('operator review', NOW);
    return createZkPrepaidGateway({
      now: () => NOW,
      provider: new MockProviderAdapter(),
      launchControl: new LaunchControl({ store, now: () => NOW }),
      config: { publicBaseUrl: 'http://test.local', currentRoot: '1', knownRoots: ['1'] },
      verifyProof: async () => ({ isValid: true as const }),
      allowUnverifiedProofs: true,
      readiness: overrides.readiness
        ?? { database: async () => undefined, verifierAssets: async () => undefined, baseHead: async () => 1n },
    });
  }

  it('serves 200 with every check satisfied', async () => {
    const response = await request((await gateway()).app).get('/ready');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ready: true, launchControl: 'enabled' });
  });

  it('serves 503 and names only the failing check', async () => {
    const response = await request((await gateway({
      readiness: { database: async () => undefined, verifierAssets: async () => { throw new Error('missing'); } },
    })).app).get('/ready');
    expect(response.status).toBe(503);
    expect(response.body.ready).toBe(false);
    expect(response.body.checks).toContainEqual({ name: 'verifierAssets', ok: false, detail: 'unavailable' });
    expect(JSON.stringify(response.body)).not.toContain('missing');
  });

  it('keeps liveness independent of readiness', async () => {
    const paused = await gateway({ paused: true });
    expect((await request(paused.app).get('/health')).status).toBe(200);
    expect((await request(paused.app).get('/ready')).status).toBe(503);
  });
});
