import { describe, expect, it } from 'vitest';
import { METRIC_NAMES } from '../metrics.js';
import { collectTrialGate, type TrialGateOptions } from './trial-gate.js';
import type { HttpRequest, HttpTransport } from './providers.js';

const NOW = Date.UTC(2026, 8, 27, 4, 0, 0);
const ROOT = `0x${'ab'.repeat(32)}`;
const TOKEN = 'internal-trial-token-must-not-be-reported';

function readyBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const checks = ['launchControl', 'database', 'baseRoot', 'baseRpc', 'verifierAssets', 'provider']
    .map((name) => ({ name, ok: true, detail: 'private diagnostic detail' }));
  return {
    ready: true,
    launchControl: 'enabled',
    checks,
    generatedAt: new Date(NOW - 1_000).toISOString(),
    ...overrides,
  };
}

function adminBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    launchControl: { state: 'enabled', reason: 'must not be reported' },
    network: 'eip155:84532',
    spend: { dailyHeadroomMicroUsd: 'private' },
    metrics: Object.fromEntries(METRIC_NAMES.map((name) => [name, 0])),
    claims: { reserved: 0, ready: 0, committed: 0, cancelled: 0 },
    base: {
      currentRoot: ROOT,
      knownRootCount: 2,
      lastScannedBlock: '50000000',
      lagBlocks: '12',
    },
    generatedAt: new Date(NOW - 1_000).toISOString(),
    ...overrides,
  };
}

function fixture(options: {
  readyStatus?: number;
  ready?: Record<string, unknown>;
  adminStatus?: number;
  admin?: Record<string, unknown>;
  throwReady?: boolean;
  throwAdmin?: boolean;
  localPreflightPassed?: boolean;
  adminToken?: string;
} = {}): { gateOptions: TrialGateOptions; requests: HttpRequest[] } {
  const requests: HttpRequest[] = [];
  const transport: HttpTransport = {
    async send(request) {
      requests.push(request);
      if (request.url.endsWith('/ready')) {
        if (options.throwReady) throw new Error('private transport error');
        return { status: options.readyStatus ?? 200, body: options.ready ?? readyBody() };
      }
      if (options.throwAdmin) throw new Error('private admin error');
      return { status: options.adminStatus ?? 200, body: options.admin ?? adminBody() };
    },
  };
  return {
    requests,
    gateOptions: {
      localPreflightPassed: options.localPreflightPassed ?? true,
      gatewayUrl: 'https://gateway.example',
      adminToken: options.adminToken ?? TOKEN,
      transport,
      now: () => NOW,
    },
  };
}

describe('internal trial gate', () => {
  it('passes only with fresh readiness, enabled controls, authenticated status, and a current known root', async () => {
    const { gateOptions, requests } = fixture();
    const gate = await collectTrialGate(gateOptions);

    expect(gate).toMatchObject({
      result: 'pass',
      localPreflight: 'pass',
      gatewayReadiness: 'pass',
      provider: 'pass',
      adminAuthentication: 'authenticated',
      adminStatus: 'pass',
      launchControl: 'enabled',
      baseScan: {
        status: 'current',
        hasCurrentRoot: true,
        knownRootCount: 2,
        lastScannedBlock: '50000000',
        lagBlocks: '12',
      },
      counters: { metrics: { challenge_issued: 0 }, claims: { committed: 0 } },
    });
    expect(gate.counters.metrics).toMatchObject({
      payment_validation_header: 0,
      payment_validation_authorization: 0,
      payment_validation_request_binding: 0,
      payment_validation_wire_shape: 0,
      payment_validation_public_signals: 0,
      payment_validation_cryptographic_proof: 0,
      payment_validation_verifier_unavailable: 0,
      payment_validation_other: 0,
    });
    expect(requests).toHaveLength(2);
    expect(requests.find((request) => request.url.endsWith('/v1/admin/status'))?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    const serialized = JSON.stringify(gate);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain(ROOT);
    expect(serialized).not.toContain('private diagnostic detail');
    expect(serialized).not.toContain('dailyHeadroomMicroUsd');
  });

  it('fails closed when launch control is paused', async () => {
    const { gateOptions } = fixture({
      readyStatus: 503,
      ready: readyBody({ ready: false, launchControl: 'paused' }),
      admin: adminBody({ launchControl: { state: 'paused' } }),
    });
    const gate = await collectTrialGate(gateOptions);
    expect(gate.result).toBe('fail');
    expect(gate.gatewayReadiness).toBe('failed');
    expect(gate.launchControl).toBe('paused');
  });

  it('marks an old admin snapshot stale', async () => {
    const { gateOptions } = fixture({
      admin: adminBody({ generatedAt: new Date(NOW - 180_000).toISOString() }),
    });
    const gate = await collectTrialGate(gateOptions);
    expect(gate.adminStatus).toBe('stale');
    expect(gate.baseScan.status).toBe('stale');
    expect(gate.result).toBe('fail');
  });

  it('fails when the Base RPC lag exceeds the readiness limit', async () => {
    const { gateOptions } = fixture({ admin: adminBody({ base: {
      currentRoot: ROOT,
      knownRootCount: 2,
      lastScannedBlock: '49900000',
      lagBlocks: '301',
    } }) });
    const gate = await collectTrialGate(gateOptions);
    expect(gate.baseScan.status).toBe('lagging');
    expect(gate.result).toBe('fail');
  });

  it('fails and reports the provider check without exposing readiness details', async () => {
    const failedReady = readyBody({
      ready: false,
      checks: (readyBody().checks as { name: string; ok: boolean }[])
        .map((check) => check.name === 'provider' ? { ...check, ok: false } : check),
    });
    const { gateOptions } = fixture({ readyStatus: 503, ready: failedReady });
    const gate = await collectTrialGate(gateOptions);
    expect(gate.gatewayReadiness).toBe('failed');
    expect(gate.provider).toBe('failed');
    expect(JSON.stringify(gate)).not.toContain('private diagnostic detail');
  });

  it('reports admin authentication failure without retaining its body', async () => {
    const { gateOptions } = fixture({ adminStatus: 401, admin: { error: 'private auth detail' } });
    const gate = await collectTrialGate(gateOptions);
    expect(gate.adminAuthentication).toBe('unauthorized');
    expect(gate.adminStatus).toBe('unavailable');
    expect(JSON.stringify(gate)).not.toContain('private auth detail');
  });

  it('does not contact the gateway when local preflight fails', async () => {
    const { gateOptions, requests } = fixture({ localPreflightPassed: false });
    const gate = await collectTrialGate(gateOptions);
    expect(gate).toMatchObject({
      result: 'fail',
      localPreflight: 'fail',
      gatewayReadiness: 'not_checked',
      adminAuthentication: 'not_checked',
      adminStatus: 'not_checked',
      baseScan: { status: 'not_checked' },
    });
    expect(requests).toHaveLength(0);
  });

  it('reports a missing admin token and skips only the authenticated request', async () => {
    const { gateOptions, requests } = fixture({ adminToken: '' });
    const gate = await collectTrialGate(gateOptions);
    expect(gate.adminAuthentication).toBe('missing_token');
    expect(requests).toHaveLength(1);
    expect(gate.result).toBe('fail');
  });
});
