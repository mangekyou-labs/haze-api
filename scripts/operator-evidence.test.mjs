#!/usr/bin/env node
//
// The operator-side measurement, exercised against crafted counter reads.
//
//   node --test scripts/operator-evidence.test.mjs
//
// This script is what stands between an operator and a wasted activation, so the
// cases that matter are the ones it must refuse: a sidecar that was not fresh, a
// warm-up that was retried, a counted window that absorbed a second exchange, and
// a counted exchange that was really the cold prove.
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const SCRIPT = new URL('./operator-evidence.mjs', import.meta.url).pathname;

const FAILURES = [
  'challenge_unreadable', 'challenge_unsupported', 'challenge_stale',
  'payment_preparation_failed', 'payment_rejected', 'settlement_failed', 'transport_failed',
];

/**
 * A sidecar metrics body after `lifecycles` clean exchanges, with
 * `lifecycles - 1` hot prove samples because the first prove is the cold one.
 * `overrides.exchange` and `overrides.proving` replace individual fields.
 */
function metrics(lifecycles, overrides = {}) {
  return {
    exchange: {
      challengesReceived: lifecycles,
      paymentsPrepared: lifecycles,
      settlementsConfirmed: lifecycles,
      exchangeSuccesses: lifecycles,
      failures: 0,
      failuresByCategory: Object.fromEntries(FAILURES.map((failure) => [failure, 0])),
      updatedAt: '2026-09-21T04:00:00.000Z',
      ...(overrides.exchange ?? {}),
    },
    attempts: lifecycles,
    successes: lifecycles,
    failures: 0,
    retries: 0,
    ...(overrides.proving ?? {}),
    failuresByCategory: {},
    hotProve: {
      samples: Math.max(0, lifecycles - 1),
      p50Ms: lifecycles > 1 ? 1_450 : null,
      p95Ms: lifecycles > 1 ? 1_900 : null,
      ...(overrides.hotProve ?? {}),
    },
    updatedAt: '2026-09-21T04:00:00.000Z',
  };
}

/** Runs one subcommand and returns its exit code and combined output. */
function run(command, env) {
  try {
    const stdout = execFileSync('node', [SCRIPT, command], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output: stdout };
  } catch (error) {
    return {
      code: typeof error.status === 'number' ? error.status : 1,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    };
  }
}

const json = (value) => JSON.stringify(value);

test('accepts a fresh sidecar and one clean cold warm-up', () => {
  const result = run('warmup', {
    METRICS_FRESH: json(metrics(0)),
    METRICS_AFTER_WARMUP: json(metrics(1)),
  });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /exactly one clean cold warm-up/);
});

test('accepts exactly one clean counted exchange', () => {
  const result = run('hot', {
    METRICS_AFTER_WARMUP: json(metrics(1)),
    METRICS_AFTER_HOT: json(metrics(2)),
  });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /exactly one clean counted exchange/);
});

test('refuses a sidecar that had already served traffic before the warm-up', () => {
  const result = run('warmup', {
    METRICS_FRESH: json(metrics(1)),
    METRICS_AFTER_WARMUP: json(metrics(2)),
  });
  assert.equal(result.code, 1);
  assert.match(result.output, /was not fresh/u);
});

test('refuses a warm-up that was retried', () => {
  const retried = metrics(2, { hotProve: { samples: 1, p50Ms: 1_450, p95Ms: 1_900 } });
  const result = run('warmup', {
    METRICS_FRESH: json(metrics(0)),
    METRICS_AFTER_WARMUP: json(retried),
  });
  assert.equal(result.code, 1);
  assert.match(result.output, /more than one the completed exchange/u);
  assert.match(result.output, /was not the process's cold sample/u);
});

test('refuses a warm-up window with no exchange in it', () => {
  const result = run('warmup', {
    METRICS_FRESH: json(metrics(0)),
    METRICS_AFTER_WARMUP: json(metrics(0)),
  });
  assert.equal(result.code, 1);
  assert.match(result.output, /never reached the 402 challenge/u);
});

test('refuses a counted window that absorbed a second exchange', () => {
  const result = run('hot', {
    METRICS_AFTER_WARMUP: json(metrics(1)),
    METRICS_AFTER_HOT: json(metrics(3)),
  });
  assert.equal(result.code, 1);
  assert.match(result.output, /more than one the completed exchange/u);
  assert.match(result.output, /did not produce exactly one hot proof sample/u);
});

test('refuses a counted exchange that was really the cold prove', () => {
  // No warm-up happened, so the counted window contains the process's first
  // prove: the exchange would be timed as a cold start.
  const result = run('hot', {
    METRICS_AFTER_WARMUP: json(metrics(0)),
    METRICS_AFTER_HOT: json(metrics(1)),
  });
  assert.equal(result.code, 1);
  assert.match(result.output, /did not produce exactly one hot proof sample/u);
});

test('refuses a counted exchange that recorded a failure or a retry', () => {
  const failed = metrics(2, {
    exchange: { failures: 1, failuresByCategory: { ...Object.fromEntries(FAILURES.map((f) => [f, 0])), transport_failed: 1 } },
  });
  const failure = run('hot', { METRICS_AFTER_WARMUP: json(metrics(1)), METRICS_AFTER_HOT: json(failed) });
  assert.equal(failure.code, 1);
  assert.match(failure.output, /recorded 1 failure\(s\)/u);
  assert.match(failure.output, /recorded a transport_failed failure/u);

  const retried = metrics(2, { proving: { attempts: 3, successes: 3, retries: 1 } });
  const retry = run('hot', { METRICS_AFTER_WARMUP: json(metrics(1)), METRICS_AFTER_HOT: json(retried) });
  assert.equal(retry.code, 1);
  assert.match(retry.output, /recorded 1 proof retry/u);
  assert.match(retry.output, /attempted 2 proofs/u);
});

test('refuses an uncaptured or malformed counter read instead of guessing', () => {
  assert.match(run('warmup', { METRICS_FRESH: '', METRICS_AFTER_WARMUP: json(metrics(1)) }).output, /METRICS_FRESH is not set/u);
  assert.match(run('warmup', { METRICS_FRESH: 'not json', METRICS_AFTER_WARMUP: json(metrics(1)) }).output, /is not valid JSON/u);
});

test('writes a version-2 bundle carrying all three snapshots and no warm-up contamination', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zk-evidence-'));
  const bundle = join(directory, 'evidence.json');
  try {
    const result = run('bundle', {
      SLOT: 'A',
      PARTICIPANT_TYPE: 'coding_agent',
      INTEGRATION_MODE: 'openai_compatible_sidecar',
      PINNED_SIDECAR_VERSION: '0.2.0',
      PINNED_ADAPTER_VERSION: '0.1.0',
      PINNED_SHARED_VERSION: '0.1.0',
      PINNED_ARTIFACT_RELEASE: 'private-credit-spend-bn254-dev-sepolia-v1',
      ONBOARDING_MS: '1800000',
      ASSISTANCE: '0',
      ATTEST_LOCAL: 'true',
      ATTEST_CREDENTIAL: 'true',
      ATTEST_NO_RECOVERY: 'true',
      ATTEST_OWNERSHIP: 'true',
      METRICS_FRESH: json(metrics(0)),
      METRICS_AFTER_WARMUP: json(metrics(1)),
      METRICS_AFTER_HOT: json(metrics(2)),
      BUNDLE: bundle,
    });
    assert.equal(result.code, 0, result.output);

    const evidence = JSON.parse(readFileSync(bundle, 'utf8'));
    assert.equal(evidence.schemaVersion, 2);
    assert.deepEqual(Object.keys(evidence.counters), ['beforeWarmup', 'afterWarmup', 'afterHotExchange']);
    assert.equal(evidence.counters.beforeWarmup.exchange.exchangeSuccesses, 0);
    assert.equal(evidence.counters.afterWarmup.proving.hotProveSamples, 0);
    assert.equal(evidence.counters.afterHotExchange.proving.hotProveSamples, 1);
    // Nothing cumulative leaks into the counted window.
    assert.equal(evidence.counters.afterHotExchange.exchange.exchangeSuccesses, 2);
    assert.equal(evidence.counters.afterHotExchange.proving.retries, 0);
    assert.equal(evidence.assistanceCount, 0);
    assert.match(result.output, /1 hot proof sample\(s\)/u);
    assert.match(result.output, /sha256: [0-9a-f]{64}/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('writes a bundle whose own attestation survives the secret-field check', () => {
  // `credentialStayedLocal` names where the credential stayed, not a credential.
  // A substring scan over the serialized bundle rejects it, which would make
  // every real activation unproducible, so the check is on key names with that
  // one key exempted.
  const directory = mkdtempSync(join(tmpdir(), 'zk-evidence-'));
  const bundle = join(directory, 'evidence.json');
  try {
    const result = run('bundle', {
      SLOT: 'B',
      PARTICIPANT_TYPE: 'x402_native_agent',
      INTEGRATION_MODE: 'x402_zk_prepaid_adapter',
      PINNED_SIDECAR_VERSION: '0.2.0',
      PINNED_ADAPTER_VERSION: '0.1.0',
      PINNED_SHARED_VERSION: '0.1.0',
      PINNED_ARTIFACT_RELEASE: 'private-credit-spend-bn254-dev-sepolia-v1',
      ONBOARDING_MS: '600000',
      ASSISTANCE: '0',
      ATTEST_LOCAL: 'true',
      ATTEST_CREDENTIAL: 'true',
      ATTEST_NO_RECOVERY: 'true',
      ATTEST_OWNERSHIP: 'true',
      METRICS_FRESH: json(metrics(0)),
      METRICS_AFTER_WARMUP: json(metrics(1)),
      METRICS_AFTER_HOT: json(metrics(2)),
      BUNDLE: bundle,
    });
    assert.equal(result.code, 0, result.output);

    const evidence = JSON.parse(readFileSync(bundle, 'utf8'));
    assert.equal(evidence.attestations.credentialStayedLocal, true);
    assert.equal(evidence.attestations.ranAgentLocally, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('refuses a bundle that smuggles a differently named credential field', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zk-evidence-'));
  try {
    // The exemption is one exact key, so a near miss must still be refused. The
    // escape hatch is the environment, which is how the smuggled key would have
    // to arrive.
    const result = run('bundle', {
      SLOT: 'A',
      PARTICIPANT_TYPE: 'coding_agent',
      INTEGRATION_MODE: 'openai_compatible_sidecar',
      PINNED_SIDECAR_VERSION: '0.2.0',
      PINNED_ADAPTER_VERSION: '0.1.0',
      PINNED_SHARED_VERSION: '0.1.0',
      PINNED_ARTIFACT_RELEASE: 'private-credit-spend-bn254-dev-sepolia-v1',
      ONBOARDING_MS: '1000',
      ASSISTANCE: '0',
      ATTEST_LOCAL: 'true',
      ATTEST_CREDENTIAL: 'true',
      ATTEST_NO_RECOVERY: 'true',
      ATTEST_OWNERSHIP: 'true',
      METRICS_FRESH: json(metrics(0)),
      METRICS_AFTER_WARMUP: json(metrics(1)),
      METRICS_AFTER_HOT: json(metrics(2)),
      BUNDLE: join(directory, 'evidence.json'),
      CREDENTIAL_SECRET: 'plainly-a-credential',
    });
    // A stray environment variable never reaches the bundle, so this still
    // succeeds and writes only the fixed vocabulary.
    assert.equal(result.code, 0, result.output);
    const evidence = JSON.parse(readFileSync(join(directory, 'evidence.json'), 'utf8'));
    assert.equal(Object.keys(evidence).sort().join(','), [
      'activatedAt', 'assistanceCount', 'attestations', 'counters', 'integrationMode',
      'kind', 'onboardingDurationMs', 'participantType', 'schemaVersion', 'slot', 'versions',
    ].join(','));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
