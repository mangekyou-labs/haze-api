/**
 * Versioned operator activation evidence for the invite-only unpaid pilot.
 *
 * This bundle is the only artifact committed for an operator activation, so it
 * has to be structurally incapable of carrying anything private. Every leaf is
 * an enum, a pinned version, one pinned artifact release, an ISO timestamp, a
 * boolean attestation, a bounded integer, or a nullable latency. Unknown keys
 * are rejected at every depth.
 *
 * The consequence is that a prompt, a response, a proof, a public signal, a
 * nullifier, an invite or funding token, a credential identifier, a GitHub
 * identity, a remaining balance, or a spend-plane identifier has no
 * representable form: there is no string field wide enough to hold one. The
 * denylist below is defense in depth against a future field being added.
 *
 * Schema version 2 reports three counter snapshots read from the operator's
 * authenticated loopback `/metrics` body instead of one cumulative total:
 *
 *   beforeWarmup      a fresh sidecar reads zero here
 *   afterWarmup       the activation baseline, taken after exactly one
 *                     discarded cold proof
 *   afterHotExchange  the end of the single counted exchange
 *
 * Snapshots rather than totals make the warm-up, the hot exchange, and any
 * traffic that contaminated either one arithmetically separable, so
 * qualification can require exactly one clean warm-up and exactly one clean
 * hot exchange instead of trusting a cumulative number an operator typed in.
 * Every exchange and proving counter and every failure category is reported as
 * a delta between two snapshots.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  ZK_PREPAID_LIFECYCLE_FAILURES,
  ZK_PREPAID_LIFECYCLE_STAGES,
  type ZkPrepaidLifecycleFailure,
} from '@zk-credits/x402-zk-prepaid';

export const ACTIVATION_EVIDENCE_KIND = 'zk-credits.operator-activation-evidence' as const;
export const ACTIVATION_EVIDENCE_SCHEMA_VERSION = 2 as const;

export const OPERATOR_SLOTS = ['A', 'B', 'C'] as const;
export type OperatorSlot = (typeof OPERATOR_SLOTS)[number];

export const PARTICIPANT_TYPES = ['coding_agent', 'x402_native_agent'] as const;
export type ParticipantType = (typeof PARTICIPANT_TYPES)[number];

export const INTEGRATION_MODES = ['openai_compatible_sidecar', 'x402_zk_prepaid_adapter'] as const;
export type IntegrationMode = (typeof INTEGRATION_MODES)[number];

/**
 * Deterministic slot assignment. A and C are OpenAI-compatible sidecar
 * daily-driver calls; B is an existing x402-native agent that explicitly
 * registers the project adapter.
 */
export const SLOT_ASSIGNMENT: Record<OperatorSlot, { participantType: ParticipantType; integrationMode: IntegrationMode }> = {
  A: { participantType: 'coding_agent', integrationMode: 'openai_compatible_sidecar' },
  B: { participantType: 'x402_native_agent', integrationMode: 'x402_zk_prepaid_adapter' },
  C: { participantType: 'coding_agent', integrationMode: 'openai_compatible_sidecar' },
};

/** Exact published versions. An activation pinned to anything else is rejected. */
export const PINNED_ACTIVATION_VERSIONS = {
  sidecar: '0.2.0',
  adapter: '0.1.0',
  shared: '0.1.0',
} as const;

export const PINNED_ARTIFACT_RELEASE = 'private-credit-spend-bn254-dev-sepolia-v1';

/** Where each snapshot sits in the activation sequence. */
export const COUNTER_SNAPSHOT_KEYS = ['beforeWarmup', 'afterWarmup', 'afterHotExchange'] as const;
export type CounterSnapshotKey = (typeof COUNTER_SNAPSHOT_KEYS)[number];

export interface ActivationExchangeCounters {
  challengesReceived: number;
  paymentsPrepared: number;
  settlementsConfirmed: number;
  exchangeSuccesses: number;
  failures: number;
  failuresByCategory: Record<ZkPrepaidLifecycleFailure, number>;
}

export interface ActivationProvingCounters {
  attempts: number;
  successes: number;
  failures: number;
  retries: number;
  /**
   * Hot prove samples. The cold sample is the first prove in a process, so a
   * clean warm-up leaves this at zero and the counted exchange raises it to
   * one. It is what separates a warm-up from the exchange that follows it.
   */
  hotProveSamples: number;
  p50HotProveMs: number | null;
  p95HotProveMs: number | null;
}

/** One verbatim read of the sidecar's authenticated loopback counters. */
export interface ActivationCounterSnapshot {
  exchange: ActivationExchangeCounters;
  proving: ActivationProvingCounters;
}

/**
 * A difference between two snapshots. Percentiles are not subtractable, so the
 * window's percentile is reported only when the window added a hot sample.
 */
export interface ActivationCounterDeltas {
  exchange: ActivationExchangeCounters;
  proving: {
    attempts: number;
    successes: number;
    failures: number;
    retries: number;
    hotProveSamples: number;
    p50HotProveMs: number | null;
    p95HotProveMs: number | null;
  };
}

export interface ActivationAttestations {
  /** The operator ran the agent on their own machine. */
  ranAgentLocally: boolean;
  /** The credential secret never left the operator's machine. */
  credentialStayedLocal: boolean;
  /** No founder or automated recovery handled the credential secret. */
  noManualRecovery: boolean;
  /** The operator is a distinct person holding this slot. */
  distinctOperatorOwnership: boolean;
}

export interface ActivationEvidence {
  kind: typeof ACTIVATION_EVIDENCE_KIND;
  schemaVersion: typeof ACTIVATION_EVIDENCE_SCHEMA_VERSION;
  slot: OperatorSlot;
  participantType: ParticipantType;
  integrationMode: IntegrationMode;
  versions: {
    sidecar: string;
    adapter: string;
    shared: string;
    artifactRelease: string;
  };
  activatedAt: string;
  onboardingDurationMs: number;
  counters: Record<CounterSnapshotKey, ActivationCounterSnapshot>;
  assistanceCount: number;
  attestations: ActivationAttestations;
}

export interface EvidenceFailure {
  /** Dotted path to the offending value, or the key itself. */
  path: string;
  reason: string;
}

export interface EvidenceValidation {
  valid: boolean;
  failures: EvidenceFailure[];
}

/**
 * Terms that must never appear as a key in an evidence bundle. Matching is
 * case-insensitive and ignores separators, so `githubAccountId`, `github_account_id`,
 * and `GithubAccountID` are all caught.
 */
export const ACTIVATION_DENYLIST_KEYS = [
  // identities
  'githubaccountid', 'githubid', 'githublogin', 'login', 'username', 'email', 'identity',
  // invite and funding material
  'invitecode', 'inviteid', 'code', 'fundingtoken', 'token', 'secret',
  // credential and wallet material
  'credential', 'credentialid', 'commitment', 'wallet', 'address', 'privatekey', 'password',
  // request and proof material
  'prompt', 'response', 'messages', 'requestbody', 'url', 'headers', 'signal', 'requestsignal',
  'nonce', 'responsekey', 'proof', 'publicsignals', 'nullifier', 'share', 'witness',
  // spend-plane and balance material
  'reservationid', 'claimid', 'claim', 'fencingtoken', 'generation', 'payer', 'tier',
  'order', 'account', 'user', 'subject', 'balance', 'remainingcredits', 'remainingbalance',
  'spend',
] as const;

const DENYLIST = new Set<string>(ACTIVATION_DENYLIST_KEYS);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/u.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function checkDenylist(value: unknown, path: string, failures: EvidenceFailure[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkDenylist(item, `${path}[${index}]`, failures));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const child = path ? `${path}.${key}` : key;
    if (DENYLIST.has(normalizeKey(key))) {
      failures.push({ path: child, reason: 'denylisted_key' });
      continue;
    }
    checkDenylist(item, child, failures);
  }
}

function checkUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, failures: EvidenceFailure[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) failures.push({ path: path ? `${path}.${key}` : key, reason: 'unknown_key' });
  }
}

const EVIDENCE_KEYS = [
  'kind', 'schemaVersion', 'slot', 'participantType', 'integrationMode',
  'versions', 'activatedAt', 'onboardingDurationMs', 'counters',
  'assistanceCount', 'attestations',
] as const;

const VERSION_KEYS = ['sidecar', 'adapter', 'shared', 'artifactRelease'] as const;
const SNAPSHOT_KEYS = ['exchange', 'proving'] as const;
const EXCHANGE_KEYS = [...ZK_PREPAID_LIFECYCLE_STAGES.map((stage) => stageCounterKey(stage)), 'failures', 'failuresByCategory'] as const;
const PROVING_KEYS = ['attempts', 'successes', 'failures', 'retries', 'hotProveSamples', 'p50HotProveMs', 'p95HotProveMs'] as const;
const ATTESTATION_KEYS = ['ranAgentLocally', 'credentialStayedLocal', 'noManualRecovery', 'distinctOperatorOwnership'] as const;
const EXCHANGE_COUNT_KEYS = ['challengesReceived', 'paymentsPrepared', 'settlementsConfirmed', 'exchangeSuccesses', 'failures'] as const;
const PROVING_COUNT_KEYS = ['attempts', 'successes', 'failures', 'retries', 'hotProveSamples'] as const;
const PROVING_PERCENTILE_KEYS = ['p50HotProveMs', 'p95HotProveMs'] as const;

function stageCounterKey(stage: (typeof ZK_PREPAID_LIFECYCLE_STAGES)[number]): string {
  return {
    challenge_received: 'challengesReceived',
    payment_prepared: 'paymentsPrepared',
    settlement_confirmed: 'settlementsConfirmed',
    exchange_succeeded: 'exchangeSuccesses',
  }[stage];
}

/** All-zero counters: what a freshly started sidecar reports. */
export function zeroActivationSnapshot(): ActivationCounterSnapshot {
  return {
    exchange: {
      challengesReceived: 0,
      paymentsPrepared: 0,
      settlementsConfirmed: 0,
      exchangeSuccesses: 0,
      failures: 0,
      failuresByCategory: Object.fromEntries(
        ZK_PREPAID_LIFECYCLE_FAILURES.map((failure) => [failure, 0]),
      ) as Record<ZkPrepaidLifecycleFailure, number>,
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

/** True when no counter moved, so a fresh sidecar can be proven fresh. */
export function activationSnapshotIsZero(snapshot: ActivationCounterSnapshot): boolean {
  const expected = zeroActivationSnapshot();
  return JSON.stringify(snapshot) === JSON.stringify(expected);
}

/**
 * Subtracts two snapshots. This is the only place a delta is produced, so the
 * warm-up window, the hot window, and the total agree by construction.
 */
export function deriveActivationDeltas(
  before: ActivationCounterSnapshot,
  after: ActivationCounterSnapshot,
): ActivationCounterDeltas {
  const difference = (a: number, b: number): number => Math.max(0, a - b);
  const failuresByCategory = Object.fromEntries(
    ZK_PREPAID_LIFECYCLE_FAILURES.map((failure) => [
      failure,
      difference(after.exchange.failuresByCategory[failure], before.exchange.failuresByCategory[failure]),
    ]),
  ) as Record<ZkPrepaidLifecycleFailure, number>;
  const addedHotSamples = difference(after.proving.hotProveSamples, before.proving.hotProveSamples);
  return {
    exchange: {
      challengesReceived: difference(after.exchange.challengesReceived, before.exchange.challengesReceived),
      paymentsPrepared: difference(after.exchange.paymentsPrepared, before.exchange.paymentsPrepared),
      settlementsConfirmed: difference(after.exchange.settlementsConfirmed, before.exchange.settlementsConfirmed),
      exchangeSuccesses: difference(after.exchange.exchangeSuccesses, before.exchange.exchangeSuccesses),
      failures: difference(after.exchange.failures, before.exchange.failures),
      failuresByCategory,
    },
    proving: {
      attempts: difference(after.proving.attempts, before.proving.attempts),
      successes: difference(after.proving.successes, before.proving.successes),
      failures: difference(after.proving.failures, before.proving.failures),
      retries: difference(after.proving.retries, before.proving.retries),
      hotProveSamples: addedHotSamples,
      // A percentile is not subtractable: it describes the window only when the
      // window contributed a sample of its own.
      p50HotProveMs: addedHotSamples > 0 ? after.proving.p50HotProveMs : null,
      p95HotProveMs: addedHotSamples > 0 ? after.proving.p95HotProveMs : null,
    },
  };
}

function validateSnapshot(value: unknown, path: string, failures: EvidenceFailure[]): void {
  if (!isRecord(value)) {
    failures.push({ path, reason: 'not_an_object' });
    return;
  }
  checkUnknownKeys(value, SNAPSHOT_KEYS, path, failures);

  if (!isRecord(value.exchange)) failures.push({ path: `${path}.exchange`, reason: 'not_an_object' });
  else {
    checkUnknownKeys(value.exchange, EXCHANGE_KEYS, `${path}.exchange`, failures);
    for (const key of EXCHANGE_COUNT_KEYS) {
      if (!isCount(value.exchange[key])) failures.push({ path: `${path}.exchange.${key}`, reason: 'not_a_count' });
    }
    if (!isRecord(value.exchange.failuresByCategory)) failures.push({ path: `${path}.exchange.failuresByCategory`, reason: 'not_an_object' });
    else {
      checkUnknownKeys(value.exchange.failuresByCategory, ZK_PREPAID_LIFECYCLE_FAILURES, `${path}.exchange.failuresByCategory`, failures);
      for (const failure of ZK_PREPAID_LIFECYCLE_FAILURES) {
        if (!isCount(value.exchange.failuresByCategory[failure])) {
          failures.push({ path: `${path}.exchange.failuresByCategory.${failure}`, reason: 'not_a_count' });
        }
      }
    }
  }

  if (!isRecord(value.proving)) failures.push({ path: `${path}.proving`, reason: 'not_an_object' });
  else {
    checkUnknownKeys(value.proving, PROVING_KEYS, `${path}.proving`, failures);
    for (const key of PROVING_COUNT_KEYS) {
      if (!isCount(value.proving[key])) failures.push({ path: `${path}.proving.${key}`, reason: 'not_a_count' });
    }
    for (const key of PROVING_PERCENTILE_KEYS) {
      const percentile = value.proving[key];
      if (percentile !== null && !(typeof percentile === 'number' && Number.isFinite(percentile) && percentile >= 0)) {
        failures.push({ path: `${path}.proving.${key}`, reason: 'not_a_percentile' });
      }
    }
  }
}

/**
 * Validates an operator evidence bundle against the fixed schema.
 *
 * A failure list is returned rather than a thrown error so the founder command
 * can report every problem at once. `expectedSlot` additionally enforces the
 * deterministic participant type and integration mode for that slot.
 */
export function validateActivationEvidence(value: unknown, expectedSlot?: OperatorSlot): EvidenceValidation {
  const failures: EvidenceFailure[] = [];
  if (!isRecord(value)) return { valid: false, failures: [{ path: '', reason: 'not_an_object' }] };

  checkDenylist(value, '', failures);
  checkUnknownKeys(value, EVIDENCE_KEYS, '', failures);

  if (value.kind !== ACTIVATION_EVIDENCE_KIND) failures.push({ path: 'kind', reason: 'wrong_kind' });
  if (value.schemaVersion !== ACTIVATION_EVIDENCE_SCHEMA_VERSION) failures.push({ path: 'schemaVersion', reason: 'unsupported_schema_version' });

  const slot = value.slot;
  if (typeof slot !== 'string' || !(OPERATOR_SLOTS as readonly string[]).includes(slot)) {
    failures.push({ path: 'slot', reason: 'unknown_slot' });
  } else if (expectedSlot !== undefined && slot !== expectedSlot) {
    failures.push({ path: 'slot', reason: 'slot_mismatch' });
  }

  if (typeof slot === 'string' && (OPERATOR_SLOTS as readonly string[]).includes(slot)) {
    const expected = SLOT_ASSIGNMENT[slot as OperatorSlot];
    if (value.participantType !== expected.participantType) failures.push({ path: 'participantType', reason: 'slot_participant_type_mismatch' });
    if (value.integrationMode !== expected.integrationMode) failures.push({ path: 'integrationMode', reason: 'slot_integration_mode_mismatch' });
  } else {
    if (typeof value.participantType !== 'string' || !(PARTICIPANT_TYPES as readonly string[]).includes(value.participantType)) {
      failures.push({ path: 'participantType', reason: 'unknown_participant_type' });
    }
    if (typeof value.integrationMode !== 'string' || !(INTEGRATION_MODES as readonly string[]).includes(value.integrationMode)) {
      failures.push({ path: 'integrationMode', reason: 'unknown_integration_mode' });
    }
  }

  if (!isRecord(value.versions)) failures.push({ path: 'versions', reason: 'not_an_object' });
  else {
    checkUnknownKeys(value.versions, VERSION_KEYS, 'versions', failures);
    for (const [key, pinned] of Object.entries(PINNED_ACTIVATION_VERSIONS)) {
      if (value.versions[key] !== pinned) failures.push({ path: `versions.${key}`, reason: 'unpinned_version' });
    }
    if (value.versions.artifactRelease !== PINNED_ARTIFACT_RELEASE) failures.push({ path: 'versions.artifactRelease', reason: 'unpinned_artifact_release' });
  }

  if (!isIsoTimestamp(value.activatedAt)) failures.push({ path: 'activatedAt', reason: 'not_an_iso_timestamp' });
  if (!isCount(value.onboardingDurationMs)) failures.push({ path: 'onboardingDurationMs', reason: 'not_a_duration' });
  if (!isCount(value.assistanceCount)) failures.push({ path: 'assistanceCount', reason: 'not_a_count' });

  if (!isRecord(value.counters)) failures.push({ path: 'counters', reason: 'not_an_object' });
  else {
    checkUnknownKeys(value.counters, COUNTER_SNAPSHOT_KEYS, 'counters', failures);
    for (const key of COUNTER_SNAPSHOT_KEYS) validateSnapshot(value.counters[key], `counters.${key}`, failures);
  }

  if (!isRecord(value.attestations)) failures.push({ path: 'attestations', reason: 'not_an_object' });
  else {
    checkUnknownKeys(value.attestations, ATTESTATION_KEYS, 'attestations', failures);
    for (const key of ATTESTATION_KEYS) {
      if (typeof value.attestations[key] !== 'boolean') failures.push({ path: `attestations.${key}`, reason: 'not_a_boolean' });
    }
  }

  return { valid: failures.length === 0, failures };
}

/**
 * A JSON Schema document mirroring the validator, so an operator's local check
 * can agree with the founder's authoritative one.
 */
export function activationEvidenceJsonSchema(): Record<string, unknown> {
  const count = { type: 'integer', minimum: 0 } as const;
  const percentile = { type: ['number', 'null'], minimum: 0 } as const;
  const snapshot = {
    type: 'object',
    additionalProperties: false,
    required: [...SNAPSHOT_KEYS],
    properties: {
      exchange: {
        type: 'object',
        additionalProperties: false,
        required: [...EXCHANGE_KEYS],
        properties: {
          ...Object.fromEntries(ZK_PREPAID_LIFECYCLE_STAGES.map((stage) => [stageCounterKey(stage), count])),
          failures: count,
          failuresByCategory: {
            type: 'object',
            additionalProperties: false,
            required: [...ZK_PREPAID_LIFECYCLE_FAILURES],
            properties: Object.fromEntries(ZK_PREPAID_LIFECYCLE_FAILURES.map((failure) => [failure, count])),
          },
        },
      },
      proving: {
        type: 'object',
        additionalProperties: false,
        required: [...PROVING_KEYS],
        properties: {
          attempts: count,
          successes: count,
          failures: count,
          retries: count,
          hotProveSamples: count,
          p50HotProveMs: percentile,
          p95HotProveMs: percentile,
        },
      },
    },
  };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${ACTIVATION_EVIDENCE_KIND}@${ACTIVATION_EVIDENCE_SCHEMA_VERSION}`,
    title: 'zk-credits operator activation evidence',
    type: 'object',
    additionalProperties: false,
    required: [...EVIDENCE_KEYS],
    properties: {
      kind: { const: ACTIVATION_EVIDENCE_KIND },
      schemaVersion: { const: ACTIVATION_EVIDENCE_SCHEMA_VERSION },
      slot: { enum: [...OPERATOR_SLOTS] },
      participantType: { enum: [...PARTICIPANT_TYPES] },
      integrationMode: { enum: [...INTEGRATION_MODES] },
      versions: {
        type: 'object',
        additionalProperties: false,
        required: [...VERSION_KEYS],
        properties: {
          sidecar: { const: PINNED_ACTIVATION_VERSIONS.sidecar },
          adapter: { const: PINNED_ACTIVATION_VERSIONS.adapter },
          shared: { const: PINNED_ACTIVATION_VERSIONS.shared },
          artifactRelease: { const: PINNED_ARTIFACT_RELEASE },
        },
      },
      activatedAt: { type: 'string', format: 'date-time', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z$' },
      onboardingDurationMs: count,
      counters: {
        type: 'object',
        additionalProperties: false,
        required: [...COUNTER_SNAPSHOT_KEYS],
        properties: Object.fromEntries(COUNTER_SNAPSHOT_KEYS.map((key) => [key, snapshot])),
      },
      assistanceCount: count,
      attestations: {
        type: 'object',
        additionalProperties: false,
        required: [...ATTESTATION_KEYS],
        properties: Object.fromEntries(ATTESTATION_KEYS.map((key) => [key, { type: 'boolean' }])),
      },
    },
  };
}
