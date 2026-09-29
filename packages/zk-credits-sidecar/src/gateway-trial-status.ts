/**
 * Freshness and readiness checks used by the separately registered adapter
 * trial. Keep this gate fail-closed when a gateway omits a named check.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export const GATEWAY_READINESS_CHECK_NAMES = [
  'launchControl',
  'database',
  'baseRoot',
  'baseRpc',
  'verifierAssets',
  'provider',
] as const;

const MAX_STATUS_AGE_MS = 120_000;
const MAX_FUTURE_SKEW_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isGatewayStatusFresh(value: unknown, now = Date.now()): boolean {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const age = now - timestamp;
  return age <= MAX_STATUS_AGE_MS && age >= -MAX_FUTURE_SKEW_MS;
}

export function evaluateGatewayReadiness(
  status: number | null,
  body: unknown,
  now = Date.now(),
): { passed: boolean; failedChecks: string[]; timestampFresh: boolean } {
  const report = isRecord(body) ? body : undefined;
  const checks = Array.isArray(report?.checks) ? report.checks : undefined;
  const byName = new Map<string, Record<string, unknown>>();
  const failedChecks: string[] = [];
  let checksValid = Boolean(checks);

  for (const check of checks ?? []) {
    if (!isRecord(check) || typeof check.name !== 'string' || byName.has(check.name)) {
      checksValid = false;
      continue;
    }
    byName.set(check.name, check);
    if (!(GATEWAY_READINESS_CHECK_NAMES as readonly string[]).includes(check.name)) checksValid = false;
  }

  checksValid = checksValid
    && byName.size === GATEWAY_READINESS_CHECK_NAMES.length
    && GATEWAY_READINESS_CHECK_NAMES.every((name) => byName.has(name) && byName.get(name)?.ok === true);

  for (const name of GATEWAY_READINESS_CHECK_NAMES) {
    if (byName.get(name)?.ok !== true) failedChecks.push(name);
  }
  if (!checksValid && failedChecks.length === 0) failedChecks.push('checks');
  if (report?.ready !== true) failedChecks.push('ready');
  if (report?.launchControl !== 'enabled' && !failedChecks.includes('launchControl')) {
    failedChecks.push('launchControl');
  }

  const timestampFresh = isGatewayStatusFresh(report?.generatedAt, now);
  if (!timestampFresh) failedChecks.push('generatedAt');

  return {
    passed: status === 200
      && report?.ready === true
      && report.launchControl === 'enabled'
      && checksValid
      && timestampFresh,
    failedChecks,
    timestampFresh,
  };
}
