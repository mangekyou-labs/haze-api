/**
 * The pilot environment seam and the staging-only spend caps.
 *
 * The caps are the pilot's economic promise, so the interesting assertions are
 * the refusals: a deployment that is not explicitly staging must not be able to
 * run on a narrowed ceiling, and a staging ceiling must never be widened past
 * the fixed one. Only a staging deployment may narrow a cap, and narrowing is
 * the single supported way to exercise the exhaustion path without spending
 * production budget.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  DAILY_CAP_MICRO_USD,
  MemoryLaunchControlStore,
  ROLLING_CAP_MICRO_USD,
  type SpendCaps,
} from './launch-control.js';
import {
  InvalidPilotEnvironmentError,
  PILOT_ENVIRONMENT_VAR,
  STAGING_DAILY_CAP_VAR,
  STAGING_ROLLING_CAP_VAR,
  StagingCapOverrideRejectedError,
  resolvePilotEnvironment,
  resolveSpendCaps,
} from './launch-environment.js';

describe('pilot environment resolution', () => {
  it('defaults to local and treats a production NODE_ENV as production', () => {
    expect(resolvePilotEnvironment({})).toBe('local');
    expect(resolvePilotEnvironment({ NODE_ENV: 'production' })).toBe('production');
    expect(resolvePilotEnvironment({ NODE_ENV: 'test' })).toBe('local');
  });

  it('honours an explicit declaration over NODE_ENV', () => {
    expect(resolvePilotEnvironment({ [PILOT_ENVIRONMENT_VAR]: 'staging', NODE_ENV: 'production' })).toBe('staging');
    expect(resolvePilotEnvironment({ [PILOT_ENVIRONMENT_VAR]: 'production', NODE_ENV: 'development' })).toBe('production');
  });

  it('refuses an unknown environment instead of guessing', () => {
    expect(() => resolvePilotEnvironment({ [PILOT_ENVIRONMENT_VAR]: 'prod' })).toThrow(InvalidPilotEnvironmentError);
  });
});

describe('spend cap resolution', () => {
  it('reports the fixed production ceilings when nothing is overridden', () => {
    expect(resolveSpendCaps({})).toEqual({
      dailyMicroUsd: DAILY_CAP_MICRO_USD,
      rollingMicroUsd: ROLLING_CAP_MICRO_USD,
      source: 'fixed',
    });
    expect(resolveSpendCaps({ NODE_ENV: 'production' }).source).toBe('fixed');
  });

  it('accepts a narrowed pair on an explicit staging deployment', () => {
    expect(resolveSpendCaps({
      [PILOT_ENVIRONMENT_VAR]: 'staging',
      [STAGING_DAILY_CAP_VAR]: '500000',
      [STAGING_ROLLING_CAP_VAR]: '2000000',
    })).toEqual({ dailyMicroUsd: 500_000n, rollingMicroUsd: 2_000_000n, source: 'staging' });
  });

  it('refuses a staging cap on a production deployment', () => {
    expect(() => resolveSpendCaps({
      [PILOT_ENVIRONMENT_VAR]: 'production',
      [STAGING_DAILY_CAP_VAR]: '500000',
    })).toThrow(StagingCapOverrideRejectedError);

    // NODE_ENV=production is production even without an explicit declaration,
    // so the deployed gateway cannot pick up a staging cap by accident.
    expect(() => resolveSpendCaps({ NODE_ENV: 'production', [STAGING_ROLLING_CAP_VAR]: '1000' }))
      .toThrow(/staging-only/u);
  });

  it('refuses a staging cap on a local deployment too, since only staging is the exception', () => {
    expect(() => resolveSpendCaps({ [STAGING_DAILY_CAP_VAR]: '500000' })).toThrow(StagingCapOverrideRejectedError);
  });

  it('refuses a staging cap that would widen the fixed ceiling', () => {
    expect(() => resolveSpendCaps({
      [PILOT_ENVIRONMENT_VAR]: 'staging',
      [STAGING_DAILY_CAP_VAR]: (DAILY_CAP_MICRO_USD + 1n).toString(),
    })).toThrow(/may only narrow/u);

    expect(() => resolveSpendCaps({
      [PILOT_ENVIRONMENT_VAR]: 'staging',
      [STAGING_ROLLING_CAP_VAR]: (ROLLING_CAP_MICRO_USD + 1n).toString(),
    })).toThrow(/may only narrow/u);
  });

  it('refuses a malformed, zero, or inverted pair', () => {
    const staging = { [PILOT_ENVIRONMENT_VAR]: 'staging' } as Record<string, string | undefined>;
    expect(() => resolveSpendCaps({ ...staging, [STAGING_DAILY_CAP_VAR]: '0' })).toThrow(/greater than zero/u);
    expect(() => resolveSpendCaps({ ...staging, [STAGING_DAILY_CAP_VAR]: '1.5' })).toThrow(/whole number/u);
    expect(() => resolveSpendCaps({ ...staging, [STAGING_DAILY_CAP_VAR]: '-1' })).toThrow(/whole number/u);
    expect(() => resolveSpendCaps({
      ...staging,
      [STAGING_DAILY_CAP_VAR]: '2000000',
      [STAGING_ROLLING_CAP_VAR]: '500000',
    })).toThrow(/must not be below/u);
  });
});

describe('staging cap exhaustion', () => {
  const stagingCaps: SpendCaps = { dailyMicroUsd: 3n, rollingMicroUsd: 5n, source: 'staging' };

  it('enforces the narrowed ceiling and reports it in the snapshot', async () => {
    const store = new MemoryLaunchControlStore({ caps: stagingCaps });
    expect((await store.spend(0)).dailyCapMicroUsd).toBe(3n);
    expect((await store.spend(0)).rollingCapMicroUsd).toBe(5n);

    expect(await store.debit(1n, 0)).toMatchObject({ kind: 'debited' });
    expect(await store.debit(1n, 0)).toMatchObject({ kind: 'debited' });
    expect(await store.debit(1n, 0)).toMatchObject({ kind: 'debited' });
  });

  it('exhausts after the narrowed cap and persists the paused launch', async () => {
    const store = new MemoryLaunchControlStore({ caps: stagingCaps });
    await store.debit(3n, 0);

    expect(await store.debit(1n, 0)).toEqual({ kind: 'cap_exhausted', window: 'utc_day' });
    const status = await store.status();
    expect(status.state).toBe('paused');
    expect(status.reason).toBe('provider_spend_cap_exhausted:utc_day');

    // A paused launch refuses the next dispatch outright.
    expect(await store.debit(1n, 0)).toEqual({ kind: 'paused' });
  });

  it('leaves the fixed production store on the full ceilings', async () => {
    const store = new MemoryLaunchControlStore();
    const snapshot = await store.spend(0);
    expect(snapshot.dailyCapMicroUsd).toBe(DAILY_CAP_MICRO_USD);
    expect(snapshot.rollingCapMicroUsd).toBe(ROLLING_CAP_MICRO_USD);
  });
});
