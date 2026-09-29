/**
 * Operator activation evidence and the founder activation coordinator.
 *
 * The privacy assertions here are the point of the suite: an evidence bundle
 * must have no representable field for a prompt, a response, a proof, a public
 * signal, a nullifier, a secret, a credential identifier, an invite or funding
 * token, an identity, a remaining balance, or a spend-plane identifier.
 *
 * The contamination assertions are the other half. A slot qualifies only when
 * the recorded snapshots prove a fresh sidecar performed exactly one successful
 * cold warm-up and then exactly one successful hot exchange, so a warm-up
 * cannot be counted as the activation and another operator's traffic cannot be
 * counted as this slot's.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZK_PREPAID_LIFECYCLE_FAILURES, type ZkPrepaidLifecycleFailure } from '@zk-credits/x402-zk-prepaid';
import {
  ACTIVATION_DENYLIST_KEYS,
  ACTIVATION_EVIDENCE_KIND,
  ACTIVATION_EVIDENCE_SCHEMA_VERSION,
  PILOT_ROLE_BY_SLOT,
  PINNED_ACTIVATION_VERSIONS,
  PINNED_ARTIFACT_RELEASE,
  SLOT_ASSIGNMENT,
  activationEvidenceJsonSchema,
  validateActivationEvidence,
  type ActivationCounterSnapshot,
  type ActivationEvidence,
  type OperatorSlot,
} from './activation-evidence.js';
import {
  MemoryActivationLedger,
  qualifyActivation,
  readActivationStatus,
  runActivationCommand,
  summarizePilotProgress,
  type ActivationWindow,
  type ActivationGatewayStatus,
  type ActivationProbe,
} from './activation.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

/** The counters a fresh sidecar reads after `count` clean exchange lifecycles. */
function cleanSnapshots(count: number): ActivationCounterSnapshot {
  return {
    exchange: {
      challengesReceived: count,
      paymentsPrepared: count,
      settlementsConfirmed: count,
      exchangeSuccesses: count,
      failures: 0,
      failuresByCategory: Object.fromEntries(
        ZK_PREPAID_LIFECYCLE_FAILURES.map((failure) => [failure, 0]),
      ) as Record<ZkPrepaidLifecycleFailure, number>,
    },
    proving: {
      attempts: count,
      successes: count,
      failures: 0,
      retries: 0,
      // The first prove in a process is the cold sample; everything after it is hot.
      hotProveSamples: Math.max(0, count - 1),
      p50HotProveMs: count > 1 ? 1_450 : null,
      p95HotProveMs: count > 1 ? 1_900 : null,
    },
  };
}

/**
 * The shape a clean activation must have: a fresh sidecar, one discarded cold
 * warm-up, then the single counted hot exchange.
 */
function evidenceFor(slot: OperatorSlot = 'A'): ActivationEvidence {
  const assignment = SLOT_ASSIGNMENT[slot];
  return {
    kind: ACTIVATION_EVIDENCE_KIND,
    schemaVersion: ACTIVATION_EVIDENCE_SCHEMA_VERSION,
    slot,
    participantType: assignment.participantType,
    integrationMode: assignment.integrationMode,
    versions: { ...PINNED_ACTIVATION_VERSIONS, artifactRelease: PINNED_ARTIFACT_RELEASE },
    activatedAt: '2026-09-21T04:00:00.000Z',
    humanActionDurationMs: 1_800_000,
    counters: {
      beforeWarmup: cleanSnapshots(0),
      afterWarmup: cleanSnapshots(1),
      afterHotExchange: cleanSnapshots(2),
    },
    assistanceCount: 1,
    attestations: {
      ranAgentLocally: true,
      credentialStayedLocal: true,
      noManualRecovery: true,
      distinctOperatorOwnership: true,
    },
  };
}

async function writeBundle(value: unknown, name = 'evidence.json'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'zk-activation-'));
  temporaryDirectories.push(directory);
  const path = join(directory, name);
  await writeFile(path, JSON.stringify(value, null, 2));
  return path;
}

/** Returns each status in turn, repeating the last one once the list is spent. */
function probe(statuses: ActivationGatewayStatus[], options: { ready?: boolean; checks?: { name: string; ok: boolean }[] } = {}): ActivationProbe {
  let index = 0;
  return {
    prewarm: async () => 1,
    requireReady: async () => {
      if (options.ready === false) throw new Error('/ready answered 503');
      for (const check of options.checks ?? []) {
        if (!check.ok) throw new Error(`/ready reported failing checks: ${check.name}`);
      }
    },
    status: async () => {
      const next = statuses[Math.min(index, statuses.length - 1)]!;
      index += 1;
      return next;
    },
  };
}

function activationDependencies(statuses: ActivationGatewayStatus[], options: { ready?: boolean; checks?: { name: string; ok: boolean }[] } = {}) {
  const ledger = new MemoryActivationLedger();
  const invites = new Map<string, { inviteId: string; githubAccountId: string; creationRequestId: string; state: 'open' | 'redeemed' | 'revoked' | 'expired' }>();
  const inviteIdsByRequest = new Map<string, string>();
  let nextInvite = 0;
  return {
    ledger,
    dependencies: {
      ledger,
      probe: probe(statuses, options),
      issueInvite: async ({ githubAccountId, creationRequestId }: { githubAccountId: string; creationRequestId: string }) => {
        const inviteId = `inv_${githubAccountId}_${++nextInvite}`;
        invites.set(inviteId, { inviteId, githubAccountId, creationRequestId, state: 'open' });
        inviteIdsByRequest.set(creationRequestId, inviteId);
        return { inviteId, code: 'one-time-code', expiresAt: 1_800_600_000_000 };
      },
      inspectInvite: async (inviteId: string) => {
        const invite = invites.get(inviteId);
        return invite ? { ...invite } : undefined;
      },
      inspectInviteRequest: async (creationRequestId: string) => {
        const inviteId = inviteIdsByRequest.get(creationRequestId);
        const invite = inviteId ? invites.get(inviteId) : undefined;
        return invite ? { inviteId: invite.inviteId, githubAccountId: invite.githubAccountId, state: invite.state } : undefined;
      },
      revokeInvite: async (inviteId: string) => {
        const invite = invites.get(inviteId);
        if (!invite || invite.state !== 'open') return false;
        invites.set(inviteId, { ...invite, state: 'revoked' });
        return true;
      },
      now: () => 1_800_000_000_000,
    },
  };
}

describe('operator activation evidence schema', () => {
  it('accepts a fully pinned bundle for every slot', () => {
    for (const slot of ['A', 'B', 'C'] as const) {
      const validation = validateActivationEvidence(evidenceFor(slot), slot);
      expect(validation.failures).toEqual([]);
      expect(validation.valid).toBe(true);
    }
  });

  it('rejects an unpinned package or artifact version', () => {
    const unpinned = evidenceFor();
    unpinned.versions.sidecar = '0.1.3';
    expect(validateActivationEvidence(unpinned, 'A').failures).toContainEqual({ path: 'versions.sidecar', reason: 'unpinned_version' });

    const artifact = evidenceFor();
    artifact.versions.artifactRelease = 'private-credit-spend-bn254-v1';
    expect(validateActivationEvidence(artifact, 'A').failures).toContainEqual({ path: 'versions.artifactRelease', reason: 'unpinned_artifact_release' });
  });

  it('rejects a slot whose participant type or integration mode disagrees with the cohort', () => {
    const wrongMode = evidenceFor('B');
    wrongMode.integrationMode = 'openai_compatible_sidecar';
    expect(validateActivationEvidence(wrongMode, 'B').failures).toContainEqual({ path: 'integrationMode', reason: 'slot_integration_mode_mismatch' });

    const wrongSlot = evidenceFor('A');
    expect(validateActivationEvidence(wrongSlot, 'B').failures).toContainEqual({ path: 'slot', reason: 'slot_mismatch' });
  });

  it('assigns external x402 work to C while keeping founder B technical-only', () => {
    expect(PILOT_ROLE_BY_SLOT).toEqual({
      A: 'external_codex_developer',
      B: 'founder_x402_agent',
      C: 'external_x402_agent',
    });
    expect(SLOT_ASSIGNMENT.C).toEqual({
      participantType: 'x402_native_agent',
      integrationMode: 'x402_zk_prepaid_adapter',
    });

    const historicalCodexC = evidenceFor('C');
    historicalCodexC.participantType = 'coding_agent';
    historicalCodexC.integrationMode = 'openai_compatible_sidecar';
    expect(validateActivationEvidence(historicalCodexC, 'C').failures).toContainEqual({
      path: 'participantType', reason: 'slot_participant_type_mismatch',
    });
  });

  it('rejects unknown keys at every depth', () => {
    const extraTopLevel = { ...evidenceFor(), notes: 'anything' };
    expect(validateActivationEvidence(extraTopLevel, 'A').failures).toContainEqual({ path: 'notes', reason: 'unknown_key' });

    const extraNested = evidenceFor();
    (extraNested.counters.afterWarmup.proving as unknown as Record<string, unknown>).samples = 12;
    expect(validateActivationEvidence(extraNested, 'A').failures).toContainEqual({
      path: 'counters.afterWarmup.proving.samples',
      reason: 'unknown_key',
    });

    const extraCategory = evidenceFor();
    (extraCategory.counters.beforeWarmup.exchange.failuresByCategory as unknown as Record<string, unknown>).unknown_category = 1;
    expect(validateActivationEvidence(extraCategory, 'A').failures).toContainEqual({
      path: 'counters.beforeWarmup.exchange.failuresByCategory.unknown_category',
      reason: 'unknown_key',
    });
  });

  it('requires all three counter snapshots, so a warm-up cannot be omitted', () => {
    const missing = evidenceFor() as unknown as Record<string, unknown>;
    delete (missing.counters as Record<string, unknown>).afterWarmup;
    expect(validateActivationEvidence(missing, 'A').failures).toContainEqual({ path: 'counters.afterWarmup', reason: 'not_an_object' });

    const withoutCounters = { ...evidenceFor() } as unknown as Record<string, unknown>;
    delete withoutCounters.counters;
    expect(validateActivationEvidence(withoutCounters, 'A').failures).toContainEqual({ path: 'counters', reason: 'not_an_object' });
  });

  it('rejects every denylisted key wherever it is nested', () => {
    for (const key of ACTIVATION_DENYLIST_KEYS) {
      const candidate = { ...evidenceFor(), [key]: 'seeded' };
      const validation = validateActivationEvidence(candidate, 'A');
      expect(validation.valid).toBe(false);
      expect(validation.failures).toContainEqual({ path: key, reason: 'denylisted_key' });
    }

    const nested = evidenceFor();
    (nested.attestations as unknown as Record<string, unknown>).github_account_id = 'seeded';
    expect(validateActivationEvidence(nested, 'A').failures).toContainEqual({ path: 'attestations.github_account_id', reason: 'denylisted_key' });
  });

  it('rejects a value that is not a count, a pin, or an ISO timestamp', () => {
    const negative = evidenceFor();
    negative.humanActionDurationMs = -1;
    expect(validateActivationEvidence(negative, 'A').failures).toContainEqual({ path: 'humanActionDurationMs', reason: 'not_a_duration' });

    const fractional = evidenceFor();
    fractional.assistanceCount = 0.5;
    expect(validateActivationEvidence(fractional, 'A').failures).toContainEqual({ path: 'assistanceCount', reason: 'not_a_count' });

    const naiveTimestamp = evidenceFor();
    naiveTimestamp.activatedAt = '2026-09-21 04:00:00';
    expect(validateActivationEvidence(naiveTimestamp, 'A').failures).toContainEqual({ path: 'activatedAt', reason: 'not_an_iso_timestamp' });

    const badAttestation = evidenceFor();
    (badAttestation.attestations as unknown as Record<string, unknown>).ranAgentLocally = 'yes';
    expect(validateActivationEvidence(badAttestation, 'A').failures).toContainEqual({ path: 'attestations.ranAgentLocally', reason: 'not_a_boolean' });

    const badCounter = evidenceFor();
    (badCounter.counters.afterHotExchange.exchange as unknown as Record<string, unknown>).challengesReceived = 'one';
    expect(validateActivationEvidence(badCounter, 'A').failures).toContainEqual({
      path: 'counters.afterHotExchange.exchange.challengesReceived',
      reason: 'not_a_count',
    });

    const badLatency = evidenceFor();
    badLatency.counters.afterHotExchange.proving.p95HotProveMs = Number.NaN;
    expect(validateActivationEvidence(badLatency, 'A').failures).toContainEqual({
      path: 'counters.afterHotExchange.proving.p95HotProveMs',
      reason: 'not_a_percentile',
    });
  });

  it('has no field wide enough to carry a prompt, proof, signal, token, or identity', () => {
    const seeded = [
      'seed-prompt-content',
      'seed-response-content',
      'seed-nullifier-991',
      'seed-public-signal-992',
      'seed-invite-token-993',
      'seed-credential-id-994',
      'seedGithubLogin',
      'sk-or-v1-seeded-provider-key',
      'https://gateway.example/seed-url-997',
      '0xSeedCredentialCommitment996',
    ];
    const bundle = evidenceFor();

    // Every string-valued leaf must be one of the fixed vocabulary: an enum, a
    // pinned version, the fixed artifact release, the kind, or an ISO stamp.
    const allowedStrings = new Set<string>([
      ACTIVATION_EVIDENCE_KIND,
      ...Object.keys(SLOT_ASSIGNMENT) as string[],
      ...Object.values(SLOT_ASSIGNMENT).flatMap((assignment) => [assignment.participantType, assignment.integrationMode]),
      ...Object.values(PINNED_ACTIVATION_VERSIONS),
      PINNED_ARTIFACT_RELEASE,
    ]);

    const leaves: unknown[] = [];
    const walk = (value: unknown): void => {
      if (value && typeof value === 'object') {
        for (const item of Object.values(value as Record<string, unknown>)) walk(item);
        return;
      }
      leaves.push(value);
    };
    walk(bundle);

    for (const leaf of leaves) {
      if (typeof leaf !== 'string') continue;
      const isIso = /^\d{4}-\d{2}-\d{2}T/u.test(leaf);
      expect(allowedStrings.has(leaf) || isIso).toBe(true);
      for (const value of seeded) expect(leaf).not.toContain(value);
    }

    // And a bundle that smuggles one into a typo'd field is refused outright.
    for (const value of seeded) {
      expect(validateActivationEvidence({ ...evidenceFor(), notes: value }, 'A').valid).toBe(false);
    }
  });

  it('publishes a JSON schema that mirrors the fixed vocabulary', () => {
    const schema = activationEvidenceJsonSchema();
    expect(schema.additionalProperties).toBe(false);
    expect(schema.$id).toBe(`${ACTIVATION_EVIDENCE_KIND}@${ACTIVATION_EVIDENCE_SCHEMA_VERSION}`);
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(properties.slot).toEqual({ enum: ['A', 'B', 'C'] });
    expect(properties.versions.required).toEqual(['sidecar', 'adapter', 'shared', 'artifactRelease']);
    expect(properties.counters.required).toEqual(['beforeWarmup', 'afterWarmup', 'afterHotExchange']);
    const snapshot = properties.counters.properties as Record<string, Record<string, unknown>>;
    const exchange = (snapshot.afterWarmup.properties as Record<string, Record<string, unknown>>).exchange;
    expect(Object.keys(exchange.properties).sort()).toEqual([
      'challengesReceived',
      'exchangeSuccesses',
      'failures',
      'failuresByCategory',
      'paymentsPrepared',
      'settlementsConfirmed',
    ]);
  });
});

describe('activation qualification', () => {
  const window = {
    slot: 'A' as const,
    attemptNumber: 1,
    inviteRequestId: 'request_abcdefghijklmnop',
    inviteId: 'inv_4242',
    status: 'open' as const,
    fundingOutcome: 'unknown' as const,
    participantType: SLOT_ASSIGNMENT.A.participantType,
    integrationMode: SLOT_ASSIGNMENT.A.integrationMode,
    startedAt: '2026-09-21T03:00:00.000Z',
    baselineCommittedClaims: 4,
    assistanceCount: 1,
    evidenceDigest: null,
    committedClaimsAfter: null,
    qualificationReasons: [],
    closedAt: null,
  };

  it('qualifies only when the warm-up and counted exchange add exactly two claims', () => {
    expect(qualifyActivation(evidenceFor('A'), window, 6)).toEqual({ qualified: true, reasons: [] });
  });

  it('counts B as technical only and starts the UTC window at A qualification', () => {
    const attempt = (slot: OperatorSlot, status: ActivationWindow['status'], closedAt: string | null): ActivationWindow => ({
      ...window,
      slot,
      participantType: SLOT_ASSIGNMENT[slot].participantType,
      integrationMode: SLOT_ASSIGNMENT[slot].integrationMode,
      status,
      closedAt,
    });
    const progress = summarizePilotProgress([
      attempt('A', 'qualified', '2026-09-21T04:10:00.000Z'),
      attempt('B', 'qualified', '2026-09-22T02:00:00.000Z'),
      attempt('C', 'open', null),
    ]);
    expect(progress).toEqual({
      technicalActivations: 2,
      externalMarketActivations: 1,
      founderTechnicalActivation: true,
      validationWindowStartedAt: '2026-09-21T04:10:00.000Z',
      validationWindowClosesAt: '2026-10-05T04:10:00.000Z',
    });
  });

  it('refuses an activation that was not preceded by a discarded warm-up', () => {
    // Nothing happened before the baseline, so the counted exchange was the
    // process's cold prove: exactly the contamination the warm-up prevents.
    const noWarmup = evidenceFor('A');
    noWarmup.counters.afterWarmup = cleanSnapshots(0);
    noWarmup.counters.afterHotExchange = cleanSnapshots(1);

    const verdict = qualifyActivation(noWarmup, window, 6);
    expect(verdict.qualified).toBe(false);
    expect(verdict.reasons).toContain('cold_warmup_incomplete_exchange');
    expect(verdict.reasons).toContain('hot_exchange_not_a_hot_proof');
  });

  it('refuses a sidecar that had already served traffic before the warm-up', () => {
    const stale = evidenceFor('A');
    stale.counters.beforeWarmup = cleanSnapshots(1);
    stale.counters.afterWarmup = cleanSnapshots(2);
    stale.counters.afterHotExchange = cleanSnapshots(3);
    expect(qualifyActivation(stale, window, 6).reasons).toContain('stale_traffic_before_warmup');
  });

  it('refuses a warm-up window that absorbed a second exchange', () => {
    const shared = evidenceFor('A');
    shared.counters.afterWarmup = cleanSnapshots(2);
    shared.counters.afterHotExchange = cleanSnapshots(3);

    const verdict = qualifyActivation(shared, window, 6);
    expect(verdict.qualified).toBe(false);
    expect(verdict.reasons).toContain('cold_warmup_contaminated_by_extra_traffic');
    expect(verdict.reasons).toContain('cold_warmup_not_the_cold_sample');
  });

  it('refuses a hot window that absorbed another activation\'s traffic', () => {
    const concurrent = evidenceFor('A');
    concurrent.counters.afterHotExchange = cleanSnapshots(3);

    const verdict = qualifyActivation(concurrent, window, 6);
    expect(verdict.qualified).toBe(false);
    expect(verdict.reasons).toContain('hot_exchange_contaminated_by_extra_traffic');
    expect(verdict.reasons).toContain('hot_exchange_not_a_hot_proof');
  });

  it('refuses a hot exchange that recorded a failure, a retry, or a dropped stage', () => {
    const failed = evidenceFor('A');
    failed.counters.afterHotExchange.exchange.failures = 1;
    failed.counters.afterHotExchange.exchange.failuresByCategory.transport_failed = 1;
    const failedVerdict = qualifyActivation(failed, window, 6);
    expect(failedVerdict.reasons).toContain('hot_exchange_recorded_failures');
    expect(failedVerdict.reasons).toContain('hot_exchange_recorded_failure_categories');

    // A retry means the hot window made two prove attempts over the warm-up's one.
    const retried = evidenceFor('A');
    retried.counters.afterHotExchange.proving.attempts = 3;
    retried.counters.afterHotExchange.proving.successes = 3;
    retried.counters.afterHotExchange.proving.retries = 1;
    const retriedVerdict = qualifyActivation(retried, window, 6);
    expect(retriedVerdict.reasons).toContain('hot_exchange_recorded_retries');
    expect(retriedVerdict.reasons).toContain('hot_exchange_contaminated_by_extra_traffic');

    const incomplete = evidenceFor('A');
    incomplete.counters.afterHotExchange.exchange.settlementsConfirmed = 0;
    expect(qualifyActivation(incomplete, window, 6).reasons).toContain('hot_exchange_incomplete_exchange');
  });

  it('refuses a warm-up that recorded failures or retries', () => {
    // A retried warm-up also ran a second prove, which the window must notice.
    const dirty = evidenceFor('A');
    dirty.counters.afterWarmup.proving.attempts = 2;
    dirty.counters.afterWarmup.proving.successes = 2;
    dirty.counters.afterWarmup.proving.retries = 1;
    dirty.counters.afterHotExchange = cleanSnapshots(3);

    const verdict = qualifyActivation(dirty, window, 6);
    expect(verdict.reasons).toContain('cold_warmup_recorded_retries');
    expect(verdict.reasons).toContain('cold_warmup_contaminated_by_extra_traffic');
  });

  it('refuses an activation with no observable exchange or no aggregate increase', () => {
    const noExchange = evidenceFor('A');
    noExchange.counters.afterWarmup = cleanSnapshots(0);
    noExchange.counters.afterHotExchange = cleanSnapshots(0);
    const verdict = qualifyActivation(noExchange, window, 6);
    expect(verdict.qualified).toBe(false);
    expect(verdict.reasons).toContain('cold_warmup_incomplete_exchange');
    expect(verdict.reasons).toContain('hot_exchange_incomplete_exchange');
    expect(verdict.reasons).toContain('hot_exchange_incomplete_proof');

    expect(qualifyActivation(evidenceFor('A'), window, 4).reasons).toEqual(['aggregate_committed_claim_delta_0_expected_2']);
    expect(qualifyActivation(evidenceFor('A'), window, 5).reasons).toEqual(['aggregate_committed_claim_delta_1_expected_2']);
    expect(qualifyActivation(evidenceFor('A'), window, 7).reasons).toEqual(['aggregate_committed_claim_delta_3_expected_2']);
    expect(qualifyActivation(evidenceFor('A'), window, null).reasons).toEqual(['aggregate_claim_count_unreadable']);
  });

  it('refuses an activation that did not run locally or needed manual recovery', () => {
    const notLocal = evidenceFor('A');
    notLocal.attestations.ranAgentLocally = false;
    notLocal.attestations.credentialStayedLocal = false;
    notLocal.attestations.noManualRecovery = false;
    notLocal.attestations.distinctOperatorOwnership = false;
    expect(qualifyActivation(notLocal, window, 6).reasons).toEqual([
      'agent_not_run_locally',
      'credential_not_retained_locally',
      'manual_recovery_observed',
      'ownership_not_distinct',
    ]);
  });
});

describe('founder activation coordinator', () => {
  const baseline: ActivationGatewayStatus = {
    launchState: 'enabled',
    committedClaims: 7,
    dailyCapMicroUsd: 40_000_000n,
    rollingCapMicroUsd: 200_000_000n,
    generatedAt: '2026-09-21T03:00:00.000Z',
  };
  const afterActivation: ActivationGatewayStatus = { ...baseline, committedClaims: 9, generatedAt: '2026-09-21T04:00:00.000Z' };

  it('prewarms, requires readiness, records the baseline, and issues exactly one invite', async () => {
    const { dependencies, ledger } = activationDependencies([baseline]);
    const output = await runActivationCommand(['activation-start', '--slot', 'A', '--github-id', '4242'], dependencies);
    expect(output).toMatch(/activation window opened for slot A/u);
    expect(output).toMatch(/baseline committed claims: 7/u);
    expect(output).toMatch(/participant type: coding_agent/u);
    expect(output).toMatch(/integration mode: openai_compatible_sidecar/u);
    expect(output).toMatch(/code \(shown once\): one-time-code/u);
    expect(await ledger.windows()).toHaveLength(1);

    await expect(runActivationCommand(['activation-start', '--slot', 'A', '--github-id', '4242'], dependencies)).rejects.toThrow(/slot A already has attempt 1/u);
  });

  it('refuses to open a window when readiness or the launch state is wrong', async () => {
    const notReady = activationDependencies([baseline], { ready: false });
    await expect(runActivationCommand(['activation-start', '--slot', 'A', '--github-id', '1'], notReady.dependencies)).rejects.toThrow(/503/u);
    expect(await notReady.ledger.windows()).toHaveLength(0);

    const failingCheck = activationDependencies([baseline], { checks: [{ name: 'baseRoot', ok: false }] });
    await expect(runActivationCommand(['activation-start', '--slot', 'A', '--github-id', '1'], failingCheck.dependencies)).rejects.toThrow(/baseRoot/u);

    const paused = activationDependencies([{ ...baseline, launchState: 'paused' }]);
    await expect(runActivationCommand(['activation-start', '--slot', 'A', '--github-id', '1'], paused.dependencies)).rejects.toThrow(/paused/u);
  });

  it('persists pending state before invite issue so a failed row insert cannot orphan an invite', async () => {
    const { dependencies } = activationDependencies([baseline]);
    let inviteCalls = 0;
    dependencies.issueInvite = async () => { inviteCalls += 1; throw new Error('should not be called'); };
    dependencies.ledger = {
      openWindow: async () => { throw new Error('database unavailable'); },
      attachInvite: async () => { throw new Error('unexpected'); },
      window: async () => undefined,
      windows: async () => [],
      attempts: async () => [],
      recordAssistance: async () => { throw new Error('unexpected'); },
      markNeedsReconciliation: async () => { throw new Error('unexpected'); },
      abort: async () => { throw new Error('unexpected'); },
      reconcileFunding: async () => { throw new Error('unexpected'); },
      revalidateSubmitted: async () => { throw new Error('unexpected'); },
      storeEvidence: async () => { throw new Error('unexpected'); },
    };

    await expect(runActivationCommand(['activation-start', '--slot', 'A', '--github-id', '1'], dependencies))
      .rejects.toThrow(/database unavailable/u);
    expect(inviteCalls).toBe(0);
  });

  it('validates an operator bundle and confirms the committed-claim increase', async () => {
    const { dependencies, ledger } = activationDependencies([baseline, afterActivation]);
    await runActivationCommand(['activation-start', '--slot', 'A', '--github-id', '4242'], dependencies);
    expect(await runActivationCommand(['activation-assist', '--slot', 'A'], dependencies)).toMatch(/1 event/u);

    const path = await writeBundle(evidenceFor('A'));
    const output = await runActivationCommand(['activation-evidence', '--slot', 'A', '--file', path], dependencies);
    expect(output).toMatch(/activation qualifies/u);
    expect(output).toMatch(/committed claims: 7 -> 9/u);

    const stored = (await ledger.attempts()).find((attempt) => attempt.slot === 'A');
    expect(stored!.evidenceDigest).toBe(createHash('sha256').update(JSON.stringify(evidenceFor('A'), null, 2)).digest('hex'));
    expect(stored!.committedClaimsAfter).toBe(9);
    expect(stored!.status).toBe('qualified');
  });

  it('reports every counter and failure category as a warm-up and hot delta', async () => {
    const { dependencies } = activationDependencies([baseline, afterActivation]);
    await runActivationCommand(['activation-start', '--slot', 'A', '--github-id', '4242'], dependencies);
    await runActivationCommand(['activation-assist', '--slot', 'A'], dependencies);

    const contaminated = evidenceFor('A');
    contaminated.counters.afterHotExchange.exchange.failures = 1;
    contaminated.counters.afterHotExchange.exchange.failuresByCategory.transport_failed = 1;
    const output = await runActivationCommand(['activation-evidence', '--slot', 'A', '--file', await writeBundle(contaminated)], dependencies);

    expect(output).toMatch(/cold warm-up delta:/u);
    expect(output).toMatch(/hot exchange delta:/u);
    expect(output).toMatch(/failures by category: challenge_unreadable=0, challenge_unsupported=0, challenge_stale=0, payment_preparation_failed=0, payment_rejected=0, settlement_failed=0, transport_failed=1/u);
    expect(output).toMatch(/activation does NOT qualify: hot_exchange_recorded_failures, hot_exchange_recorded_failure_categories/u);
  });

  it('refuses a bundle whose assistance count or pinning disagrees with the window', async () => {
    const { dependencies } = activationDependencies([baseline]);
    await runActivationCommand(['activation-start', '--slot', 'A', '--github-id', '4242'], dependencies);

    const mismatched = await writeBundle(evidenceFor('A'));
    await expect(runActivationCommand(['activation-evidence', '--slot', 'A', '--file', mismatched], dependencies)).rejects.toThrow(/assistance/u);

    await runActivationCommand(['activation-assist', '--slot', 'A'], dependencies);
    const unpinned = evidenceFor('A');
    unpinned.versions.adapter = '0.2.0';
    await expect(runActivationCommand(['activation-evidence', '--slot', 'A', '--file', await writeBundle(unpinned)], dependencies))
      .rejects.toThrow(/versions\.adapter: unpinned_version/u);
  });

  it('reports a non-qualifying activation without inventing an identifier join', async () => {
    const { dependencies } = activationDependencies([baseline, afterActivation]);
    await runActivationCommand(['activation-start', '--slot', 'A', '--github-id', '4242'], dependencies);
    await runActivationCommand(['activation-assist', '--slot', 'A'], dependencies);
    const incomplete = evidenceFor('A');
    incomplete.counters.afterHotExchange.exchange.settlementsConfirmed = 0;
    const output = await runActivationCommand(['activation-evidence', '--slot', 'A', '--file', await writeBundle(incomplete)], dependencies);
    expect(output).toMatch(/activation does NOT qualify: hot_exchange_incomplete_exchange/u);
    // The readout is aggregate only: no identity, token, or credential appears.
    expect(output).not.toMatch(/github|commitment|nullifier|seed|prompt/i);
  });

  it('rehearses the founder sequence without consuming a slot or issuing an invite', async () => {
    const { dependencies, ledger } = activationDependencies([baseline]);
    const output = await runActivationCommand(['activation-rehearse'], dependencies);
    expect(output).toMatch(/the founder half of the sequence succeeded/u);
    expect(output).toMatch(/no invite was issued and no activation window was opened/u);
    expect(output).toMatch(/effective spend caps: 40000000 per UTC day/u);
    expect(await ledger.windows()).toHaveLength(0);

    // The slot is still available afterwards, so the rehearsal cost nothing.
    await expect(runActivationCommand(['activation-start', '--slot', 'A', '--github-id', '1'], dependencies)).resolves.toMatch(/slot A/u);
  });

  it('refuses to rehearse while an activation window is open', async () => {
    const { dependencies } = activationDependencies([baseline]);
    await runActivationCommand(['activation-start', '--slot', 'A', '--github-id', '1'], dependencies);
    await expect(runActivationCommand(['activation-rehearse'], dependencies)).rejects.toThrow(/refusing to rehearse while slot\(s\) A are open/u);
  });

  it('never accepts an operator secret or an operator env path', async () => {
    const { dependencies } = activationDependencies([baseline]);
    for (const flag of ['--password', '--credential', '--env', '--secret', '--key', '--token']) {
      await expect(runActivationCommand(['activation-start', '--slot', 'A', '--github-id', '1', flag, 'value'], dependencies))
        .rejects.toThrow(new RegExp(`never accept ${flag}`, 'u'));
    }
    await expect(runActivationCommand(['activation-start', '--slot', 'A', '--github-id', '1', '--env=./operator.env'], dependencies))
      .rejects.toThrow(/never accept --env/u);
  });

  it('reports every open window from the aggregate status command', async () => {
    const { dependencies } = activationDependencies([baseline]);
    expect(await runActivationCommand(['activation-status'], dependencies)).toMatch(/no activation windows are open/u);
    await runActivationCommand(['activation-start', '--slot', 'A', '--github-id', '1'], dependencies);
    const output = await runActivationCommand(['activation-status'], dependencies);
    expect(output).toMatch(/slot A attempt 1: open/u);
    expect(output).toMatch(/assistance: 0/u);
    expect(output).toMatch(/committed claims: 7 -> pending/u);
  });

  it('preserves rejected evidence, reconciles its outcome, and retries the same operator', async () => {
    const oneClaimAfter = { ...baseline, committedClaims: 8, generatedAt: '2026-09-21T04:00:00.000Z' };
    const { dependencies, ledger } = activationDependencies([baseline, oneClaimAfter]);
    await runActivationCommand(['activation-start', '--slot', 'A', '--github-id', '4242'], dependencies);
    await runActivationCommand(['activation-assist', '--slot', 'A'], dependencies);
    const bundle = await writeBundle(evidenceFor('A'));

    const rejected = await runActivationCommand(['activation-evidence', '--slot', 'A', '--file', bundle], dependencies);
    expect(rejected).toMatch(/aggregate_committed_claim_delta_1_expected_2/u);
    const beforeRetry = (await ledger.attempts()).find((attempt) => attempt.slot === 'A')!;
    expect(beforeRetry.status).toBe('rejected');
    expect(beforeRetry.fundingOutcome).toBe('unknown');
    expect(beforeRetry.evidenceDigest).not.toBeNull();

    await expect(runActivationCommand(['activation-retry', '--slot', 'A', '--same-operator'], dependencies))
      .rejects.toThrow(/unresolved funding outcome/u);
    expect(await runActivationCommand(['activation-reconcile', '--slot', 'A', '--funding-outcome', 'not-funded'], dependencies))
      .toMatch(/funding outcome reconciled: not_funded/u);

    // The invite is still open in this rehearsal. The retry path must revoke
    // it before issuing a replacement invite, and each attempt gets a new
    // aggregate baseline.
    const retried = await runActivationCommand(['activation-retry', '--slot', 'A', '--same-operator'], dependencies);
    expect(retried).toMatch(/activation window opened for slot A \(attempt 2\)/u);
    const attempts = (await ledger.attempts()).filter((attempt) => attempt.slot === 'A');
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ status: 'rejected', evidenceDigest: beforeRetry.evidenceDigest });
    expect(attempts[1]).toMatchObject({ attemptNumber: 2, status: 'open', baselineCommittedClaims: 8, evidenceDigest: null });
    expect(attempts[1]!.inviteId).not.toBe(attempts[0]!.inviteId);

    // A hash already used by a failed attempt cannot be submitted again.
    await runActivationCommand(['activation-assist', '--slot', 'A'], dependencies);
    await expect(runActivationCommand(['activation-evidence', '--slot', 'A', '--file', bundle], dependencies))
      .rejects.toThrow(/duplicate activation evidence digest/u);
  });

  it('revalidates preserved submitted evidence only after a redeemed invite is reconciled', async () => {
    const { dependencies, ledger } = activationDependencies([baseline]);
    await runActivationCommand(['activation-start', '--slot', 'A', '--github-id', '4242'], dependencies);
    const open = (await ledger.window('A'))!;
    const submitted = {
      ...open,
      status: 'submitted' as const,
      assistanceCount: 1,
      evidence: evidenceFor('A'),
      evidenceDigest: 'd'.repeat(64),
      committedClaimsAfter: 9,
    };
    ledger.attempts = async () => [submitted];
    dependencies.inspectInvite = async (inviteId) => ({
      inviteId,
      githubAccountId: '4242',
      state: 'redeemed',
    });
    const revalidate = vi.fn(async (
      _slot: OperatorSlot,
      _attemptNumber: number,
      qualified: boolean,
      fundingOutcome: 'funded' | 'not_funded',
      reasons: string[],
    ) => ({
      ...submitted,
      status: qualified ? 'qualified' as const : 'rejected' as const,
      fundingOutcome,
      qualificationReasons: reasons,
    }));
    ledger.revalidateSubmitted = revalidate;

    await expect(runActivationCommand(['activation-reconcile', '--slot', 'A'], dependencies))
      .rejects.toThrow(/verify its detached funding result/u);
    expect(revalidate).not.toHaveBeenCalled();

    const output = await runActivationCommand(
      ['activation-reconcile', '--slot', 'A', '--funding-outcome', 'funded'],
      dependencies,
    );
    expect(output).toMatch(/preserved evidence revalidated as qualified/u);
    expect(output).toMatch(/committed-claim delta: 2 \(exactly 2 required\)/u);
    expect(revalidate).toHaveBeenCalledWith('A', open.attemptNumber, true, 'funded', []);
  });

  it('requires uncertain invite outcomes to be reconciled and supports replacement operators', async () => {
    const { dependencies, ledger } = activationDependencies([baseline]);
    const originalIssue = dependencies.issueInvite;
    let committedInvite: { inviteId: string; githubAccountId: string; creationRequestId: string } | undefined;
    dependencies.issueInvite = async ({ githubAccountId, creationRequestId }) => {
      const created = await originalIssue({ githubAccountId, creationRequestId });
      committedInvite = { inviteId: created.inviteId, githubAccountId, creationRequestId };
      throw new Error('connection dropped after invite commit');
    };
    dependencies.inspectInviteRequest = async (creationRequestId) => committedInvite?.creationRequestId === creationRequestId
      ? { inviteId: committedInvite.inviteId, githubAccountId: committedInvite.githubAccountId, state: 'open' }
      : undefined;

    await expect(runActivationCommand(['activation-start', '--slot', 'A', '--github-id', '4242'], dependencies))
      .rejects.toThrow(/invite outcome is unresolved/u);
    expect((await ledger.window('A'))?.status).toBe('needs_reconciliation');
    await expect(runActivationCommand(['activation-retry', '--slot', 'A', '--github-id', '9001'], dependencies))
      .rejects.toThrow(/no failed attempt eligible for retry/u);

    const reconciled = await runActivationCommand(['activation-reconcile', '--slot', 'A'], dependencies);
    expect(reconciled).toMatch(/attempt aborted; funding outcome: not_funded/u);
    dependencies.issueInvite = originalIssue;
    const replaced = await runActivationCommand(['activation-retry', '--slot', 'A', '--github-id', '9001'], dependencies);
    expect(replaced).toMatch(/activation window opened for slot A \(attempt 2\)/u);
    const attempts = (await ledger.attempts()).filter((attempt) => attempt.slot === 'A');
    expect(attempts.map((attempt) => attempt.status)).toEqual(['aborted', 'open']);
    expect(attempts[1]!.inviteId).not.toBe(attempts[0]!.inviteId);
  });

  it('does not let slot B or C start before the preceding slot qualifies', async () => {
    const { dependencies } = activationDependencies([baseline, afterActivation]);
    await expect(runActivationCommand(['activation-start', '--slot', 'B', '--github-id', '2'], dependencies))
      .rejects.toThrow(/slot B cannot start until slot A qualifies/u);
    await runActivationCommand(['activation-start', '--slot', 'A', '--github-id', '1'], dependencies);
    await runActivationCommand(['activation-assist', '--slot', 'A'], dependencies);
    await runActivationCommand(['activation-evidence', '--slot', 'A', '--file', await writeBundle(evidenceFor('A'))], dependencies);

    const slotB = await runActivationCommand(['activation-start', '--slot', 'B', '--github-id', '2'], dependencies);
    expect(slotB).toMatch(/slot B/u);
    await expect(runActivationCommand(['activation-start', '--slot', 'C', '--github-id', '3'], dependencies))
      .rejects.toThrow(/slot C cannot start until slot B qualifies/u);
  });
});

describe('aggregate status reading', () => {
  it('keeps only the launch state, the committed-claim integer, and the effective caps', () => {
    const status = readActivationStatus({
      launchControl: { state: 'enabled', reason: null, updatedAt: '2026-09-21T03:00:00.000Z' },
      claims: { reserved: 1, ready: 0, committed: 12, cancelled: 3 },
      spend: { dailyCapMicroUsd: '40000000', rollingCapMicroUsd: '200000000', utcDayMicroUsd: '0' },
      base: { currentRoot: '0xseeded', knownRootCount: 2, lastScannedBlock: '47000000', lagBlocks: '3' },
      metrics: { claim_committed: 12 },
      generatedAt: '2026-09-21T04:00:00.000Z',
    });
    expect(status).toEqual({
      launchState: 'enabled',
      committedClaims: 12,
      dailyCapMicroUsd: 40_000_000n,
      rollingCapMicroUsd: 200_000_000n,
      generatedAt: '2026-09-21T04:00:00.000Z',
    });
    // A root, a lag, and per-state counts are deliberately not retained.
    expect(Object.keys(status).sort()).toEqual([
      'committedClaims', 'dailyCapMicroUsd', 'generatedAt', 'launchState', 'rollingCapMicroUsd',
    ]);
  });

  it('reports the narrowed staging ceilings so the deployed caps are verifiable', () => {
    const status = readActivationStatus({
      launchControl: { state: 'enabled' },
      claims: { committed: 1 },
      spend: { dailyCapMicroUsd: '500000', rollingCapMicroUsd: '2000000' },
    });
    expect(status.dailyCapMicroUsd).toBe(500_000n);
    expect(status.rollingCapMicroUsd).toBe(2_000_000n);
  });

  it('reports an unreadable claim count instead of guessing', () => {
    expect(readActivationStatus({ launchControl: { state: 'enabled' }, claims: null }).committedClaims).toBeNull();
    expect(readActivationStatus({ launchControl: { state: 'enabled' }, claims: { committed: 1 } }).dailyCapMicroUsd).toBeNull();
    expect(() => readActivationStatus({ claims: { committed: 1 } })).toThrow(/launch state/u);
    expect(() => readActivationStatus('not an object')).toThrow(/not an object/u);
  });
});
