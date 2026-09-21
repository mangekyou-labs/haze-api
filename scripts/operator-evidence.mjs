#!/usr/bin/env node
//
// Operator-side measurement and local checking for one activation.
//
//   operator-evidence.mjs warmup    verify the discarded warm-up window
//   operator-evidence.mjs hot       verify the counted exchange window
//   operator-evidence.mjs bundle    write the version-2 evidence bundle
//
// The activation evidence is three snapshots of the sidecar's authenticated
// loopback counters — before the warm-up, after the warm-up, and after the
// counted exchange — rather than one cumulative total. Snapshot deltas are what
// make "exactly one discarded warm-up, then exactly one counted exchange"
// checkable instead of merely asserted, and the hot-prove sample count is what
// separates the two windows: the first prove in a process is the cold sample, so
// a clean warm-up leaves it at zero and the counted exchange raises it to one.
//
// The checks here are a courtesy so an operator finds out immediately. The
// founder's validator in `ts/activation.ts` is authoritative, and this file
// mirrors its rules deliberately: the operator machine has no TypeScript
// toolchain, the same reason `gw_scan_for_secrets` is duplicated in bash.
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const FAILURES = [
  'challenge_unreadable',
  'challenge_unsupported',
  'challenge_stale',
  'payment_preparation_failed',
  'payment_rejected',
  'settlement_failed',
  'transport_failed',
];

const EXCHANGE_FIELDS = ['challengesReceived', 'paymentsPrepared', 'settlementsConfirmed', 'exchangeSuccesses'];
const STAGE_LABELS = {
  challengesReceived: 'the 402 challenge',
  paymentsPrepared: 'the prepared payment',
  settlementsConfirmed: 'the settlement response',
  exchangeSuccesses: 'the completed exchange',
};

function count(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function nullableCount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function parse(name) {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) throw new Error(`${name} is not set; capture the counters first`);
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${name} is not valid JSON; re-read the sidecar metrics`);
  }
}

/** One verbatim read of the sidecar's counters, in the evidence bundle's shape. */
function snapshotOf(body) {
  const exchange = body.exchange ?? {};
  return {
    exchange: {
      ...Object.fromEntries(EXCHANGE_FIELDS.map((field) => [field, count(exchange[field])])),
      failures: count(exchange.failures),
      failuresByCategory: Object.fromEntries(
        FAILURES.map((failure) => [failure, count(exchange.failuresByCategory?.[failure])]),
      ),
    },
    proving: {
      attempts: count(body.attempts),
      successes: count(body.successes),
      failures: count(body.failures),
      retries: count(body.retries),
      hotProveSamples: count(body.hotProve?.samples),
      p50HotProveMs: nullableCount(body.hotProve?.p50Ms),
      p95HotProveMs: nullableCount(body.hotProve?.p95Ms),
    },
  };
}

/** The counters a fresh sidecar reads: all zero, with no latency yet. */
function zeroSnapshot() {
  return {
    exchange: {
      ...Object.fromEntries(EXCHANGE_FIELDS.map((field) => [field, 0])),
      failures: 0,
      failuresByCategory: Object.fromEntries(FAILURES.map((failure) => [failure, 0])),
    },
    proving: {
      attempts: 0,
      successes: 0,
      failures: 0,
      retries: 0,
      hotProveSamples: 0,
      p50HotProveMs: null,
      p95HotProveMs: null,
    },
  };
}

function isZero(snapshot) {
  return JSON.stringify(snapshot) === JSON.stringify(zeroSnapshot());
}

function delta(before, after) {
  const sub = (a, b) => Math.max(0, a - b);
  const addedHotSamples = sub(after.proving.hotProveSamples, before.proving.hotProveSamples);
  return {
    exchange: {
      ...Object.fromEntries(EXCHANGE_FIELDS.map((field) => [field, sub(after.exchange[field], before.exchange[field])])),
      failures: sub(after.exchange.failures, before.exchange.failures),
      failuresByCategory: Object.fromEntries(
        FAILURES.map((failure) => [failure, sub(after.exchange.failuresByCategory[failure], before.exchange.failuresByCategory[failure])]),
      ),
    },
    proving: {
      attempts: sub(after.proving.attempts, before.proving.attempts),
      successes: sub(after.proving.successes, before.proving.successes),
      failures: sub(after.proving.failures, before.proving.failures),
      retries: sub(after.proving.retries, before.proving.retries),
      hotProveSamples: addedHotSamples,
      p50HotProveMs: addedHotSamples > 0 ? after.proving.p50HotProveMs : null,
      p95HotProveMs: addedHotSamples > 0 ? after.proving.p95HotProveMs : null,
    },
  };
}

/** The same window rules the founder's `qualifyActivation` applies. */
function assess(window, label, expectedHotSamples) {
  const problems = [];
  for (const field of EXCHANGE_FIELDS) {
    if (window.exchange[field] > 1) problems.push(`${label} contains more than one ${STAGE_LABELS[field]}`);
    else if (window.exchange[field] < 1) problems.push(`${label} never reached ${STAGE_LABELS[field]}`);
  }
  if (window.exchange.failures > 0) problems.push(`${label} recorded ${window.exchange.failures} failure(s)`);
  for (const failure of FAILURES) {
    if (window.exchange.failuresByCategory[failure] > 0) problems.push(`${label} recorded a ${failure} failure`);
  }
  if (window.proving.attempts > 1) problems.push(`${label} attempted ${window.proving.attempts} proofs; only the exchange's single proof may count`);
  if (window.proving.successes < 1) problems.push(`${label} produced no successful proof`);
  if (window.proving.failures > 0) problems.push(`${label} recorded ${window.proving.failures} proof failure(s)`);
  if (window.proving.retries > 0) problems.push(`${label} recorded ${window.proving.retries} proof retr${window.proving.retries === 1 ? 'y' : 'ies'}`);
  if (window.proving.hotProveSamples !== expectedHotSamples) {
    problems.push(expectedHotSamples === 0
      ? `${label} was not the process's cold sample, so the circuit was already compiled`
      : `${label} did not produce exactly one hot proof sample`);
  }
  return problems;
}

function report(problems, okMessage) {
  if (problems.length === 0) {
    console.log(`  ok: ${okMessage}`);
    return 0;
  }
  for (const problem of problems) console.error(`  ! ${problem}`);
  return 1;
}

function warmupCommand() {
  const fresh = snapshotOf(parse('METRICS_FRESH'));
  const afterWarmup = snapshotOf(parse('METRICS_AFTER_WARMUP'));
  if (!isZero(fresh)) {
    return report(['the sidecar was not fresh: its counters were already non-zero before the warm-up'], '');
  }
  return report(assess(delta(fresh, afterWarmup), 'the warm-up', 0), 'exactly one clean cold warm-up');
}

function hotCommand() {
  const afterWarmup = snapshotOf(parse('METRICS_AFTER_WARMUP'));
  const afterHot = snapshotOf(parse('METRICS_AFTER_HOT'));
  const window = delta(afterWarmup, afterHot);
  const problems = assess(window, 'the counted exchange', 1);
  if (window.proving.p50HotProveMs === null) problems.push('the counted exchange produced no hot prove latency');
  return report(problems, 'exactly one clean counted exchange');
}

function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is not set`);
  return value;
}

function bundleCommand() {
  const evidence = {
    kind: 'zk-credits.operator-activation-evidence',
    schemaVersion: 2,
    slot: requireEnv('SLOT'),
    participantType: requireEnv('PARTICIPANT_TYPE'),
    integrationMode: requireEnv('INTEGRATION_MODE'),
    versions: {
      sidecar: requireEnv('PINNED_SIDECAR_VERSION'),
      adapter: requireEnv('PINNED_ADAPTER_VERSION'),
      shared: requireEnv('PINNED_SHARED_VERSION'),
      artifactRelease: requireEnv('PINNED_ARTIFACT_RELEASE'),
    },
    activatedAt: new Date().toISOString(),
    onboardingDurationMs: Number(requireEnv('ONBOARDING_MS')),
    counters: {
      beforeWarmup: snapshotOf(parse('METRICS_FRESH')),
      afterWarmup: snapshotOf(parse('METRICS_AFTER_WARMUP')),
      afterHotExchange: snapshotOf(parse('METRICS_AFTER_HOT')),
    },
    assistanceCount: Number(requireEnv('ASSISTANCE')),
    attestations: {
      ranAgentLocally: process.env.ATTEST_LOCAL === 'true',
      credentialStayedLocal: process.env.ATTEST_CREDENTIAL === 'true',
      noManualRecovery: process.env.ATTEST_NO_RECOVERY === 'true',
      distinctOperatorOwnership: process.env.ATTEST_OWNERSHIP === 'true',
    },
  };

  // The bundle is a fixed vocabulary: reject anything outside it locally, so a
  // malformed activation is caught here rather than after it is sent.
  const allowed = new Set([
    'kind', 'schemaVersion', 'slot', 'participantType', 'integrationMode', 'versions',
    'activatedAt', 'onboardingDurationMs', 'counters', 'assistanceCount', 'attestations',
  ]);
  const stray = Object.keys(evidence).filter((key) => !allowed.has(key));
  if (stray.length > 0) throw new Error(`unexpected evidence fields: ${stray.join(', ')}`);

  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;

  // A key that names a secret implies a value that carries one. The single
  // exception is the schema's own `credentialStayedLocal` attestation: it
  // asserts where the credential stayed and carries no credential. Matching the
  // serialized text instead of the keys would reject that legitimate field, so
  // the check is on key names, with the fixed key set above as the real guard.
  const SECRET_KEY_TERM = /(prompt|response|nullifier|proof|signal|secret|credential|token|wallet|account|github|commitment|balance|payer)/iu;
  const safeKeys = new Set(['credentialStayedLocal']);
  const offending = [...serialized.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"\s*:/gu)]
    .map((match) => match[1])
    .filter((key) => SECRET_KEY_TERM.test(key) && !safeKeys.has(key));
  if (offending.length > 0) throw new Error(`evidence would carry a ${offending[0]} field`);

  const bundle = requireEnv('BUNDLE');
  writeFileSync(bundle, serialized);
  console.log(`  ✓ wrote ${bundle}`);
  console.log(`  sha256: ${createHash('sha256').update(serialized).digest('hex')}`);

  const hot = delta(evidence.counters.afterWarmup, evidence.counters.afterHotExchange);
  console.log(`  counted exchange: ${hot.exchange.exchangeSuccesses} succeeded, ${hot.exchange.failures} failed, ${hot.proving.hotProveSamples} hot proof sample(s)`);
  return 0;
}

const command = process.argv[2];
try {
  const status = command === 'warmup' ? warmupCommand()
    : command === 'hot' ? hotCommand()
      : command === 'bundle' ? bundleCommand()
        : (() => { console.error('usage: operator-evidence.mjs <warmup|hot|bundle>'); return 2; })();
  process.exit(status);
} catch (error) {
  console.error(`  ! ${error instanceof Error ? error.message : 'unknown'}`);
  process.exit(1);
}
