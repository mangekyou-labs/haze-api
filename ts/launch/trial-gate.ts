/**
 * Read-only entry gate for the internal Base Sepolia exchange trial.
 *
 * The result deliberately contains only fixed gate names, bounded status
 * values, Base scan positions, and aggregate counters. Gateway response
 * bodies are inspected in memory and never copied into the result.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { METRIC_NAMES } from '../metrics.js';
import { DEFAULT_MAX_ROOT_LAG_BLOCKS } from '../readiness.js';
import { ProviderRequestError, type HttpTransport } from './providers.js';

const READINESS_CHECKS = ['launchControl', 'database', 'baseRoot', 'baseRpc', 'verifierAssets', 'provider'] as const;
const CLAIM_NAMES = ['reserved', 'ready', 'committed', 'cancelled'] as const;
const BASE_SEPOLIA_NETWORK = 'eip155:84532';
const MAX_STATUS_AGE_MS = 120_000;
const MAX_FUTURE_SKEW_MS = 30_000;

export type GateResult = 'pass' | 'fail';
export type ReadinessResult = 'pass' | 'failed' | 'unavailable' | 'stale' | 'invalid' | 'not_checked';
export type AdminStatusResult = 'pass' | 'unavailable' | 'stale' | 'invalid' | 'not_checked';
export type AuthenticationResult = 'authenticated' | 'missing_token' | 'unauthorized' | 'unavailable' | 'not_checked';
export type LaunchControlResult = 'enabled' | 'paused' | 'unknown';
export type BaseScanResult = 'current' | 'stale' | 'lagging' | 'missing' | 'invalid' | 'unavailable' | 'not_checked';

export type TrialGateCounters = {
  metrics: Record<(typeof METRIC_NAMES)[number], number | null>;
  claims: Record<(typeof CLAIM_NAMES)[number], number | null>;
};

export interface TrialGateReport {
  schemaVersion: 'base-sepolia-internal-trial-gate/v1';
  checkedAt: string;
  result: GateResult;
  localPreflight: GateResult;
  gatewayReadiness: ReadinessResult;
  provider: 'pass' | 'failed' | 'unknown' | 'not_checked';
  adminAuthentication: AuthenticationResult;
  adminStatus: AdminStatusResult;
  launchControl: LaunchControlResult;
  baseScan: {
    status: BaseScanResult;
    hasCurrentRoot: boolean;
    knownRootCount: number | null;
    lastScannedBlock: string | null;
    lagBlocks: string | null;
  };
  counters: TrialGateCounters;
}

export interface TrialGateOptions {
  localPreflightPassed: boolean;
  gatewayUrl?: string;
  adminToken?: string;
  transport: HttpTransport;
  now?: () => number;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFresh(value: unknown, now: number): boolean {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const age = now - timestamp;
  return age <= MAX_STATUS_AGE_MS && age >= -MAX_FUTURE_SKEW_MS;
}

function safeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeDecimal(value: unknown): string | null {
  return typeof value === 'string' && /^\d+$/u.test(value) ? value : null;
}

function parseGatewayOrigin(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || url.search
      || url.hash
      || (url.pathname !== '/' && url.pathname !== '')
    ) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

async function readJson(
  transport: HttpTransport,
  url: URL,
  headers: Record<string, string>,
): Promise<{ status: number | null; body?: unknown }> {
  try {
    const response = await transport.send({ method: 'GET', url: url.toString(), headers });
    return { status: response.status, body: response.body };
  } catch (error) {
    if (error instanceof ProviderRequestError) return { status: error.status, body: error.body };
    return { status: null };
  }
}

function emptyCounters(): TrialGateCounters {
  return {
    metrics: Object.fromEntries(METRIC_NAMES.map((name) => [name, null])) as TrialGateCounters['metrics'],
    claims: Object.fromEntries(CLAIM_NAMES.map((name) => [name, null])) as TrialGateCounters['claims'],
  };
}

function mergeLaunchControl(readiness: unknown, admin: unknown): LaunchControlResult {
  if (readiness === 'paused' || admin === 'paused') return 'paused';
  if ((readiness === undefined || readiness === 'enabled') && (admin === undefined || admin === 'enabled')) {
    return readiness === 'enabled' || admin === 'enabled' ? 'enabled' : 'unknown';
  }
  return 'unknown';
}

/** Collects one fresh, machine-readable gate snapshot without changing state. */
export async function collectTrialGate(options: TrialGateOptions): Promise<TrialGateReport> {
  const now = (options.now ?? Date.now)();
  const report: TrialGateReport = {
    schemaVersion: 'base-sepolia-internal-trial-gate/v1',
    checkedAt: new Date(now).toISOString(),
    result: 'fail',
    localPreflight: options.localPreflightPassed ? 'pass' : 'fail',
    gatewayReadiness: options.localPreflightPassed ? 'unavailable' : 'not_checked',
    provider: options.localPreflightPassed ? 'unknown' : 'not_checked',
    adminAuthentication: options.localPreflightPassed ? 'unavailable' : 'not_checked',
    adminStatus: options.localPreflightPassed ? 'unavailable' : 'not_checked',
    launchControl: 'unknown',
    baseScan: {
      status: options.localPreflightPassed ? 'unavailable' : 'not_checked',
      hasCurrentRoot: false,
      knownRootCount: null,
      lastScannedBlock: null,
      lagBlocks: null,
    },
    counters: emptyCounters(),
  };

  if (!options.localPreflightPassed) return report;

  const origin = parseGatewayOrigin(options.gatewayUrl);
  if (!origin) {
    report.adminAuthentication = options.adminToken?.trim() ? 'unavailable' : 'missing_token';
    return report;
  }

  const readyUrl = new URL('/ready', origin);
  const readyPromise = readJson(options.transport, readyUrl, { accept: 'application/json' });
  const token = options.adminToken?.trim();
  const adminPromise = token
    ? readJson(options.transport, new URL('/v1/admin/status', origin), {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      })
    : Promise.resolve(undefined);
  const [readyResponse, adminResponse] = await Promise.all([readyPromise, adminPromise]);

  let readinessControl: unknown;
  let adminControl: unknown;
  const readyBody = isRecord(readyResponse.body) ? readyResponse.body : undefined;
  if (readyResponse.status === null) {
    report.gatewayReadiness = 'unavailable';
  } else if (!readyBody) {
    report.gatewayReadiness = 'invalid';
  } else {
    readinessControl = readyBody.launchControl;
    const checks = Array.isArray(readyBody.checks) ? readyBody.checks : undefined;
    const byName = new Map<string, JsonRecord>();
    let checksValid = Boolean(checks);
    for (const check of checks ?? []) {
      if (!isRecord(check) || typeof check.name !== 'string' || byName.has(check.name)) {
        checksValid = false;
        continue;
      }
      byName.set(check.name, check);
    }
    checksValid = checksValid
      && byName.size === READINESS_CHECKS.length
      && READINESS_CHECKS.every((name) => byName.has(name) && byName.get(name)?.ok === true);
    const providerCheck = byName.get('provider');
    report.provider = providerCheck
      ? providerCheck.ok === true ? 'pass' : 'failed'
      : 'unknown';

    if (!isFresh(readyBody.generatedAt, now)) {
      report.gatewayReadiness = 'stale';
    } else if (readyResponse.status !== 200) {
      report.gatewayReadiness = 'failed';
    } else if (
      readyBody.ready === true
      && readinessControl === 'enabled'
      && checksValid
    ) {
      report.gatewayReadiness = 'pass';
    } else {
      report.gatewayReadiness = 'failed';
    }
  }

  if (!token) {
    report.adminAuthentication = 'missing_token';
  } else if (!adminResponse || adminResponse.status === null) {
    report.adminAuthentication = 'unavailable';
    report.adminStatus = 'unavailable';
  } else if (adminResponse.status === 401 || adminResponse.status === 403) {
    report.adminAuthentication = 'unauthorized';
    report.adminStatus = 'unavailable';
  } else if (adminResponse.status !== 200 || !isRecord(adminResponse.body)) {
    report.adminAuthentication = 'unavailable';
    report.adminStatus = 'unavailable';
  } else {
    report.adminAuthentication = 'authenticated';
    const body = adminResponse.body;
    const launch = isRecord(body.launchControl) ? body.launchControl : undefined;
    const base = isRecord(body.base) ? body.base : undefined;
    const rawMetrics = isRecord(body.metrics) ? body.metrics : undefined;
    const rawClaims = isRecord(body.claims) ? body.claims : undefined;
    adminControl = launch?.state;
    const isTimestampFresh = isFresh(body.generatedAt, now);

    let countersValid = Boolean(rawMetrics && rawClaims);
    for (const name of METRIC_NAMES) {
      const count = safeCount(rawMetrics?.[name]);
      report.counters.metrics[name] = count;
      if (count === null) countersValid = false;
    }
    for (const name of CLAIM_NAMES) {
      const count = safeCount(rawClaims?.[name]);
      report.counters.claims[name] = count;
      if (count === null) countersValid = false;
    }

    const knownRootCount = safeCount(base?.knownRootCount);
    const lastScannedBlock = safeDecimal(base?.lastScannedBlock);
    const lagBlocks = safeDecimal(base?.lagBlocks);
    const hasCurrentRoot = typeof base?.currentRoot === 'string' && base.currentRoot.length > 0;
    report.baseScan = {
      status: 'missing',
      hasCurrentRoot,
      knownRootCount,
      lastScannedBlock,
      lagBlocks,
    };

    const baseShapeInvalid = base !== undefined
      && ((base.knownRootCount !== null && knownRootCount === null)
        || (base.lastScannedBlock !== null && lastScannedBlock === null)
        || (base.lagBlocks !== null && lagBlocks === null));
    if (baseShapeInvalid) {
      report.baseScan.status = 'invalid';
    } else if (!isTimestampFresh) {
      report.baseScan.status = 'stale';
    } else if (
      !hasCurrentRoot
      || knownRootCount === null
      || knownRootCount === 0
      || lastScannedBlock === null
      || lagBlocks === null
    ) {
      report.baseScan.status = 'missing';
    } else if (BigInt(lagBlocks) > DEFAULT_MAX_ROOT_LAG_BLOCKS) {
      report.baseScan.status = 'lagging';
    } else {
      report.baseScan.status = 'current';
    }

    if (!isTimestampFresh) {
      report.adminStatus = 'stale';
    } else if (
      body.network !== BASE_SEPOLIA_NETWORK
      || !launch
      || (launch.state !== 'enabled' && launch.state !== 'paused')
      || !countersValid
      || base === undefined
      || baseShapeInvalid
    ) {
      report.adminStatus = 'invalid';
    } else {
      report.adminStatus = 'pass';
    }
  }

  report.launchControl = mergeLaunchControl(readinessControl, adminControl);
  const passed = report.localPreflight === 'pass'
    && report.gatewayReadiness === 'pass'
    && report.provider === 'pass'
    && report.adminAuthentication === 'authenticated'
    && report.adminStatus === 'pass'
    && report.launchControl === 'enabled'
    && report.baseScan.status === 'current';
  report.result = passed ? 'pass' : 'fail';
  return report;
}
