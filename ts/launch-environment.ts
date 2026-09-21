/**
 * The one place pilot caps and the pilot environment are resolved.
 *
 * Production caps are frozen constants: the pilot's whole economic promise is
 * that a dispatch is debited against a fixed ceiling, so an operator must not
 * be able to widen them from the environment. Staging is the single exception,
 * and it exists so the exhaustion path can be exercised without spending real
 * budget.
 *
 * The exception is therefore narrow by construction:
 *
 * - the overrides are read only when `PILOT_ENVIRONMENT` is exactly `staging`;
 * - a deployment that declares itself `production` refuses to start when either
 *   override is present, rather than silently ignoring it; and
 * - a staging override may only narrow the fixed ceiling, never widen it.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { DAILY_CAP_MICRO_USD, ROLLING_CAP_MICRO_USD, type SpendCaps } from './launch-control.js';

export type { SpendCaps };

export const PILOT_ENVIRONMENTS = ['local', 'staging', 'production'] as const;
export type PilotEnvironment = (typeof PILOT_ENVIRONMENTS)[number];

export const PILOT_ENVIRONMENT_VAR = 'PILOT_ENVIRONMENT';
export const STAGING_DAILY_CAP_VAR = 'PILOT_STAGING_DAILY_CAP_MICRO_USD';
export const STAGING_ROLLING_CAP_VAR = 'PILOT_STAGING_ROLLING_CAP_MICRO_USD';

export type Environment = Record<string, string | undefined>;

export class InvalidPilotEnvironmentError extends Error {
  constructor(value: string) {
    super(`invalid_pilot_environment:${value}`);
    this.name = 'InvalidPilotEnvironmentError';
  }
}

/**
 * Raised when a deployment that is not staging would have used a staging cap.
 * Startup fails instead of running with caps nobody intended.
 */
export class StagingCapOverrideRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StagingCapOverrideRejectedError';
  }
}

/** Production is the safe default only when the runtime says so. */
export function resolvePilotEnvironment(env: Environment): PilotEnvironment {
  const declared = env[PILOT_ENVIRONMENT_VAR]?.trim();
  if (declared) {
    if (!(PILOT_ENVIRONMENTS as readonly string[]).includes(declared)) throw new InvalidPilotEnvironmentError(declared);
    return declared as PilotEnvironment;
  }
  return env.NODE_ENV === 'production' ? 'production' : 'local';
}

function readCapMicroUsd(env: Environment, name: string, ceiling: bigint): bigint {
  const raw = env[name]?.trim();
  if (!raw) return ceiling;
  if (!/^[0-9]+$/u.test(raw)) {
    throw new StagingCapOverrideRejectedError(`${name} must be a whole number of micro-USD`);
  }
  const value = BigInt(raw);
  if (value <= 0n) throw new StagingCapOverrideRejectedError(`${name} must be greater than zero`);
  if (value > ceiling) {
    throw new StagingCapOverrideRejectedError(`${name} would widen the fixed pilot ceiling; a staging cap may only narrow it`);
  }
  return value;
}

/**
 * Resolves the effective caps. Anything other than an explicit staging
 * deployment refuses a staging override outright.
 */
export function resolveSpendCaps(env: Environment = process.env): SpendCaps {
  const environment = resolvePilotEnvironment(env);
  const daily = env[STAGING_DAILY_CAP_VAR]?.trim();
  const rolling = env[STAGING_ROLLING_CAP_VAR]?.trim();
  if (daily || rolling) {
    if (environment !== 'staging') {
      throw new StagingCapOverrideRejectedError(
        `${STAGING_DAILY_CAP_VAR} and ${STAGING_ROLLING_CAP_VAR} are staging-only; ${PILOT_ENVIRONMENT_VAR} is ${environment}`,
      );
    }
    const dailyMicroUsd = readCapMicroUsd(env, STAGING_DAILY_CAP_VAR, DAILY_CAP_MICRO_USD);
    const rollingMicroUsd = readCapMicroUsd(env, STAGING_ROLLING_CAP_VAR, ROLLING_CAP_MICRO_USD);
    if (rollingMicroUsd < dailyMicroUsd) {
      throw new StagingCapOverrideRejectedError(`${STAGING_ROLLING_CAP_VAR} must not be below ${STAGING_DAILY_CAP_VAR}`);
    }
    return { dailyMicroUsd, rollingMicroUsd, source: 'staging' };
  }
  return { dailyMicroUsd: DAILY_CAP_MICRO_USD, rollingMicroUsd: ROLLING_CAP_MICRO_USD, source: 'fixed' };
}
