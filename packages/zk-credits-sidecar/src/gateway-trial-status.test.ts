import { describe, expect, it } from 'vitest';
import { evaluateGatewayReadiness, isGatewayStatusFresh } from './gateway-trial-status.js';

const NOW = Date.parse('2026-09-28T12:00:00.000Z');
const READINESS_CHECKS = ['launchControl', 'database', 'baseRoot', 'baseRpc', 'verifierAssets', 'provider'];

function readinessBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ready: true,
    launchControl: 'enabled',
    generatedAt: new Date(NOW - 1_000).toISOString(),
    checks: READINESS_CHECKS.map((name) => ({ name, ok: true })),
    ...overrides,
  };
}

describe('registered-adapter gateway entry gate', () => {
  it('requires a fresh response and every named readiness check, including provider', () => {
    expect(evaluateGatewayReadiness(200, readinessBody(), NOW)).toMatchObject({
      passed: true,
      failedChecks: [],
      timestampFresh: true,
    });
  });

  it('fails closed when provider readiness is missing', () => {
    const checks = READINESS_CHECKS.filter((name) => name !== 'provider').map((name) => ({ name, ok: true }));
    expect(evaluateGatewayReadiness(200, readinessBody({ checks }), NOW)).toMatchObject({
      passed: false,
      failedChecks: ['provider'],
    });
  });

  it('fails closed when the readiness response is stale or malformed', () => {
    expect(evaluateGatewayReadiness(200, readinessBody({
      generatedAt: new Date(NOW - 120_001).toISOString(),
    }), NOW)).toMatchObject({ passed: false, timestampFresh: false });

    expect(evaluateGatewayReadiness(200, readinessBody({
      checks: [...READINESS_CHECKS.map((name) => ({ name, ok: true })), { name: 'provider', ok: true }],
    }), NOW)).toMatchObject({ passed: false });
  });

  it('rejects stale and implausibly future admin snapshots', () => {
    expect(isGatewayStatusFresh(new Date(NOW - 120_001).toISOString(), NOW)).toBe(false);
    expect(isGatewayStatusFresh(new Date(NOW + 30_001).toISOString(), NOW)).toBe(false);
    expect(isGatewayStatusFresh(new Date(NOW + 30_000).toISOString(), NOW)).toBe(true);
  });
});
