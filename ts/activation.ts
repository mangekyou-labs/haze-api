/**
 * Founder activation coordinator for the invite-only research pilot.
 *
 * One activation runs in four steps, each of which is a separate gateway-CLI
 * invocation because the operator's work happens in between:
 *
 *   1. `activation-start`    prewarm the free-tier instance, require a fully
 *                            ready deployment, record the baseline aggregate
 *                            committed-claim count, and issue exactly one
 *                            invite for the slot.
 *   2. (the operator activates on their own machine)
 *   3. `activation-assist`   record each founder assistance event.
 *   4. `activation-evidence` validate the operator's redacted bundle, re-read
 *                            the aggregate status, and confirm the committed
 *                            count increased across the window.
 *
 * `activation-rehearse` runs the founder half of that sequence with no slot and
 * no invite, so the orchestration can be proved against a real deployment
 * before an operator is committed to it. It refuses while any window is open,
 * because extra traffic during a window contaminates the slot's counters.
 *
 * The window stores a slot, an invite handle, a baseline integer, and an
 * assistance count. It never stores an operator identity, a credential, a
 * nullifier, a request signal, or a funding token, and the increase check
 * compares two global integers, so no read here can be joined to a spend-plane
 * claim.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { ZK_PREPAID_LIFECYCLE_FAILURES } from '@zk-credits/x402-zk-prepaid';
import {
  PILOT_ROLE_BY_SLOT,
  SLOT_ASSIGNMENT,
  activationSnapshotIsZero,
  deriveActivationDeltas,
  validateActivationEvidence,
  type ActivationCounterDeltas,
  type ActivationCounterSnapshot,
  type ActivationEvidence,
  type EvidenceFailure,
  type IntegrationMode,
  type OperatorSlot,
  type ParticipantType,
} from './activation-evidence.js';

/** Arguments that would put an operator secret or env file in founder hands. */
const FORBIDDEN_FLAGS = ['password', 'secret', 'credential', 'key', 'token', 'env', 'env-file', 'export'] as const;

export interface ActivationGatewayStatus {
  launchState: string;
  committedClaims: number | null;
  dailyCapMicroUsd: bigint | null;
  rollingCapMicroUsd: bigint | null;
  generatedAt: string;
}

export interface ActivationWindow {
  slot: OperatorSlot;
  attemptNumber: number;
  inviteRequestId: string | null;
  inviteId: string | null;
  status: ActivationAttemptStatus;
  fundingOutcome: FundingOutcome;
  participantType: ParticipantType;
  integrationMode: IntegrationMode;
  startedAt: string;
  baselineCommittedClaims: number;
  assistanceCount: number;
  evidence: unknown | null;
  evidenceDigest: string | null;
  committedClaimsAfter: number | null;
  qualificationReasons: string[];
  closedAt: string | null;
}

export type ActivationAttemptStatus = 'invite_pending' | 'open' | 'submitted' | 'needs_reconciliation' | 'aborted' | 'rejected' | 'qualified';
export type FundingOutcome = 'unknown' | 'not_funded' | 'funded';

export interface PilotProgress {
  technicalActivations: number;
  externalMarketActivations: number;
  founderTechnicalActivation: boolean;
  validationWindowStartedAt: string | null;
  validationWindowClosesAt: string | null;
}

/**
 * Count each qualified slot once. A/B/C all count as technical activations,
 * while only external slots A and C count toward market validation. Slot A's
 * server-recorded qualification time starts the 14-day UTC window.
 */
export function summarizePilotProgress(attempts: readonly ActivationWindow[]): PilotProgress {
  const qualified = new Set(attempts.filter((attempt) => attempt.status === 'qualified').map((attempt) => attempt.slot));
  const firstQualifiedA = attempts
    .filter((attempt) => attempt.slot === 'A' && attempt.status === 'qualified' && attempt.closedAt !== null)
    .sort((left, right) => Date.parse(left.closedAt!) - Date.parse(right.closedAt!))[0];
  const startedAt = firstQualifiedA?.closedAt ?? null;
  const startedMs = startedAt === null ? Number.NaN : Date.parse(startedAt);
  const closesAt = Number.isFinite(startedMs) ? new Date(startedMs + 14 * 24 * 60 * 60 * 1000).toISOString() : null;
  return {
    technicalActivations: qualified.size,
    externalMarketActivations: Number(qualified.has('A')) + Number(qualified.has('C')),
    founderTechnicalActivation: qualified.has('B'),
    validationWindowStartedAt: startedAt,
    validationWindowClosesAt: closesAt,
  };
}

export interface ActivationLedger {
  openWindow(window: {
    slot: OperatorSlot;
    inviteRequestId: string;
    participantType: ParticipantType;
    integrationMode: IntegrationMode;
    startedAt: string;
    baselineCommittedClaims: number;
  }): Promise<ActivationWindow>;
  attachInvite(slot: OperatorSlot, attemptNumber: number, inviteId: string): Promise<ActivationWindow>;
  window(slot: OperatorSlot): Promise<ActivationWindow | undefined>;
  windows(): Promise<ActivationWindow[]>;
  attempts(): Promise<ActivationWindow[]>;
  recordAssistance(slot: OperatorSlot, count: number): Promise<ActivationWindow>;
  markNeedsReconciliation(slot: OperatorSlot, attemptNumber: number): Promise<ActivationWindow>;
  abort(slot: OperatorSlot, attemptNumber: number, fundingOutcome: Exclude<FundingOutcome, 'unknown'>): Promise<ActivationWindow>;
  reconcileFunding(slot: OperatorSlot, attemptNumber: number, fundingOutcome: Exclude<FundingOutcome, 'unknown'>): Promise<ActivationWindow>;
  revalidateSubmitted(slot: OperatorSlot, attemptNumber: number, qualified: boolean, fundingOutcome: Exclude<FundingOutcome, 'unknown'>, reasons: string[]): Promise<ActivationWindow>;
  storeEvidence(slot: OperatorSlot, attemptNumber: number, evidence: ActivationEvidence, digest: string, committedClaimsAfter: number | null, qualified: boolean, fundingOutcome: FundingOutcome, reasons: string[]): Promise<ActivationWindow>;
}

export interface ActivationProbe {
  prewarm(): Promise<number>;
  requireReady(): Promise<void>;
  status(): Promise<ActivationGatewayStatus>;
}

export interface ActivationProbeOptions {
  gatewayUrl: string;
  adminToken: string;
  fetch?: typeof fetch;
  /** Cold-start attempts for the free tier. */
  coldStartAttempts?: number;
  coldStartDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const DEFAULT_COLD_START_ATTEMPTS = 24;
const DEFAULT_COLD_START_DELAY_MS = 5_000;
const REQUIRED_DAILY_CAP_MICRO_USD = 40_000_000n;
const REQUIRED_ROLLING_CAP_MICRO_USD = 200_000_000n;

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/u, '')}${path}`;
}

function requireInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} must be a non-negative integer`);
  return value as number;
}

/**
 * Reads and validates the aggregate admin status. Only the launch state, the
 * committed-claim integer, the effective spend ceilings, and the generation
 * time are retained; every other field the gateway reports is deliberately
 * dropped here.
 */
export function readActivationStatus(body: unknown): ActivationGatewayStatus {
  if (!body || typeof body !== 'object') throw new Error('gateway status is not an object');
  const record = body as Record<string, unknown>;
  const launch = record.launchControl as Record<string, unknown> | undefined;
  if (!launch || typeof launch.state !== 'string') throw new Error('gateway status has no launch state');
  const claims = record.claims as Record<string, unknown> | null | undefined;
  const committed = claims && typeof claims.committed === 'number' ? claims.committed : null;
  const spend = record.spend as Record<string, unknown> | null | undefined;
  // The ceilings are reported as decimal micro-USD strings, so the founder can
  // confirm the deployment before inviting: a staging service must show the
  // narrowed pair and production must show the fixed $40/$200 pair.
  const cap = (key: string): bigint | null => {
    const raw = spend?.[key];
    return typeof raw === 'string' && /^[0-9]+$/u.test(raw) ? BigInt(raw) : null;
  };
  return {
    launchState: launch.state,
    committedClaims: committed === null ? null : requireInteger(committed, 'committed claims'),
    dailyCapMicroUsd: cap('dailyCapMicroUsd'),
    rollingCapMicroUsd: cap('rollingCapMicroUsd'),
    generatedAt: typeof record.generatedAt === 'string' ? record.generatedAt : new Date(0).toISOString(),
  };
}

/** Live probe against the deployed gateway. */
export function createActivationProbe(options: ActivationProbeOptions): ActivationProbe {
  const fetcher = options.fetch ?? fetch;
  const attempts = options.coldStartAttempts ?? DEFAULT_COLD_START_ATTEMPTS;
  const delayMs = options.coldStartDelayMs ?? DEFAULT_COLD_START_DELAY_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));

  const readJson = async (path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> => {
    const response = await fetcher(joinUrl(options.gatewayUrl, path), init);
    let body: unknown;
    try { body = await response.json(); } catch { body = undefined; }
    return { status: response.status, body };
  };

  return {
    /** A free-tier instance may be suspended, so liveness is retried. */
    async prewarm(): Promise<number> {
      let lastError: unknown;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const response = await fetcher(joinUrl(options.gatewayUrl, '/health'));
          if (response.ok) return attempt;
          lastError = new Error(`health answered ${response.status}`);
        } catch (error) {
          lastError = error;
        }
        if (attempt < attempts) await sleep(delayMs);
      }
      throw new Error(`gateway did not become live: ${lastError instanceof Error ? lastError.message : 'unreachable'}`);
    },

    /**
     * Readiness is required, not merely mounted. A single failed check is a
     * deployment defect: without a synchronized root no proof can be accepted.
     */
    async requireReady(): Promise<void> {
      const { status, body } = await readJson('/ready', { headers: { accept: 'application/json' } });
      if (status !== 200) throw new Error(`/ready answered ${status}`);
      const report = body as { ready?: unknown; checks?: { name?: string; ok?: unknown }[] } | undefined;
      if (report?.ready !== true || !Array.isArray(report.checks)) throw new Error('/ready did not report a readiness verdict');
      const failed = report.checks.filter((check) => check.ok !== true).map((check) => check.name ?? 'unknown');
      if (failed.length > 0) throw new Error(`/ready reported failing checks: ${failed.join(', ')}`);
      const paused = report.checks.find((check) => check.name === 'launchControl');
      if (paused && paused.ok !== true) throw new Error('/ready reported a paused launch');

      const supported = await readJson('/x402/facilitator/supported', { headers: { accept: 'application/json' } });
      if (supported.status !== 200) throw new Error(`/x402/facilitator/supported answered ${supported.status}`);
      const advertised = supported.body as { kinds?: unknown; extensions?: unknown; signers?: unknown } | undefined;
      const kinds = advertised?.kinds;
      const first = Array.isArray(kinds) ? kinds[0] as Record<string, unknown> | undefined : undefined;
      if (!Array.isArray(kinds) || kinds.length !== 1 || first?.x402Version !== 2 || first.scheme !== 'zk-prepaid' || first.network !== 'eip155:84532') {
        throw new Error('/x402/facilitator/supported did not advertise only zk-prepaid on Base Sepolia');
      }
      if (!Array.isArray(advertised?.extensions) || advertised.extensions.length !== 0) {
        throw new Error('/x402/facilitator/supported advertised an unexpected extension');
      }
      if (!advertised.signers || typeof advertised.signers !== 'object' || Array.isArray(advertised.signers) || Object.keys(advertised.signers).length !== 0) {
        throw new Error('/x402/facilitator/supported advertised an unexpected signer');
      }
    },

    async status(): Promise<ActivationGatewayStatus> {
      const { status, body } = await readJson('/v1/admin/status', {
        headers: { authorization: `Bearer ${options.adminToken}`, accept: 'application/json' },
      });
      if (status !== 200) throw new Error(`/v1/admin/status answered ${status}`);
      return readActivationStatus(body);
    },
  };
}

export interface ActivationDependencies {
  ledger: ActivationLedger;
  probe: ActivationProbe;
  issueInvite(input: { githubAccountId: string; creationRequestId: string }): Promise<{ inviteId: string; code: string; expiresAt: number }>;
  inspectInvite(inviteId: string): Promise<{ inviteId: string; githubAccountId: string; state: 'open' | 'redeemed' | 'revoked' | 'expired' } | undefined>;
  inspectInviteRequest(creationRequestId: string): Promise<{ inviteId: string; githubAccountId: string; state: 'open' | 'redeemed' | 'revoked' | 'expired' } | undefined>;
  revokeInvite(inviteId: string): Promise<boolean>;
  now?: () => number;
}

function readFlag(args: readonly string[], name: string): string | undefined {
  for (const flag of FORBIDDEN_FLAGS) {
    if (args.includes(`--${flag}`) || args.some((arg) => arg.startsWith(`--${flag}=`))) {
      throw new Error(`activation commands never accept --${flag}: operator secrets stay on the operator machine`);
    }
  }
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`--${name} requires a value`);
  return value;
}

function requireSlot(args: readonly string[]): OperatorSlot {
  const value = readFlag(args, 'slot');
  if (value !== 'A' && value !== 'B' && value !== 'C') throw new Error('--slot must be A, B, or C');
  return value;
}

/** The exchange stages a single counted exchange must have reached exactly once. */
const SINGLE_EXCHANGE_COUNTS = [
  ['challengesReceived', 1],
  ['paymentsPrepared', 1],
  ['settlementsConfirmed', 1],
  ['exchangeSuccesses', 1],
] as const;

interface WindowRule {
  /** Prefix for every reason this window can raise, e.g. `cold_warmup`. */
  label: string;
  /** Hot prove samples this window must have contributed. */
  hotProveSamples: number;
  /** Reason raised when the window did not contribute the expected sample. */
  sampleReason: string;
}

/**
 * The discarded warm-up is the process's cold sample: it compiles the WASM and
 * must therefore be the only prove in the window, and it must not appear in the
 * warm percentiles afterwards.
 */
const COLD_WARMUP_RULE: WindowRule = {
  label: 'cold_warmup',
  hotProveSamples: 0,
  sampleReason: 'cold_warmup_not_the_cold_sample',
};

/** The counted exchange is exactly one exchange and exactly one hot prove. */
const HOT_EXCHANGE_RULE: WindowRule = {
  label: 'hot_exchange',
  hotProveSamples: 1,
  sampleReason: 'hot_exchange_not_a_hot_proof',
};

/**
 * Judges one window between two counter snapshots.
 *
 * A clean window is exactly one exchange that reached settlement and exactly
 * one proof, with nothing failed and nothing retried. A count above the
 * requirement is another activation's traffic or a replay; a count below it is
 * an exchange that did not finish. Both are contamination, and either one
 * disqualifies the slot rather than being averaged away.
 */
function assessActivationWindow(deltas: ActivationCounterDeltas, rule: WindowRule, reasons: string[]): void {
  const { exchange, proving } = deltas;
  for (const [key, required] of SINGLE_EXCHANGE_COUNTS) {
    if (exchange[key] > required) reasons.push(`${rule.label}_contaminated_by_extra_traffic`);
    else if (exchange[key] < required) reasons.push(`${rule.label}_incomplete_exchange`);
  }
  if (exchange.failures > 0) reasons.push(`${rule.label}_recorded_failures`);
  if (ZK_PREPAID_LIFECYCLE_FAILURES.some((failure) => exchange.failuresByCategory[failure] > 0)) {
    reasons.push(`${rule.label}_recorded_failure_categories`);
  }
  if (proving.attempts > 1) reasons.push(`${rule.label}_contaminated_by_extra_traffic`);
  else if (proving.attempts < 1) reasons.push(`${rule.label}_incomplete_proof`);
  if (proving.successes < 1) reasons.push(`${rule.label}_incomplete_proof`);
  if (proving.failures > 0) reasons.push(`${rule.label}_recorded_proof_failures`);
  if (proving.retries > 0) reasons.push(`${rule.label}_recorded_retries`);
  if (proving.hotProveSamples !== rule.hotProveSamples) reasons.push(rule.sampleReason);
}

/**
 * A qualifying activation is a fresh sidecar that performed exactly one
 * successful cold warm-up before the baseline and exactly one successful hot
 * exchange after it, plus a real increase in the aggregate committed-claim
 * count across the window and every ownership attestation.
 *
 * The comparison is between counter *deltas* rather than cumulative totals, so
 * a warm-up cannot be counted as the activation and a second operator's traffic
 * cannot be counted as this slot's. Non-qualifying attempts stay recorded as
 * failures.
 */
export function qualifyActivation(
  evidence: ActivationEvidence,
  window: ActivationWindow,
  committedClaimsAfter: number | null,
): { qualified: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const { beforeWarmup, afterWarmup, afterHotExchange } = evidence.counters;

  // A sidecar that was already used carries someone else's traffic into the
  // warm-up window, where no later subtraction can remove it.
  if (!activationSnapshotIsZero(beforeWarmup)) reasons.push('stale_traffic_before_warmup');

  assessActivationWindow(deriveActivationDeltas(beforeWarmup, afterWarmup), COLD_WARMUP_RULE, reasons);
  assessActivationWindow(deriveActivationDeltas(afterWarmup, afterHotExchange), HOT_EXCHANGE_RULE, reasons);

  if (!evidence.attestations.ranAgentLocally) reasons.push('agent_not_run_locally');
  if (!evidence.attestations.credentialStayedLocal) reasons.push('credential_not_retained_locally');
  if (!evidence.attestations.noManualRecovery) reasons.push('manual_recovery_observed');
  if (!evidence.attestations.distinctOperatorOwnership) reasons.push('ownership_not_distinct');
  if (!window.inviteId) reasons.push('no_redeemable_invite');
  if (committedClaimsAfter === null) reasons.push('aggregate_claim_count_unreadable');
  else {
    const delta = committedClaimsAfter - window.baselineCommittedClaims;
    if (delta !== 2) reasons.push(`aggregate_committed_claim_delta_${delta}_expected_2`);
  }
  return { qualified: reasons.length === 0, reasons };
}

function percentage(value: number | null): string {
  return value === null ? 'n/a' : `${value} ms`;
}

/**
 * Reports the warm-up delta and the hot delta for every counter and every
 * failure category, so the recorded summary shows what was actually subtracted
 * rather than a single cumulative total.
 */
function summariseEvidence(evidence: ActivationEvidence): string {
  const { beforeWarmup, afterWarmup, afterHotExchange } = evidence.counters;
  const warmup = deriveActivationDeltas(beforeWarmup, afterWarmup);
  const hot = deriveActivationDeltas(afterWarmup, afterHotExchange);
  const exchangeLine = (label: string, deltas: ActivationCounterDeltas): string => [
    `${label}: ${deltas.exchange.exchangeSuccesses} succeeded, ${deltas.exchange.failures} failed`,
    `  challenges ${deltas.exchange.challengesReceived}, prepared ${deltas.exchange.paymentsPrepared}, settled ${deltas.exchange.settlementsConfirmed}`,
    `  failures by category: ${ZK_PREPAID_LIFECYCLE_FAILURES.map((failure) => `${failure}=${deltas.exchange.failuresByCategory[failure]}`).join(', ')}`,
    `  proofs ${deltas.proving.successes}/${deltas.proving.attempts}, failures ${deltas.proving.failures}, retries ${deltas.proving.retries}, hot samples ${deltas.proving.hotProveSamples}, p50 ${percentage(deltas.proving.p50HotProveMs)}, p95 ${percentage(deltas.proving.p95HotProveMs)}`,
  ].join('\n');
  const counterRow = (label: string, snapshot: ActivationCounterSnapshot): string => [
    `${label}: ${snapshot.exchange.exchangeSuccesses} successful exchange(s), ${snapshot.exchange.failures} failure(s), ` +
      `${snapshot.proving.successes}/${snapshot.proving.attempts} proof(s), ${snapshot.proving.hotProveSamples} hot sample(s)`,
  ].join('\n');
  return [
    `slot: ${evidence.slot}`,
    `participant type: ${evidence.participantType}`,
    `integration mode: ${evidence.integrationMode}`,
    `activated: ${evidence.activatedAt}`,
    `active human setup time ms: ${evidence.humanActionDurationMs}`,
    `assistance count: ${evidence.assistanceCount}`,
    counterRow('before warm-up', beforeWarmup),
    exchangeLine('cold warm-up delta', warmup),
    exchangeLine('hot exchange delta', hot),
    counterRow('after hot exchange', afterHotExchange),
  ].join('\n');
}

const ACTIVE_STATUSES = new Set<ActivationAttemptStatus>(['invite_pending', 'open', 'submitted', 'needs_reconciliation']);

function isActive(window: ActivationWindow): boolean {
  return ACTIVE_STATUSES.has(window.status);
}

function requireLaunchGate(status: ActivationGatewayStatus): void {
  if (status.launchState !== 'enabled') throw new Error(`the pilot is ${status.launchState}, not enabled`);
  if (status.committedClaims === null) throw new Error('the gateway did not report an aggregate committed-claim count');
  if (status.dailyCapMicroUsd !== REQUIRED_DAILY_CAP_MICRO_USD || status.rollingCapMicroUsd !== REQUIRED_ROLLING_CAP_MICRO_USD) {
    throw new Error(`gateway spend caps must be exactly $40/$200 (micro-USD ${REQUIRED_DAILY_CAP_MICRO_USD}/${REQUIRED_ROLLING_CAP_MICRO_USD}); observed ${status.dailyCapMicroUsd?.toString() ?? 'unreadable'}/${status.rollingCapMicroUsd?.toString() ?? 'unreadable'}`);
  }
}

/** A retry must not leave an earlier invite redeemable or its funding unknown. */
async function requireRetryReconciled(previous: ActivationWindow, dependencies: ActivationDependencies): Promise<void> {
  if (previous.fundingOutcome === 'unknown') {
    throw new Error(`slot ${previous.slot} attempt ${previous.attemptNumber} has an unresolved funding outcome; run activation-reconcile first`);
  }

  let invite = previous.inviteId ? await dependencies.inspectInvite(previous.inviteId) : undefined;
  if (!invite && previous.inviteRequestId) invite = await dependencies.inspectInviteRequest(previous.inviteRequestId);
  if (!invite && previous.inviteId) {
    throw new Error(`slot ${previous.slot} attempt ${previous.attemptNumber} invite outcome is unresolved; run activation-reconcile before retrying`);
  }

  if (invite?.state === 'open') {
    const revoked = await dependencies.revokeInvite(invite.inviteId);
    if (!revoked) {
      invite = await dependencies.inspectInvite(invite.inviteId);
      if (!invite || invite.state === 'open') {
        throw new Error(`slot ${previous.slot} attempt ${previous.attemptNumber} invite could not be conclusively closed; run activation-reconcile before retrying`);
      }
    } else {
      invite = { ...invite, state: 'revoked' };
    }
  }
}

function formatFailures(failures: readonly EvidenceFailure[]): string {
  return failures.map((failure) => `  ${failure.path || '<root>'}: ${failure.reason}`).join('\n');
}

async function startAttempt(
  slot: OperatorSlot,
  githubAccountId: string,
  dependencies: ActivationDependencies,
  retry: boolean,
): Promise<string> {
  const all = await dependencies.ledger.attempts();
  const sameSlot = all.filter((attempt) => attempt.slot === slot).sort((a, b) => b.attemptNumber - a.attemptNumber);
  const previous = sameSlot[0];
  if (retry) {
    if (!previous || !['aborted', 'rejected'].includes(previous.status)) throw new Error(`slot ${slot} has no failed attempt eligible for retry`);
    await requireRetryReconciled(previous, dependencies);
  } else if (previous) {
    throw new Error(`slot ${slot} already has attempt ${previous.attemptNumber}; use activation-retry after resolving it`);
  }

  const prerequisite = slot === 'B' ? 'A' : slot === 'C' ? 'B' : null;
  if (prerequisite) {
    const prior = all.filter((attempt) => attempt.slot === prerequisite).sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
    if (!prior || prior.status !== 'qualified') throw new Error(`slot ${slot} cannot start until slot ${prerequisite} qualifies`);
  }
  const active = all.filter(isActive);
  if (active.length > 0) throw new Error(`slot ${slot} cannot start while slot(s) ${active.map((attempt) => attempt.slot).join(', ')} have open attempts`);

  const prewarmAttempts = await dependencies.probe.prewarm();
  await dependencies.probe.requireReady();
  const baseline = await dependencies.probe.status();
  requireLaunchGate(baseline);
  const inviteRequestId = randomBytes(24).toString('base64url');
  const assignment = SLOT_ASSIGNMENT[slot];
  let attempt = await dependencies.ledger.openWindow({
    slot,
    inviteRequestId,
    participantType: assignment.participantType,
    integrationMode: assignment.integrationMode,
    startedAt: new Date((dependencies.now ?? Date.now)()).toISOString(),
    baselineCommittedClaims: baseline.committedClaims!,
  });

  let issued: { inviteId: string; code: string; expiresAt: number };
  try {
    issued = await dependencies.issueInvite({ githubAccountId, creationRequestId: inviteRequestId });
  } catch (error) {
    try { await dependencies.ledger.markNeedsReconciliation(slot, attempt.attemptNumber); } catch { /* the durable pending attempt remains the recovery key */ }
    throw new Error(`invite outcome is unresolved for slot ${slot} attempt ${attempt.attemptNumber}; run activation-reconcile --slot ${slot}; ${error instanceof Error ? error.message : 'invite creation failed'}`);
  }

  try {
    attempt = await dependencies.ledger.attachInvite(slot, attempt.attemptNumber, issued.inviteId);
  } catch (error) {
    try { await dependencies.ledger.markNeedsReconciliation(slot, attempt.attemptNumber); } catch { /* retain original state for reconciliation */ }
    throw new Error(`invite ${issued.inviteId} exists but could not be attached to the attempt; reconcile slot ${slot} before retrying; ${error instanceof Error ? error.message : 'database error'}`);
  }
  return [
    `activation window opened for slot ${slot} (attempt ${attempt.attemptNumber})`,
    `prewarm attempts: ${prewarmAttempts}`,
    `launch state: ${baseline.launchState}`,
    `effective spend caps: ${baseline.dailyCapMicroUsd} per UTC day, ${baseline.rollingCapMicroUsd} per rolling 30 days (micro-USD)`,
    `baseline committed claims: ${attempt.baselineCommittedClaims}`,
    `participant type: ${attempt.participantType}`,
    `integration mode: ${attempt.integrationMode}`,
    `invite id: ${issued.inviteId}`,
    `expires: ${new Date(issued.expiresAt).toISOString()}`,
    `code (shown once): ${issued.code}`,
  ].join('\n');
}

async function abortAttempt(
  slot: OperatorSlot,
  attempt: ActivationWindow,
  dependencies: ActivationDependencies,
  requestedOutcome?: string,
): Promise<ActivationWindow> {
  if (!isActive(attempt)) throw new Error(`slot ${slot} attempt ${attempt.attemptNumber} is not active`);
  let invite = attempt.inviteId ? await dependencies.inspectInvite(attempt.inviteId) : undefined;
  if (!invite && attempt.inviteRequestId) invite = await dependencies.inspectInviteRequest(attempt.inviteRequestId);
  if (invite?.state === 'redeemed' && requestedOutcome !== 'funded' && requestedOutcome !== 'not_funded') {
    throw new Error(`invite ${invite.inviteId} was redeemed; verify its detached funding result, then pass --funding-outcome funded|not-funded`);
  }
  if (invite && (invite.state === 'open')) {
    const revoked = await dependencies.revokeInvite(invite.inviteId);
    if (!revoked) {
      const after = await dependencies.inspectInvite(invite.inviteId);
      if (after?.state === 'redeemed') {
        if (requestedOutcome !== 'funded' && requestedOutcome !== 'not_funded') {
          throw new Error(`invite ${invite.inviteId} was redeemed during abort; reconcile its funding result before retrying`);
        }
        return dependencies.ledger.abort(slot, attempt.attemptNumber, requestedOutcome);
      }
      if (after?.state === 'open') throw new Error(`invite ${invite.inviteId} could not be revoked; reconcile before retrying`);
    }
  }
  const outcome = invite?.state === 'redeemed' ? requestedOutcome as 'funded' | 'not_funded' : 'not_funded';
  return dependencies.ledger.abort(slot, attempt.attemptNumber, outcome);
}

/** Runs one founder activation command and returns the text to print. */
export async function runActivationCommand(args: readonly string[], dependencies: ActivationDependencies): Promise<string> {
  const [command, ...rest] = args;

  if (command === 'activation-start') {
    const slot = requireSlot(rest);
    const githubAccountId = readFlag(rest, 'github-id');
    if (!githubAccountId) throw new Error('--github-id is required');
    return startAttempt(slot, githubAccountId, dependencies, false);
  }

  if (command === 'activation-retry') {
    const slot = requireSlot(rest);
    const sameOperator = rest.includes('--same-operator');
    if (sameOperator && readFlag(rest, 'github-id')) throw new Error('use either --same-operator or --github-id, not both');
    const previous = (await dependencies.ledger.attempts()).filter((attempt) => attempt.slot === slot).sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
    if (!previous) throw new Error(`slot ${slot} has no previous attempt`);
    let githubAccountId = readFlag(rest, 'github-id');
    if (sameOperator) {
      if (!previous.inviteId) throw new Error('the prior attempt has no invite handle; provide --github-id for the replacement operator');
      const invite = await dependencies.inspectInvite(previous.inviteId);
      if (!invite) throw new Error('the prior invite identity cannot be resolved; provide --github-id for the replacement operator');
      githubAccountId = invite.githubAccountId;
    }
    if (!githubAccountId) throw new Error('provide --same-operator or --github-id <replacement account id>');
    return startAttempt(slot, githubAccountId, dependencies, true);
  }

  if (command === 'activation-abort') {
    const slot = requireSlot(rest);
    const attemptNumberRaw = readFlag(rest, 'attempt');
    const attemptNumber = attemptNumberRaw ? Number(attemptNumberRaw) : undefined;
    if (attemptNumberRaw && (!Number.isSafeInteger(attemptNumber) || attemptNumber! < 1)) throw new Error('--attempt must be a positive integer');
    const outcome = readFlag(rest, 'funding-outcome');
    if (outcome && outcome !== 'funded' && outcome !== 'not-funded') throw new Error('--funding-outcome must be funded or not-funded');
    const attempt = (await dependencies.ledger.attempts())
      .filter((item) => item.slot === slot && (attemptNumber === undefined || item.attemptNumber === attemptNumber))
      .sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
    if (!attempt) throw new Error(`no activation attempt found for slot ${slot}`);
    const aborted = await abortAttempt(slot, attempt, dependencies, outcome);
    return `slot ${slot} attempt ${aborted.attemptNumber} aborted; funding outcome: ${aborted.fundingOutcome}`;
  }

  if (command === 'activation-reconcile') {
    const slot = requireSlot(rest);
    const attemptRaw = readFlag(rest, 'attempt');
    const attemptNumber = attemptRaw === undefined ? undefined : Number(attemptRaw);
    if (attemptRaw !== undefined && (!Number.isSafeInteger(attemptNumber) || attemptNumber! < 1)) throw new Error('--attempt must be a positive integer');
    const all = await dependencies.ledger.attempts();
    const attempt = all.filter((item) => item.slot === slot && (attemptNumber === undefined || item.attemptNumber === attemptNumber)).sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
    if (!attempt) throw new Error(`no activation attempt found for slot ${slot}`);
    const requestedOutcome = readFlag(rest, 'funding-outcome');
    if (requestedOutcome && requestedOutcome !== 'funded' && requestedOutcome !== 'not-funded') throw new Error('--funding-outcome must be funded or not-funded');
    const fundingOutcome = requestedOutcome === 'not-funded' ? 'not_funded' : requestedOutcome as 'funded' | undefined;

    let invite = attempt.inviteId ? await dependencies.inspectInvite(attempt.inviteId) : undefined;
    if (!invite && attempt.inviteRequestId) invite = await dependencies.inspectInviteRequest(attempt.inviteRequestId);
    if (invite && attempt.inviteId !== invite.inviteId && attempt.status !== 'submitted') {
      await dependencies.ledger.attachInvite(slot, attempt.attemptNumber, invite.inviteId);
    }
    if (attempt.status === 'submitted') {
      if (!invite) throw new Error(`slot ${slot} attempt ${attempt.attemptNumber} invite outcome is unresolved; reconcile the invite before revalidating its preserved evidence`);
      if (invite.state === 'open') {
        const aborted = await abortAttempt(slot, attempt, dependencies);
        return `slot ${slot} attempt ${aborted.attemptNumber} preserved submitted evidence and was aborted; funding outcome: ${aborted.fundingOutcome}`;
      }
      if (invite.state !== 'redeemed') {
        const reasons = [`invite_${invite.state}`];
        const resolved = await dependencies.ledger.revalidateSubmitted(slot, attempt.attemptNumber, false, 'not_funded', reasons);
        return `slot ${slot} attempt ${resolved.attemptNumber} preserved evidence revalidated as ${resolved.status}; funding outcome: ${resolved.fundingOutcome}; reasons: ${reasons.join(', ')}`;
      }
      if (!fundingOutcome) throw new Error(`invite ${invite.inviteId} is redeemed; verify its detached funding result and rerun with --funding-outcome funded|not-funded`);

      const reasons: string[] = [];
      const validation = validateActivationEvidence(attempt.evidence, slot);
      if (!validation.valid) reasons.push('migrated_evidence_invalid');
      if (attempt.evidenceDigest === null) reasons.push('migrated_evidence_digest_missing');
      if (validation.valid) {
        const evidence = attempt.evidence as ActivationEvidence;
        if (evidence.assistanceCount !== attempt.assistanceCount) reasons.push('assistance_count_mismatch');
        reasons.push(...qualifyActivation(evidence, attempt, attempt.committedClaimsAfter).reasons);
      }
      if (fundingOutcome !== 'funded') reasons.push('funding_outcome_not_funded');
      const uniqueReasons = [...new Set(reasons)];
      const qualified = uniqueReasons.length === 0;
      const resolved = await dependencies.ledger.revalidateSubmitted(
        slot,
        attempt.attemptNumber,
        qualified,
        fundingOutcome,
        uniqueReasons,
      );
      const delta = attempt.committedClaimsAfter === null ? 'unreadable' : attempt.committedClaimsAfter - attempt.baselineCommittedClaims;
      return `slot ${slot} attempt ${resolved.attemptNumber} preserved evidence revalidated as ${resolved.status}; committed-claim delta: ${delta} (exactly 2 required); funding outcome: ${resolved.fundingOutcome}${uniqueReasons.length ? `; reasons: ${uniqueReasons.join(', ')}` : ''}`;
    }
    if (invite?.state === 'redeemed') {
      if (!fundingOutcome) throw new Error(`invite ${invite.inviteId} is redeemed; verify its detached funding result and rerun with --funding-outcome funded|not-funded`);
      if (isActive(attempt)) {
        const resolved = await dependencies.ledger.abort(slot, attempt.attemptNumber, fundingOutcome);
        return `slot ${slot} attempt ${resolved.attemptNumber} reconciled as aborted; funding outcome: ${resolved.fundingOutcome}`;
      }
      const resolved = await dependencies.ledger.reconcileFunding(slot, attempt.attemptNumber, fundingOutcome);
      return `slot ${slot} attempt ${resolved.attemptNumber} funding outcome reconciled: ${resolved.fundingOutcome}`;
    }
    if (isActive(attempt)) {
      const aborted = await abortAttempt(slot, attempt, dependencies);
      return `slot ${slot} attempt ${aborted.attemptNumber} invite reconciled; attempt aborted; funding outcome: ${aborted.fundingOutcome}`;
    }
    if (attempt.fundingOutcome === 'unknown') {
      if (!fundingOutcome) throw new Error(`slot ${slot} attempt ${attempt.attemptNumber} still has an unknown funding outcome; verify and pass --funding-outcome funded|not-funded`);
      const resolved = await dependencies.ledger.reconcileFunding(slot, attempt.attemptNumber, fundingOutcome);
      return `slot ${slot} attempt ${resolved.attemptNumber} funding outcome reconciled: ${resolved.fundingOutcome}`;
    }
    return `slot ${slot} attempt ${attempt.attemptNumber}: invite ${invite?.state ?? 'not found'}, funding ${attempt.fundingOutcome}, status ${attempt.status}`;
  }

  if (command === 'activation-rehearse') {
    const open = await dependencies.ledger.windows();
    if (open.length > 0) throw new Error(`refusing to rehearse while slot(s) ${open.map((window) => window.slot).join(', ')} are open: extra traffic contaminates a live window`);
    const prewarmAttempts = await dependencies.probe.prewarm();
    await dependencies.probe.requireReady();
    const baseline = await dependencies.probe.status();
    requireLaunchGate(baseline);
    return [
      'activation rehearsal: the founder half of the sequence succeeded',
      'no invite was issued and no activation window was opened (no activation attempt was opened)',
      `prewarm attempts: ${prewarmAttempts}`,
      `launch state: ${baseline.launchState}`,
      `effective spend caps: ${baseline.dailyCapMicroUsd} per UTC day, ${baseline.rollingCapMicroUsd} per rolling 30 days (micro-USD)`,
      `baseline committed claims: ${baseline.committedClaims}`,
      'the operator runs one discarded warm-up, then one counted exchange',
    ].join('\n');
  }

  if (command === 'activation-assist') {
    const slot = requireSlot(rest);
    const attempt = await dependencies.ledger.recordAssistance(slot, 1);
    return `assistance recorded for slot ${slot} attempt ${attempt.attemptNumber}: ${attempt.assistanceCount} event(s)`;
  }

  if (command === 'activation-evidence') {
    const slot = requireSlot(rest);
    const window = await dependencies.ledger.window(slot);
    if (!window || window.status !== 'open') throw new Error(`no activation window is open for slot ${slot}`);
    const raw = readFlag(rest, 'file');
    if (!raw) throw new Error('--file is required');
    const bytes = await readFile(raw, 'utf8');
    const digest = createHash('sha256').update(bytes).digest('hex');
    let parsed: unknown;
    try { parsed = JSON.parse(bytes); } catch { throw new Error('evidence bundle is not valid JSON'); }
    const validation = validateActivationEvidence(parsed, slot);
    if (!validation.valid) throw new Error(`evidence bundle rejected:\n${formatFailures(validation.failures)}`);
    const evidence = parsed as ActivationEvidence;
    if (evidence.assistanceCount !== window.assistanceCount) {
      throw new Error(`evidence reports ${evidence.assistanceCount} assistance event(s) but the window recorded ${window.assistanceCount}`);
    }
    const after = await dependencies.probe.status();
    const verdict = qualifyActivation(evidence, window, after.committedClaims);
    const claimDelta = after.committedClaims === null ? null : after.committedClaims - window.baselineCommittedClaims;
    // The global aggregate can establish a funded outcome for a qualifying
    // exact-two run. Any failed run remains uncertain because the count cannot
    // be joined to this invite; require founder reconciliation before retry.
    const fundingOutcome: FundingOutcome = verdict.qualified ? 'funded' : 'unknown';
    const stored = await dependencies.ledger.storeEvidence(slot, window.attemptNumber, evidence, digest, after.committedClaims, verdict.qualified, fundingOutcome, verdict.reasons);
    return [
      `slot: ${slot}`,
      `attempt: ${window.attemptNumber}`,
      summariseEvidence(evidence),
      `evidence sha256: ${digest}`,
      `committed claims: ${window.baselineCommittedClaims} -> ${after.committedClaims ?? 'unreadable'} (delta ${claimDelta ?? 'unreadable'}; exactly 2 required)`,
      verdict.qualified && slot === 'A' && stored.closedAt
        ? `activation qualifies at ${stored.closedAt}; 14-day UTC follow-up window closes ${new Date(Date.parse(stored.closedAt) + 14 * 24 * 60 * 60 * 1000).toISOString()}`
        : verdict.qualified ? 'activation qualifies' : `activation does NOT qualify: ${verdict.reasons.join(', ')}`,
      `funding outcome: ${fundingOutcome}`,
    ].join('\n');
  }

  if (command === 'activation-status') {
    const attempts = await dependencies.ledger.attempts();
    const progress = summarizePilotProgress(attempts);
    const progressLines = [
      `technical activations: ${progress.technicalActivations}/3`,
      `external market activations: ${progress.externalMarketActivations}/2 (A and C only)`,
      `founder B technical activation: ${progress.founderTechnicalActivation ? 'qualified' : 'pending'}`,
      progress.validationWindowStartedAt && progress.validationWindowClosesAt
        ? `14-day UTC window: ${progress.validationWindowStartedAt} → ${progress.validationWindowClosesAt}`
        : '14-day UTC window: not started (opens when external slot A qualifies)',
    ];
    if (attempts.length === 0) return ['no activation windows are open; no activation attempts recorded', ...progressLines].join('\n');
    return [...progressLines, ...attempts.sort((a, b) => a.slot.localeCompare(b.slot) || a.attemptNumber - b.attemptNumber)
      .map((attempt) => [
        `slot ${attempt.slot} attempt ${attempt.attemptNumber}: ${attempt.status}`,
        `  pilot role: ${PILOT_ROLE_BY_SLOT[attempt.slot]}`,
        `  participant type: ${attempt.participantType}`,
        `  integration mode: ${attempt.integrationMode}`,
        `  started: ${attempt.startedAt}`,
        `  invite: ${attempt.inviteId ?? 'pending'} (request ${attempt.inviteRequestId ?? 'none'})`,
        `  assistance: ${attempt.assistanceCount}`,
        `  committed claims: ${attempt.baselineCommittedClaims} -> ${attempt.committedClaimsAfter ?? 'pending'}`,
        `  funding outcome: ${attempt.fundingOutcome}`,
        `  evidence sha256: ${attempt.evidenceDigest ?? 'none'}`,
        ...(attempt.qualificationReasons.length ? [`  qualification reasons: ${attempt.qualificationReasons.join(', ')}`] : []),
      ].join('\n'))].join('\n');
  }

  throw new Error('unknown activation command');
}

/** In-memory retained-attempt ledger for tests and dry runs. */
export class MemoryActivationLedger implements ActivationLedger {
  private readonly records = new Map<OperatorSlot, ActivationWindow[]>();
  private readonly evidenceDigests = new Set<string>();

  private find(slot: OperatorSlot, attemptNumber: number): ActivationWindow {
    const record = (this.records.get(slot) ?? []).find((item) => item.attemptNumber === attemptNumber);
    if (!record) throw new Error(`activation attempt ${attemptNumber} for slot ${slot} was not found`);
    return record;
  }

  private replace(record: ActivationWindow): ActivationWindow {
    const list = this.records.get(record.slot) ?? [];
    this.records.set(record.slot, list.map((item) => item.attemptNumber === record.attemptNumber ? record : item));
    return { ...record, qualificationReasons: [...record.qualificationReasons] };
  }

  async openWindow(input: Parameters<ActivationLedger['openWindow']>[0]): Promise<ActivationWindow> {
    if ((await this.windows()).length > 0) throw new Error('another activation attempt is active');
    const list = this.records.get(input.slot) ?? [];
    if (list.some((record) => record.inviteRequestId === input.inviteRequestId)) throw new Error('duplicate invite request id');
    const opened: ActivationWindow = {
      ...input,
      attemptNumber: Math.max(0, ...list.map((record) => record.attemptNumber)) + 1,
      inviteId: null,
      status: 'invite_pending',
      fundingOutcome: 'unknown',
      assistanceCount: 0,
      evidence: null,
      evidenceDigest: null,
      committedClaimsAfter: null,
      qualificationReasons: [],
      closedAt: null,
    };
    list.push(opened);
    this.records.set(input.slot, list);
    return { ...opened, qualificationReasons: [] };
  }

  async attachInvite(slot: OperatorSlot, attemptNumber: number, inviteId: string): Promise<ActivationWindow> {
    const current = this.find(slot, attemptNumber);
    if (current.inviteId && current.inviteId !== inviteId) throw new Error('activation attempt already references a different invite');
    return this.replace({ ...current, inviteId, status: 'open' });
  }

  async window(slot: OperatorSlot): Promise<ActivationWindow | undefined> {
    return (this.records.get(slot) ?? []).filter(isActive).sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
  }

  async windows(): Promise<ActivationWindow[]> {
    return [...this.records.values()].flat().filter(isActive).map((record) => ({ ...record, qualificationReasons: [...record.qualificationReasons] }));
  }

  async attempts(): Promise<ActivationWindow[]> {
    return [...this.records.values()].flat().map((record) => ({ ...record, qualificationReasons: [...record.qualificationReasons] }));
  }

  async recordAssistance(slot: OperatorSlot, count: number): Promise<ActivationWindow> {
    const current = await this.window(slot);
    if (!current || current.status !== 'open') throw new Error(`no activation window is open for slot ${slot}`);
    return this.replace({ ...current, assistanceCount: current.assistanceCount + count });
  }

  async markNeedsReconciliation(slot: OperatorSlot, attemptNumber: number): Promise<ActivationWindow> {
    return this.replace({ ...this.find(slot, attemptNumber), status: 'needs_reconciliation' });
  }

  async abort(slot: OperatorSlot, attemptNumber: number, fundingOutcome: Exclude<FundingOutcome, 'unknown'>): Promise<ActivationWindow> {
    const current = this.find(slot, attemptNumber);
    return this.replace({ ...current, status: 'aborted', fundingOutcome, closedAt: new Date().toISOString() });
  }

  async reconcileFunding(slot: OperatorSlot, attemptNumber: number, fundingOutcome: Exclude<FundingOutcome, 'unknown'>): Promise<ActivationWindow> {
    const current = this.find(slot, attemptNumber);
    if (!['aborted', 'rejected', 'needs_reconciliation'].includes(current.status)) throw new Error('funding can only be reconciled for a failed attempt');
    return this.replace({ ...current, status: current.status === 'needs_reconciliation' ? 'aborted' : current.status, fundingOutcome, closedAt: current.closedAt ?? new Date().toISOString() });
  }

  async revalidateSubmitted(slot: OperatorSlot, attemptNumber: number, qualified: boolean, fundingOutcome: Exclude<FundingOutcome, 'unknown'>, reasons: string[]): Promise<ActivationWindow> {
    const current = this.find(slot, attemptNumber);
    if (current.status !== 'submitted') throw new Error('only preserved submitted evidence can be revalidated');
    return this.replace({
      ...current,
      status: qualified ? 'qualified' : 'rejected',
      fundingOutcome,
      qualificationReasons: [...reasons],
      closedAt: new Date().toISOString(),
    });
  }

  async storeEvidence(slot: OperatorSlot, attemptNumber: number, evidence: ActivationEvidence, digest: string, committedClaimsAfter: number | null, qualified: boolean, fundingOutcome: FundingOutcome, reasons: string[]): Promise<ActivationWindow> {
    if (this.evidenceDigests.has(digest)) throw new Error('duplicate activation evidence digest');
    const current = this.find(slot, attemptNumber);
    if (current.status !== 'open') throw new Error(`no activation window is open for slot ${slot}`);
    this.evidenceDigests.add(digest);
    return this.replace({
      ...current,
      evidence,
      evidenceDigest: digest,
      committedClaimsAfter,
      status: qualified ? 'qualified' : 'rejected',
      fundingOutcome,
      qualificationReasons: [...reasons],
      closedAt: new Date().toISOString(),
    });
  }
}

/** Durable retained-attempt ledger. Rows contain redacted evidence and aggregate counters only. */
export class PostgresActivationLedger implements ActivationLedger {
  constructor(private readonly pool: Pool) {}

  private toWindow(row: Record<string, unknown>): ActivationWindow {
    return {
      slot: String(row.slot) as OperatorSlot,
      attemptNumber: Number(row.attempt_number),
      inviteRequestId: row.invite_request_id === null ? null : String(row.invite_request_id),
      inviteId: row.invite_id === null ? null : String(row.invite_id),
      status: String(row.status) as ActivationAttemptStatus,
      fundingOutcome: String(row.funding_outcome) as FundingOutcome,
      participantType: String(row.participant_type) as ParticipantType,
      integrationMode: String(row.integration_mode) as IntegrationMode,
      startedAt: new Date(row.started_at as string | Date).toISOString(),
      baselineCommittedClaims: Number(row.baseline_committed_claims),
      assistanceCount: Number(row.assistance_count),
      evidence: row.evidence ?? null,
      evidenceDigest: row.evidence_digest === null ? null : String(row.evidence_digest),
      committedClaimsAfter: row.committed_claims_after === null ? null : Number(row.committed_claims_after),
      qualificationReasons: Array.isArray(row.qualification_reasons) ? row.qualification_reasons.map(String) : [],
      closedAt: row.closed_at ? new Date(row.closed_at as string | Date).toISOString() : null,
    };
  }

  private readonly columns = 'slot, attempt_number, invite_request_id, invite_id, status, funding_outcome, participant_type, integration_mode, started_at, baseline_committed_claims, assistance_count, evidence, evidence_digest, committed_claims_after, qualification_reasons, closed_at';

  async openWindow(input: Parameters<ActivationLedger['openWindow']>[0]): Promise<ActivationWindow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [8_423_190_077]);
      const active = await client.query(`SELECT slot FROM control_plane.activation_attempts WHERE status IN ('invite_pending', 'open', 'submitted', 'needs_reconciliation') LIMIT 1`);
      if (active.rowCount) throw new Error(`another activation attempt is active for slot ${active.rows[0].slot}`);
      const current = await client.query('SELECT COALESCE(MAX(attempt_number), 0) AS latest FROM control_plane.activation_attempts WHERE slot = $1', [input.slot]);
      const attemptNumber = Number(current.rows[0].latest) + 1;
      const result = await client.query(
        `INSERT INTO control_plane.activation_attempts
           (slot, attempt_number, invite_request_id, invite_id, participant_type, integration_mode, started_at, baseline_committed_claims, status)
         VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, 'invite_pending')
         RETURNING ${this.columns}`,
        [input.slot, attemptNumber, input.inviteRequestId, input.participantType, input.integrationMode, input.startedAt, input.baselineCommittedClaims],
      );
      await client.query('COMMIT');
      return this.toWindow(result.rows[0] as Record<string, unknown>);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async attachInvite(slot: OperatorSlot, attemptNumber: number, inviteId: string): Promise<ActivationWindow> {
    const result = await this.pool.query(
      `UPDATE control_plane.activation_attempts SET invite_id = $3, status = 'open'
        WHERE slot = $1 AND attempt_number = $2 AND status IN ('invite_pending', 'needs_reconciliation')
      RETURNING ${this.columns}`,
      [slot, attemptNumber, inviteId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error(`activation attempt ${attemptNumber} for slot ${slot} cannot accept an invite`);
    return this.toWindow(row);
  }

  async window(slot: OperatorSlot): Promise<ActivationWindow | undefined> {
    const result = await this.pool.query(
      `SELECT ${this.columns} FROM control_plane.activation_attempts
        WHERE slot = $1 AND status IN ('invite_pending', 'open', 'submitted', 'needs_reconciliation')
        ORDER BY attempt_number DESC LIMIT 1`,
      [slot],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? this.toWindow(row) : undefined;
  }

  async windows(): Promise<ActivationWindow[]> {
    const result = await this.pool.query(
      `SELECT ${this.columns} FROM control_plane.activation_attempts
        WHERE status IN ('invite_pending', 'open', 'submitted', 'needs_reconciliation') ORDER BY slot, attempt_number`,
    );
    return result.rows.map((row) => this.toWindow(row as Record<string, unknown>));
  }

  async attempts(): Promise<ActivationWindow[]> {
    const result = await this.pool.query(`SELECT ${this.columns} FROM control_plane.activation_attempts ORDER BY slot, attempt_number`);
    return result.rows.map((row) => this.toWindow(row as Record<string, unknown>));
  }

  async recordAssistance(slot: OperatorSlot, count: number): Promise<ActivationWindow> {
    const result = await this.pool.query(
      `UPDATE control_plane.activation_attempts SET assistance_count = assistance_count + $2
        WHERE slot = $1 AND status = 'open'
        AND attempt_number = (SELECT MAX(attempt_number) FROM control_plane.activation_attempts WHERE slot = $1 AND status = 'open')
      RETURNING ${this.columns}`,
      [slot, count],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error(`no activation window is open for slot ${slot}`);
    return this.toWindow(row);
  }

  async markNeedsReconciliation(slot: OperatorSlot, attemptNumber: number): Promise<ActivationWindow> {
    return this.updateAttempt(`UPDATE control_plane.activation_attempts SET status = 'needs_reconciliation'
      WHERE slot = $1 AND attempt_number = $2 AND status IN ('invite_pending', 'open') RETURNING ${this.columns}`, [slot, attemptNumber]);
  }

  async abort(slot: OperatorSlot, attemptNumber: number, fundingOutcome: Exclude<FundingOutcome, 'unknown'>): Promise<ActivationWindow> {
    return this.updateAttempt(`UPDATE control_plane.activation_attempts SET status = 'aborted', funding_outcome = $3, closed_at = now()
      WHERE slot = $1 AND attempt_number = $2 AND status IN ('invite_pending', 'open', 'submitted', 'needs_reconciliation') RETURNING ${this.columns}`, [slot, attemptNumber, fundingOutcome]);
  }

  async reconcileFunding(slot: OperatorSlot, attemptNumber: number, fundingOutcome: Exclude<FundingOutcome, 'unknown'>): Promise<ActivationWindow> {
    return this.updateAttempt(`UPDATE control_plane.activation_attempts
      SET status = CASE WHEN status = 'needs_reconciliation' THEN 'aborted' ELSE status END,
          funding_outcome = $3, closed_at = COALESCE(closed_at, now())
      WHERE slot = $1 AND attempt_number = $2 AND status IN ('aborted', 'rejected', 'needs_reconciliation') RETURNING ${this.columns}`, [slot, attemptNumber, fundingOutcome]);
  }

  async revalidateSubmitted(slot: OperatorSlot, attemptNumber: number, qualified: boolean, fundingOutcome: Exclude<FundingOutcome, 'unknown'>, reasons: string[]): Promise<ActivationWindow> {
    return this.updateAttempt(`UPDATE control_plane.activation_attempts
      SET status = $3, funding_outcome = $4, qualification_reasons = $5::jsonb, closed_at = now()
      WHERE slot = $1 AND attempt_number = $2 AND status = 'submitted' RETURNING ${this.columns}`,
    [slot, attemptNumber, qualified ? 'qualified' : 'rejected', fundingOutcome, JSON.stringify(reasons)]);
  }

  async storeEvidence(slot: OperatorSlot, attemptNumber: number, evidence: ActivationEvidence, digest: string, committedClaimsAfter: number | null, qualified: boolean, fundingOutcome: FundingOutcome, reasons: string[]): Promise<ActivationWindow> {
    const result = await this.pool.query(
      `UPDATE control_plane.activation_attempts
          SET evidence = $3::jsonb, evidence_digest = $4, committed_claims_after = $5,
              status = $6, funding_outcome = $7, qualification_reasons = $8::jsonb, closed_at = now()
        WHERE slot = $1 AND attempt_number = $2 AND status = 'open'
      RETURNING ${this.columns}`,
      [slot, attemptNumber, JSON.stringify(evidence), digest, committedClaimsAfter, qualified ? 'qualified' : 'rejected', fundingOutcome, JSON.stringify(reasons)],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error(`no open activation attempt ${attemptNumber} for slot ${slot}; digest may already exist`);
    return this.toWindow(row);
  }

  private async updateAttempt(query: string, values: unknown[]): Promise<ActivationWindow> {
    const result = await this.pool.query(query, values);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error('activation attempt state did not permit this update');
    return this.toWindow(row);
  }
}
