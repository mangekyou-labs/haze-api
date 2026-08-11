import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { runMigrations } from './migrate.js';
import { SCHEMAS } from './config.js';

const MIGRATIONS_DIR = resolve(import.meta.dirname, 'migrations');
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/zk_credits_test';
const ADMIN_DATABASE_URL = process.env.TEST_ADMIN_DATABASE_URL || 'postgres://localhost:5432/postgres';

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

  it('init migration provisions the three isolated schemas', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0001_init.sql'), 'utf8');
    for (const s of SCHEMAS) {
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
});

describe.skipIf(!dbTestsEnabled)('migrations (integration, requires Postgres)', () => {
  let pool: Pool;

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
    // Reset the test DB to a clean slate so the "first run applies > 0"
    // assertion is deterministic across repeated invocations (the migration
    // runner itself is idempotent and would otherwise apply 0 on the 2nd run).
    await pool.query('DROP SCHEMA IF EXISTS gateway CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS billing CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS "fee-sponsor" CASCADE');
    await pool.query('DROP TABLE IF EXISTS public.schema_migrations');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('applies migrations idempotently and creates the three isolated schemas', async () => {
    const first = await runMigrations(pool, MIGRATIONS_DIR);
    expect(first.applied.length).toBeGreaterThan(0);

    const second = await runMigrations(pool, MIGRATIONS_DIR);
    expect(second.applied).toEqual([]); // idempotent — nothing re-applied

    const res = await pool.query(
      `SELECT schema_name FROM information_schema.schemata
       WHERE schema_name IN ('gateway', 'billing', 'fee-sponsor')`,
    );
    const names = res.rows.map((r) => r.schema_name).sort();
    expect(names).toEqual(['billing', 'fee-sponsor', 'gateway']);
  });
});
