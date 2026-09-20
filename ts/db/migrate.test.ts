import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { runMigrations } from './migrate.js';
import { SCHEMAS } from './config.js';

const MIGRATIONS_DIR = resolve(import.meta.dirname, 'migrations');
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/zk_credits_test';
const ADMIN_DATABASE_URL = process.env.TEST_ADMIN_DATABASE_URL || 'postgres://localhost:5432/postgres';
const DB_TEST_LOCK = 8_402_062_006;

// Integration tests against a real Postgres are opt-in so the default `npm test`
// stays green without a DB (mirrors the circuit-artifact gating pattern).
const dbTestsEnabled = process.env.RUN_DB_TESTS === '1';

function dbNameFrom(url: string): string {
  return new URL(url).pathname.slice(1);
}

describe('migrations (offline, static)', () => {
  it('has an ordered, non-empty migration list', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    expect(files.length).toBeGreaterThan(0);
    expect([...files].sort()).toEqual(files);
  });

  it('init migration provisions the original three isolated schemas', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0001_init.sql'), 'utf8');
    for (const s of SCHEMAS.filter((schema) => schema !== 'evaluation')) {
      expect(sql).toMatch(new RegExp(`CREATE SCHEMA IF NOT EXISTS "${s}"`, 'i'));
    }
  });

  it('gateway migration (0002) provisions the durable state tables', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0002_gateway.sql'), 'utf8');
    for (const table of ['accepted_calls', 'nullifier_records', 'api_key_records', 'call_counts']) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS gateway\\.${table}`, 'i'));
    }
    // Privacy boundary: accepted_calls must never carry a commitment column.
    expect(sql).not.toMatch(/accepted_calls[\\s\\S]*commitment/i);
  });

  it('billing migration (0003) provisions the idempotent StripeEvent table', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0003_billing.sql'), 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS billing\.stripe_events/i);
    expect(sql).toMatch(/event_id\s+text PRIMARY KEY/i);
    expect(sql).toMatch(/processed\s+boolean/i);
  });

  it('spend-queue migration (0004) adds the durable proof payload to accepted_calls', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0004_spend_queue.sql'), 'utf8');
    expect(sql).toMatch(/ALTER TABLE gateway\.accepted_calls/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS proof_json\s+text/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS pub_signals\s+jsonb/i);
  });

  it('fee-sponsor migration (0005) provisions the idempotent fee-relay requests table', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0005_fee_sponsor.sql'), 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "fee-sponsor"\.fee_relay_requests/i);
    expect(sql).toMatch(/inner_tx_hash\s+text PRIMARY KEY/i);
    expect(sql).toMatch(/status\s+text/i);
  });

  it('settlement quarantine migration (0007) records legacy-row status and reason', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0007_settlement_quarantine.sql'), 'utf8');
    expect(sql).toMatch(/ALTER TABLE gateway\.accepted_calls/i);
    expect(sql).toMatch(/settlement_status\s+text/i);
    expect(sql).toMatch(/settlement_error\s+text/i);
    expect(sql).toMatch(/quarantined_at\s+timestamptz/i);
    expect(sql).toMatch(/UPDATE gateway\.accepted_calls/i);
    expect(sql).toMatch(/jsonb_array_length\(pub_signals\)\s+<>\s+4/i);
  });

  it('membership-tree migration (0008) persists leaves and root state outside accepted calls', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0008_membership_tree.sql'), 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS gateway\.membership_tree_leaves/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS gateway\.membership_tree_state/i);
    expect(sql).toMatch(/candidate_root\s+text NOT NULL/i);
    expect(sql).not.toMatch(/ALTER TABLE\s+gateway\.accepted_calls/i);
  });

  it('evaluation migration is the ninth migration and isolates restricted records', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    expect(files).toContain('0009_evaluation.sql');
    expect(files.indexOf('0009_evaluation.sql')).toBe(files.length - 1);
    expect(SCHEMAS).toContain('evaluation');

    const sql = readFileSync(join(MIGRATIONS_DIR, '0009_evaluation.sql'), 'utf8');
    expect(sql).toMatch(/CREATE SCHEMA IF NOT EXISTS evaluation/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS evaluation\.participants/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS evaluation\.wallet_challenges/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS evaluation\.checkout_receipts/i);
    expect(sql).toMatch(/retention_deadline/i);
    expect(sql).toMatch(/UNIQUE/i);
    expect(sql).toMatch(/wallet_signature/i);
    expect(sql).toMatch(/wallet_fingerprint\s+text\s+UNIQUE/i);
    expect(sql).toMatch(/wallet_fingerprint IS NULL OR wallet_fingerprint ~ '\^\[a-f0-9\]\{64\}\$'/i);
    expect(sql).toMatch(/amount_cents\s+integer\s+NOT NULL\s+CHECK\s*\(amount_cents\s*=\s*100\)/i);
  });

  it('claim lifecycle migration adds durable fencing, replay expiry, and bounded dispatch', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0014_base_claim_lifecycle.sql'), 'utf8');
    for (const column of [
      'generation BIGINT',
      'fencing_token TEXT',
      'lease_expires_at TIMESTAMPTZ',
      'dispatch_count INTEGER',
      'replay_expires_at TIMESTAMPTZ',
      'dispatch_idempotency_key TEXT',
      'commit_idempotency_key TEXT',
    ]) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`, 'i'));
    }
    expect(sql).toMatch(/state IN \('reserved', 'ready', 'committed', 'cancelled'\)/i);
    expect(sql).toMatch(/dispatch_count BETWEEN 0 AND 2/i);
    expect(sql).toMatch(/claims_nullifier_signal_idx/i);
    expect(sql).toMatch(/encrypted_replay[\s\S]*plaintext is never stored/i);
  });
});

describe.skipIf(!dbTestsEnabled)('migrations (integration, requires Postgres)', () => {
  let pool: Pool;
  let lockClient: Awaited<ReturnType<Pool['connect']>>;

  beforeAll(async () => {
    const dbName = dbNameFrom(TEST_DATABASE_URL);
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
    // Reset the test DB to a clean slate so the "first run applies > 0"
    // assertion is deterministic across repeated invocations (the migration
    // runner itself is idempotent and would otherwise apply 0 on the 2nd run).
    await pool.query('DROP SCHEMA IF EXISTS gateway CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS billing CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS "fee-sponsor" CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS evaluation CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS spend_plane CASCADE');
    await pool.query('DROP TABLE IF EXISTS public.schema_migrations');
  });

  afterAll(async () => {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [DB_TEST_LOCK]);
    lockClient.release();
    await pool.end();
  });

  it('applies migrations idempotently and creates all isolated schemas', async () => {
    const first = await runMigrations(pool, MIGRATIONS_DIR);
    expect(first.applied.length).toBeGreaterThan(0);

    const second = await runMigrations(pool, MIGRATIONS_DIR);
    expect(second.applied).toEqual([]); // idempotent — nothing re-applied

    const res = await pool.query(
      `SELECT schema_name FROM information_schema.schemata
       WHERE schema_name IN ('gateway', 'billing', 'fee-sponsor', 'evaluation', 'spend_plane')`,
    );
    const names = res.rows.map((r) => r.schema_name).sort();
    expect(names).toEqual(['billing', 'evaluation', 'fee-sponsor', 'gateway', 'spend_plane']);
  });
});
