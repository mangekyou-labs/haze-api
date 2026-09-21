/**
 * Postgres integration for the founder activation windows.
 *
 * The durable row is the only record of an activation, so it has to hold the
 * deterministic slot assignment, an aggregate baseline, an assistance count,
 * and the validated redacted bundle — and nothing that could identify an
 * operator or join to a spend-plane claim.
 *
 * Opt-in via RUN_DB_TESTS=1 so the default suite stays green without a DB.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { ZK_PREPAID_LIFECYCLE_FAILURES, type ZkPrepaidLifecycleFailure } from '@zk-credits/x402-zk-prepaid';
import { runMigrations } from './db/migrate.js';
import { PostgresActivationLedger } from './activation.js';
import {
  ACTIVATION_EVIDENCE_KIND,
  ACTIVATION_EVIDENCE_SCHEMA_VERSION,
  PINNED_ACTIVATION_VERSIONS,
  PINNED_ARTIFACT_RELEASE,
  SLOT_ASSIGNMENT,
  type ActivationCounterSnapshot,
  type ActivationEvidence,
  type OperatorSlot,
} from './activation-evidence.js';

const MIGRATIONS_DIR = resolve(import.meta.dirname, 'db', 'migrations');
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/zk_credits_test';
const ADMIN_DATABASE_URL = process.env.TEST_ADMIN_DATABASE_URL || 'postgres://localhost:5432/postgres';
// Shares the advisory lock used by the other Postgres integration files so the
// migration-reset test in db/migrate.test.ts cannot drop these schemas mid-run.
const DB_TEST_LOCK = 8_402_062_006;

const dbTestsEnabled = process.env.RUN_DB_TESTS === '1';

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

function evidence(slot: OperatorSlot): ActivationEvidence {
  const assignment = SLOT_ASSIGNMENT[slot];
  return {
    kind: ACTIVATION_EVIDENCE_KIND,
    schemaVersion: ACTIVATION_EVIDENCE_SCHEMA_VERSION,
    slot,
    participantType: assignment.participantType,
    integrationMode: assignment.integrationMode,
    versions: { ...PINNED_ACTIVATION_VERSIONS, artifactRelease: PINNED_ARTIFACT_RELEASE },
    activatedAt: '2026-09-21T04:00:00.000Z',
    onboardingDurationMs: 1_800_000,
    counters: {
      // A fresh sidecar, then the discarded cold warm-up, then the single
      // counted exchange: two clean lifecycles in total.
      beforeWarmup: cleanSnapshots(0),
      afterWarmup: cleanSnapshots(1),
      afterHotExchange: cleanSnapshots(2),
    },
    assistanceCount: 0,
    attestations: {
      ranAgentLocally: true,
      credentialStayedLocal: true,
      noManualRecovery: true,
      distinctOperatorOwnership: true,
    },
  };
}

const DIGEST = 'a'.repeat(64);

describe.skipIf(!dbTestsEnabled)('activation windows (integration, requires Postgres)', () => {
  let pool: Pool;
  let lockClient: Awaited<ReturnType<Pool['connect']>>;
  let ledger: PostgresActivationLedger;

  beforeAll(async () => {
    const dbName = new URL(TEST_DATABASE_URL).pathname.slice(1);
    const admin = new Pool({ connectionString: ADMIN_DATABASE_URL });
    try {
      await admin.query(`CREATE DATABASE ${dbName}`);
    } catch {
      // database already exists — fine
    }
    await admin.end();

    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    lockClient = await pool.connect();
    await lockClient.query('SELECT pg_advisory_lock($1)', [DB_TEST_LOCK]);
    await runMigrations(pool, MIGRATIONS_DIR);
    await pool.query('TRUNCATE control_plane.activation_windows');
    ledger = new PostgresActivationLedger(pool);
  });

  afterAll(async () => {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [DB_TEST_LOCK]);
    lockClient.release();
    await pool.end();
  });

  it('opens one window per slot and holds no identity or spend-plane column', async () => {
    const opened = await ledger.openWindow({
      slot: 'A',
      inviteId: 'inv_4242',
      participantType: SLOT_ASSIGNMENT.A.participantType,
      integrationMode: SLOT_ASSIGNMENT.A.integrationMode,
      startedAt: '2026-09-21T03:00:00.000Z',
      baselineCommittedClaims: 7,
    });
    expect(opened).toMatchObject({ slot: 'A', baselineCommittedClaims: 7, assistanceCount: 0, evidenceDigest: null });

    const rows = await pool.query('SELECT * FROM control_plane.activation_windows');
    expect(rows.rowCount).toBe(1);
    const columns = Object.keys(rows.rows[0]!);
    for (const forbidden of ['github_account_id', 'email', 'login', 'commitment', 'nullifier', 'request_signal', 'code_hash', 'token_hash']) {
      expect(columns).not.toContain(forbidden);
    }
    expect(columns).toContain('invite_id');

    // A slot is assigned once: the primary key refuses a replacement.
    await expect(ledger.openWindow({
      slot: 'A',
      inviteId: 'inv_other',
      participantType: SLOT_ASSIGNMENT.A.participantType,
      integrationMode: SLOT_ASSIGNMENT.A.integrationMode,
      startedAt: '2026-09-21T05:00:00.000Z',
      baselineCommittedClaims: 9,
    })).rejects.toThrow();
  });

  it('enforces the deterministic cohort assignment in the database', async () => {
    // B is the x402-native slot, so the sidecar assignment must be refused.
    await expect(ledger.openWindow({
      slot: 'B',
      inviteId: 'inv_b',
      participantType: 'coding_agent',
      integrationMode: 'openai_compatible_sidecar',
      startedAt: '2026-09-21T03:00:00.000Z',
      baselineCommittedClaims: 0,
    })).rejects.toThrow();
  });

  it('accumulates assistance and refuses a slot with no window', async () => {
    const first = await ledger.recordAssistance('A', 1);
    expect(first.assistanceCount).toBe(1);
    const second = await ledger.recordAssistance('A', 2);
    expect(second.assistanceCount).toBe(3);
    await expect(ledger.recordAssistance('C', 1)).rejects.toThrow(/no activation window/u);
  });

  it('round-trips the validated redacted bundle and its aggregate comparison', async () => {
    const stored = await ledger.storeEvidence('A', evidence('A'), DIGEST, 9);
    expect(stored.evidenceDigest).toBe(DIGEST);
    expect(stored.committedClaimsAfter).toBe(9);

    const row = await pool.query('SELECT evidence, evidence_digest, committed_claims_after FROM control_plane.activation_windows WHERE slot = $1', ['A']);
    expect(row.rows[0].evidence_digest).toBe(DIGEST);
    expect(Number(row.rows[0].committed_claims_after)).toBe(9);
    // The JSONB bundle is exactly the aggregate evidence, with no extra key.
    // The three counter snapshots are what make the warm-up, the counted
    // exchange, and any contamination arithmetically separable after the fact.
    expect(Object.keys(row.rows[0].evidence).sort()).toEqual([
      'activatedAt',
      'assistanceCount',
      'attestations',
      'counters',
      'integrationMode',
      'kind',
      'onboardingDurationMs',
      'participantType',
      'schemaVersion',
      'slot',
      'versions',
    ]);
    const counters = row.rows[0].evidence.counters;
    expect(Object.keys(counters).sort()).toEqual(['afterHotExchange', 'afterWarmup', 'beforeWarmup']);
    // The warm-up and the counted exchange are both recoverable from the row.
    expect(counters.beforeWarmup.proving.hotProveSamples).toBe(0);
    expect(counters.afterHotExchange.exchange.exchangeSuccesses).toBe(2);

    const reopened = await ledger.window('A');
    expect(reopened).toMatchObject({ slot: 'A', evidenceDigest: DIGEST, committedClaimsAfter: 9, assistanceCount: 3 });
    expect(await ledger.windows()).toHaveLength(1);
  });

  it('refuses a malformed evidence digest', async () => {
    await expect(ledger.storeEvidence('A', evidence('A'), 'not-a-digest', 9)).rejects.toThrow();
  });

  it('reports an unopened slot as absent', async () => {
    expect(await ledger.window('C')).toBeUndefined();
  });
});
