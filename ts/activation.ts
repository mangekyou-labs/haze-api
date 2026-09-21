/**
 * Founder activation coordinator for the invite-only unpaid pilot.
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

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { ZK_PREPAID_LIFECYCLE_FAILURES } from '@zk-credits/x402-zk-prepaid';
import {
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
  inviteId: string;
  participantType: ParticipantType;
  integrationMode: IntegrationMode;
  startedAt: string;
  baselineCommittedClaims: number;
  assistanceCount: number;
  evidenceDigest: string | null;
  committedClaimsAfter: number | null;
}

export interface ActivationLedger {
  openWindow(window: Omit<ActivationWindow, 'assistanceCount' | 'evidenceDigest' | 'committedClaimsAfter'>): Promise<ActivationWindow>;
  window(slot: OperatorSlot): Promise<ActivationWindow | undefined>;
  windows(): Promise<ActivationWindow[]>;
  recordAssistance(slot: OperatorSlot, count: number): Promise<ActivationWindow>;
  storeEvidence(slot: OperatorSlot, evidence: ActivationEvidence, digest: string, committedClaimsAfter: number | null): Promise<ActivationWindow>;
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
  issueInvite(githubAccountId: string): Promise<{ inviteId: string; code: string; expiresAt: number }>;
  /** Revokes an invite when opening its durable activation window fails. */
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
  if (window.inviteId.length === 0) reasons.push('no_redeemable_invite');
  if (committedClaimsAfter === null) reasons.push('aggregate_claim_count_unreadable');
  else if (committedClaimsAfter <= window.baselineCommittedClaims) {
    reasons.push('aggregate_committed_claims_did_not_increase');
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
    `onboarding duration ms: ${evidence.onboardingDurationMs}`,
    `assistance count: ${evidence.assistanceCount}`,
    counterRow('before warm-up', beforeWarmup),
    exchangeLine('cold warm-up delta', warmup),
    exchangeLine('hot exchange delta', hot),
    counterRow('after hot exchange', afterHotExchange),
  ].join('\n');
}

/** Runs one founder activation command and returns the text to print. */
export async function runActivationCommand(
  args: readonly string[],
  dependencies: ActivationDependencies,
): Promise<string> {
  const [command, ...rest] = args;

  if (command === 'activation-start') {
    const slot = requireSlot(rest);
    const githubAccountId = readFlag(rest, 'github-id');
    if (!githubAccountId) throw new Error('--github-id is required');
    const existing = await dependencies.ledger.window(slot);
    if (existing) throw new Error(`slot ${slot} already has an open activation window`);
    const attempt = await dependencies.probe.prewarm();
    await dependencies.probe.requireReady();
    const baseline = await dependencies.probe.status();
    if (baseline.launchState !== 'enabled') throw new Error(`the pilot is ${baseline.launchState}, not enabled`);
    if (baseline.committedClaims === null) throw new Error('the gateway did not report an aggregate committed-claim count');
    const assignment = SLOT_ASSIGNMENT[slot];
    const issued = await dependencies.issueInvite(githubAccountId);
    let window: ActivationWindow;
    try {
      window = await dependencies.ledger.openWindow({
        slot,
        inviteId: issued.inviteId,
        participantType: assignment.participantType,
        integrationMode: assignment.integrationMode,
        startedAt: new Date((dependencies.now ?? Date.now)()).toISOString(),
        baselineCommittedClaims: baseline.committedClaims,
      });
    } catch (error) {
      // An INSERT can commit even when its response is lost. Re-read the slot
      // before revoking so a retry cannot invalidate a durable window that
      // already owns this invite. If the read is also unavailable, stop with
      // an explicit reconciliation instruction rather than issuing another
      // invite on the next attempt.
      let existing: ActivationWindow | undefined;
      try {
        existing = await dependencies.ledger.window(slot);
      } catch {
        throw new Error(`activation window outcome is unknown after issuing invite ${issued.inviteId}; reconcile the slot and invite before retrying`);
      }
      if (existing?.inviteId === issued.inviteId) {
        throw new Error(`activation window for slot ${slot} was opened but its response was lost; reconcile before retrying`);
      }
      const revoked = await dependencies.revokeInvite(issued.inviteId);
      if (!revoked) throw new Error(`invite ${issued.inviteId} could not be revoked after the activation window failed; reconcile before retrying`);
      throw error;
    }
    return [
      `activation window opened for slot ${slot}`,
      `prewarm attempts: ${attempt}`,
      `launch state: ${baseline.launchState}`,
      `baseline committed claims: ${window.baselineCommittedClaims}`,
      `participant type: ${window.participantType}`,
      `integration mode: ${window.integrationMode}`,
      `invite id: ${issued.inviteId}`,
      `expires: ${new Date(issued.expiresAt).toISOString()}`,
      `code (shown once): ${issued.code}`,
    ].join('\n');
  }

  if (command === 'activation-rehearse') {
    // No slot, no invite, no window: the rehearsal proves the founder's
    // orchestration against the real deployment without spending one of the
    // three operator slots.
    const open = await dependencies.ledger.windows();
    if (open.length > 0) {
      throw new Error(`refusing to rehearse while slot(s) ${open.map((window) => window.slot).join(', ')} are open: extra traffic contaminates a live window`);
    }
    const attempt = await dependencies.probe.prewarm();
    await dependencies.probe.requireReady();
    const baseline = await dependencies.probe.status();
    if (baseline.launchState !== 'enabled') throw new Error(`the pilot is ${baseline.launchState}, not enabled`);
    if (baseline.committedClaims === null) throw new Error('the gateway did not report an aggregate committed-claim count');
    return [
      'activation rehearsal: the founder half of the sequence succeeded',
      'no invite was issued and no activation window was opened',
      `prewarm attempts: ${attempt}`,
      `launch state: ${baseline.launchState}`,
      `effective spend caps: ${baseline.dailyCapMicroUsd?.toString() ?? 'unreadable'} per UTC day, ${baseline.rollingCapMicroUsd?.toString() ?? 'unreadable'} per rolling 30 days (micro-USD)`,
      `baseline committed claims: ${baseline.committedClaims}`,
      'the operator half is unchanged: one discarded warm-up, then one counted exchange',
    ].join('\n');
  }

  if (command === 'activation-assist') {
    const slot = requireSlot(rest);
    const window = await dependencies.ledger.recordAssistance(slot, 1);
    return `assistance recorded for slot ${slot}: ${window.assistanceCount} event(s)`;
  }

  if (command === 'activation-evidence') {
    const slot = requireSlot(rest);
    const window = await dependencies.ledger.window(slot);
    if (!window) throw new Error(`no activation window is open for slot ${slot}`);
    const raw = readFlag(rest, 'file');
    if (!raw) throw new Error('--file is required');
    const bytes = await readFile(raw, 'utf8');
    const digest = createHash('sha256').update(bytes).digest('hex');
    let parsed: unknown;
    try { parsed = JSON.parse(bytes); }
    catch { throw new Error('evidence bundle is not valid JSON'); }

    const validation = validateActivationEvidence(parsed, slot);
    if (!validation.valid) {
      throw new Error(`evidence bundle rejected:\n${formatFailures(validation.failures)}`);
    }
    const evidence = parsed as ActivationEvidence;
    if (evidence.assistanceCount !== window.assistanceCount) {
      throw new Error(`evidence reports ${evidence.assistanceCount} assistance event(s) but the window recorded ${window.assistanceCount}`);
    }
    const after = await dependencies.probe.status();
    const verdict = qualifyActivation(evidence, window, after.committedClaims);
    await dependencies.ledger.storeEvidence(slot, evidence, digest, after.committedClaims);
    return [
      summariseEvidence(evidence),
      `evidence sha256: ${digest}`,
      `committed claims: ${window.baselineCommittedClaims} -> ${after.committedClaims ?? 'unreadable'}`,
      verdict.qualified ? 'activation qualifies' : `activation does NOT qualify: ${verdict.reasons.join(', ')}`,
    ].join('\n');
  }

  if (command === 'activation-status') {
    const windows = await dependencies.ledger.windows();
    if (windows.length === 0) return 'no activation windows are open';
    return windows
      .map((window) => [
        `slot ${window.slot}: ${window.evidenceDigest ? 'evidence imported' : 'awaiting evidence'}`,
        `  participant type: ${window.participantType}`,
        `  integration mode: ${window.integrationMode}`,
        `  started: ${window.startedAt}`,
        `  assistance: ${window.assistanceCount}`,
        `  committed claims: ${window.baselineCommittedClaims} -> ${window.committedClaimsAfter ?? 'pending'}`,
      ].join('\n'))
      .join('\n');
  }

  throw new Error('unknown activation command');
}

function formatFailures(failures: readonly EvidenceFailure[]): string {
  return failures.map((failure) => `  ${failure.path || '<root>'}: ${failure.reason}`).join('\n');
}

/** In-memory ledger for tests and dry runs. */
export class MemoryActivationLedger implements ActivationLedger {
  private readonly records = new Map<OperatorSlot, ActivationWindow>();

  async openWindow(window: Omit<ActivationWindow, 'assistanceCount' | 'evidenceDigest' | 'committedClaimsAfter'>): Promise<ActivationWindow> {
    const opened: ActivationWindow = { ...window, assistanceCount: 0, evidenceDigest: null, committedClaimsAfter: null };
    this.records.set(window.slot, opened);
    return { ...opened };
  }

  async window(slot: OperatorSlot): Promise<ActivationWindow | undefined> {
    const found = this.records.get(slot);
    return found ? { ...found } : undefined;
  }

  async windows(): Promise<ActivationWindow[]> {
    return [...this.records.values()].map((window) => ({ ...window }));
  }

  async recordAssistance(slot: OperatorSlot, count: number): Promise<ActivationWindow> {
    const current = this.records.get(slot);
    if (!current) throw new Error(`no activation window is open for slot ${slot}`);
    const next = { ...current, assistanceCount: current.assistanceCount + count };
    this.records.set(slot, next);
    return { ...next };
  }

  async storeEvidence(slot: OperatorSlot, _evidence: ActivationEvidence, digest: string, committedClaimsAfter: number | null): Promise<ActivationWindow> {
    const current = this.records.get(slot);
    if (!current) throw new Error(`no activation window is open for slot ${slot}`);
    const next = { ...current, evidenceDigest: digest, committedClaimsAfter };
    this.records.set(slot, next);
    return { ...next };
  }
}

/** Durable ledger. The row holds a slot, an invite handle, and integers only. */
export class PostgresActivationLedger implements ActivationLedger {
  constructor(private readonly pool: Pool) {}

  private toWindow(row: Record<string, unknown>): ActivationWindow {
    return {
      slot: String(row.slot) as OperatorSlot,
      inviteId: String(row.invite_id),
      participantType: String(row.participant_type) as ParticipantType,
      integrationMode: String(row.integration_mode) as IntegrationMode,
      startedAt: new Date(row.started_at as string).toISOString(),
      baselineCommittedClaims: Number(row.baseline_committed_claims),
      assistanceCount: Number(row.assistance_count),
      evidenceDigest: row.evidence_digest === null ? null : String(row.evidence_digest),
      committedClaimsAfter: row.committed_claims_after === null ? null : Number(row.committed_claims_after),
    };
  }

  private readonly columns = 'slot, invite_id, participant_type, integration_mode, started_at, baseline_committed_claims, assistance_count, evidence_digest, committed_claims_after';

  async openWindow(window: Omit<ActivationWindow, 'assistanceCount' | 'evidenceDigest' | 'committedClaimsAfter'>): Promise<ActivationWindow> {
    const result = await this.pool.query(
      `INSERT INTO control_plane.activation_windows
         (slot, invite_id, participant_type, integration_mode, started_at, baseline_committed_claims)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${this.columns}`,
      [window.slot, window.inviteId, window.participantType, window.integrationMode, window.startedAt, window.baselineCommittedClaims],
    );
    return this.toWindow(result.rows[0] as Record<string, unknown>);
  }

  async window(slot: OperatorSlot): Promise<ActivationWindow | undefined> {
    const result = await this.pool.query(`SELECT ${this.columns} FROM control_plane.activation_windows WHERE slot = $1`, [slot]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? this.toWindow(row) : undefined;
  }

  async windows(): Promise<ActivationWindow[]> {
    const result = await this.pool.query(`SELECT ${this.columns} FROM control_plane.activation_windows ORDER BY slot`);
    return result.rows.map((row) => this.toWindow(row as Record<string, unknown>));
  }

  async recordAssistance(slot: OperatorSlot, count: number): Promise<ActivationWindow> {
    const result = await this.pool.query(
      `UPDATE control_plane.activation_windows
          SET assistance_count = assistance_count + $2
        WHERE slot = $1
      RETURNING ${this.columns}`,
      [slot, count],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error(`no activation window is open for slot ${slot}`);
    return this.toWindow(row);
  }

  async storeEvidence(slot: OperatorSlot, evidence: ActivationEvidence, digest: string, committedClaimsAfter: number | null): Promise<ActivationWindow> {
    // The validated bundle is durable so the founder can re-derive the
    // committed summary without re-reading an operator file.
    const result = await this.pool.query(
      `UPDATE control_plane.activation_windows
          SET evidence = $2::jsonb, evidence_digest = $3, committed_claims_after = $4
        WHERE slot = $1
      RETURNING ${this.columns}`,
      [slot, JSON.stringify(evidence), digest, committedClaimsAfter],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error(`no activation window is open for slot ${slot}`);
    return this.toWindow(row);
  }
}
