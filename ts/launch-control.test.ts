/**
 * Launch controls: the manual kill switch and the conservative micro-USD
 * provider-spend caps. Caps are enforced inside the same serialized operation
 * that admits a dispatch, so concurrent callers can never exceed them.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  DAILY_CAP_MICRO_USD,
  InvalidPauseReasonError,
  LaunchControl,
  MemoryLaunchControlStore,
  MICRO_USD_PER_USD,
  ROLLING_CAP_MICRO_USD,
  utcDayStart,
  type DebitOutcome,
} from './launch-control.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 0, 1, 12, 0, 0);

function control() {
  const store = new MemoryLaunchControlStore();
  return { store, launch: new LaunchControl({ store, now: () => START }) };
}

function debited(outcome: DebitOutcome): string {
  if (outcome.kind !== 'debited') throw new Error(`expected a debit, got ${outcome.kind}`);
  return outcome.debitId;
}

describe('launch state', () => {
  it('starts enabled and exposes the fixed caps', async () => {
    const { launch } = control();
    await expect(launch.status()).resolves.toMatchObject({ state: 'enabled', reason: null });
    await expect(launch.isPaused()).resolves.toBe(false);

    const spend = await launch.spend();
    expect(spend.dailyCapMicroUsd).toBe(40n * MICRO_USD_PER_USD);
    expect(spend.rollingCapMicroUsd).toBe(200n * MICRO_USD_PER_USD);
    expect(spend.dailyHeadroomMicroUsd).toBe(DAILY_CAP_MICRO_USD);
    expect(spend.rollingHeadroomMicroUsd).toBe(ROLLING_CAP_MICRO_USD);
  });

  it('pauses with a reason and resumes', async () => {
    const { launch } = control();
    const paused = await launch.pause('storage incident');
    expect(paused).toMatchObject({ state: 'paused', reason: 'storage incident' });
    await expect(launch.isPaused()).resolves.toBe(true);

    const resumed = await launch.resume();
    expect(resumed).toMatchObject({ state: 'enabled', reason: null });
    await expect(launch.isPaused()).resolves.toBe(false);
  });

  it('requires a bounded, non-empty pause reason', async () => {
    const { launch } = control();
    await expect(launch.pause('')).rejects.toBeInstanceOf(InvalidPauseReasonError);
    await expect(launch.pause('   ')).rejects.toBeInstanceOf(InvalidPauseReasonError);
    await expect(launch.pause('x'.repeat(201))).rejects.toBeInstanceOf(InvalidPauseReasonError);
    await expect(launch.pause('x'.repeat(200))).resolves.toMatchObject({ state: 'paused' });
  });

  it('refuses admission while paused', async () => {
    const { launch } = control();
    await launch.pause('operator review');
    await expect(launch.beginDispatch(1_000n)).resolves.toEqual({ kind: 'paused' });
  });
});

describe('provider-spend accounting', () => {
  it('holds the conservative dispatch ceiling until it is settled', async () => {
    const { launch } = control();
    const debitId = debited(await launch.beginDispatch(25_000n));

    const held = await launch.spend();
    expect(held.utcDayMicroUsd).toBe(25_000n);
    expect(held.debits).toEqual({ held: 1, retained: 0, released: 0 });

    await launch.retain(debitId);
    const retained = await launch.spend();
    expect(retained.utcDayMicroUsd).toBe(25_000n);
    expect(retained.debits).toEqual({ held: 0, retained: 1, released: 0 });
  });

  it('releases a debit that failed before dispatch and restores headroom', async () => {
    const { launch } = control();
    const debitId = debited(await launch.beginDispatch(25_000n));
    await launch.release(debitId);

    const spend = await launch.spend();
    expect(spend.utcDayMicroUsd).toBe(0n);
    expect(spend.dailyHeadroomMicroUsd).toBe(DAILY_CAP_MICRO_USD);
    expect(spend.debits).toEqual({ held: 0, retained: 0, released: 1 });
  });

  it('never double-settles a debit', async () => {
    const { launch } = control();
    const debitId = debited(await launch.beginDispatch(25_000n));
    await launch.release(debitId);
    await launch.retain(debitId);
    await expect(launch.spend()).resolves.toMatchObject({ utcDayMicroUsd: 0n, debits: { released: 1 } });
  });

  it('rejects a non-positive debit', async () => {
    const { launch } = control();
    await expect(launch.beginDispatch(0n)).rejects.toThrow('invalid_debit_amount');
    await expect(launch.beginDispatch(-1n)).rejects.toThrow('invalid_debit_amount');
  });
});

describe('cap enforcement', () => {
  it('admits up to the daily cap and refuses the next dispatch', async () => {
    const { launch } = control();
    const half = DAILY_CAP_MICRO_USD / 2n;
    expect((await launch.beginDispatch(half)).kind).toBe('debited');
    expect((await launch.beginDispatch(half)).kind).toBe('debited');

    const refused = await launch.beginDispatch(1n);
    expect(refused).toEqual({ kind: 'cap_exhausted', window: 'utc_day' });

    // The exhausted cap is a durable launch state, not a per-request error.
    await expect(launch.status()).resolves.toMatchObject({
      state: 'paused',
      reason: 'provider_spend_cap_exhausted:utc_day',
    });
  });

  it('refuses once the rolling 30-day cap is reached even under the daily cap', async () => {
    const { store } = control();
    const launch = new LaunchControl({ store });
    // Five distinct days at the daily ceiling reach $200 without pausing.
    for (let day = 0; day < 5; day += 1) {
      const at = START + day * DAY_MS;
      const admission = await store.debit(DAILY_CAP_MICRO_USD, at);
      expect(admission.kind).toBe('debited');
    }
    await expect(store.spend(START + 5 * DAY_MS)).resolves.toMatchObject({
      rolling30dMicroUsd: ROLLING_CAP_MICRO_USD,
      rollingHeadroomMicroUsd: 0n,
    });

    await expect(store.debit(1n, START + 5 * DAY_MS)).resolves.toEqual({
      kind: 'cap_exhausted',
      window: 'rolling_30d',
    });
  });

  it('drops debits that fall outside the rolling window', async () => {
    const { store } = control();
    expect((await store.debit(DAILY_CAP_MICRO_USD, START)).kind).toBe('debited');

    // 29 days later it still counts; 31 days later it does not.
    expect((await store.spend(START + 29 * DAY_MS)).rolling30dMicroUsd).toBe(DAILY_CAP_MICRO_USD);
    expect((await store.spend(START + 31 * DAY_MS)).rolling30dMicroUsd).toBe(0n);
  });

  it('resets the daily window at UTC midnight', async () => {
    const { store } = control();
    const lateUtc = Date.UTC(2026, 0, 1, 23, 0, 0);
    const nextUtcDay = Date.UTC(2026, 0, 2, 1, 0, 0);
    expect(utcDayStart(lateUtc)).toBe(Date.UTC(2026, 0, 1));
    expect(utcDayStart(nextUtcDay)).toBe(Date.UTC(2026, 0, 2));

    expect((await store.debit(DAILY_CAP_MICRO_USD, lateUtc)).kind).toBe('debited');
    // Same UTC day: refused.
    await expect(store.debit(1n, lateUtc + 30 * 60 * 1000)).resolves.toEqual({
      kind: 'cap_exhausted',
      window: 'utc_day',
    });
  });

  it('does not charge the next UTC day for the previous day', async () => {
    const { store } = control();
    const lateUtc = Date.UTC(2026, 0, 1, 23, 0, 0);
    expect((await store.debit(DAILY_CAP_MICRO_USD, lateUtc)).kind).toBe('debited');

    const nextDay = Date.UTC(2026, 0, 2, 1, 0, 0);
    await expect(store.debit(DAILY_CAP_MICRO_USD, nextDay)).resolves.toMatchObject({ kind: 'debited' });
    await expect(store.spend(nextDay)).resolves.toMatchObject({
      utcDayMicroUsd: DAILY_CAP_MICRO_USD,
      rolling30dMicroUsd: 2n * DAILY_CAP_MICRO_USD,
    });
  });

  it('admits exactly the cap under concurrent callers', async () => {
    const { store } = control();
    const amount = MICRO_USD_PER_USD; // $1 per dispatch
    const attempts = 60;
    const outcomes = await Promise.all(
      Array.from({ length: attempts }, () => store.debit(amount, START)),
    );
    const admitted = outcomes.filter((outcome) => outcome.kind === 'debited').length;
    const dailyCapUsd = Number(DAILY_CAP_MICRO_USD / MICRO_USD_PER_USD);
    expect(admitted).toBe(dailyCapUsd);
    expect(outcomes.filter((outcome) => outcome.kind !== 'debited').length).toBe(attempts - dailyCapUsd);

    await expect(store.spend(START)).resolves.toMatchObject({ utcDayMicroUsd: DAILY_CAP_MICRO_USD });
  });

  it('survives a restart because the store, not the process, holds the state', async () => {
    const store = new MemoryLaunchControlStore();
    await store.debit(DAILY_CAP_MICRO_USD, START);
    await store.pause('provider_spend_cap_exhausted:utc_day', START);

    // A fresh LaunchControl over the same durable store keeps the pause and spend.
    const afterRestart = new LaunchControl({ store, now: () => START });
    await expect(afterRestart.isPaused()).resolves.toBe(true);
    await expect(afterRestart.spend()).resolves.toMatchObject({ utcDayMicroUsd: DAILY_CAP_MICRO_USD });
  });
});
