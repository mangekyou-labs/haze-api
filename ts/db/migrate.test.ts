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
    const privateSchemas = SCHEMAS.filter((schema) => !['evaluation', 'spend_plane', 'control_plane', 'pilot_provisioning'].includes(schema));
    for (const s of privateSchemas) {
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

  it('evaluation migration remains historical and isolates restricted records', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    expect(files).toContain('0009_evaluation.sql');
    expect(files.indexOf('0009_evaluation.sql')).toBe(files.indexOf('0010_base_private_credits.sql') - 1);
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

  it('Base migration isolates x402 replay state from customer records', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0010_base_private_credits.sql'), 'utf8');
    expect(sql).toMatch(/CREATE SCHEMA IF NOT EXISTS spend_plane/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS spend_plane\.claims/i);
    expect(sql).toMatch(/nullifier\s+TEXT\s+PRIMARY KEY/i);
    expect(sql).not.toMatch(/\b(commitment|account|wallet|prompt|response)\s+(text|varchar|json|jsonb|uuid)/i);
  });

  it('Base chain migration persists public event and root synchronization state', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0012_base_chain_events.sql'), 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS billing\.base_contract_events/i);
    expect(sql).toMatch(/event_id\s+TEXT PRIMARY KEY/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS billing\.base_chain_state/i);
    expect(sql).toMatch(/known_roots\s+TEXT\[\]/i);
  });

  it('account wallet-link migration stays outside the spend plane', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0013_account_wallet_links.sql'), 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS billing\.account_wallet_links/i);
    expect(sql).toMatch(/account_id\s+TEXT PRIMARY KEY/i);
    expect(sql).toMatch(/wallet_address\s+TEXT NOT NULL UNIQUE/i);
    expect(sql).not.toMatch(/CREATE TABLE IF NOT EXISTS spend_plane/i);
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

  it('pilot invite migration keeps the control plane and provisioning plane unjoinable', () => {
    const invites = readFileSync(join(MIGRATIONS_DIR, '0015_pilot_invites.sql'), 'utf8');
    expect(invites).toMatch(/CREATE SCHEMA IF NOT EXISTS control_plane/i);
    expect(invites).toMatch(/CREATE SCHEMA IF NOT EXISTS pilot_provisioning/i);
    expect(invites).toMatch(/CREATE TABLE IF NOT EXISTS control_plane\.pilot_invites/i);
    expect(invites).toMatch(/CREATE TABLE IF NOT EXISTS pilot_provisioning\.funding_capabilities/i);

    // Codes and tokens exist only as SHA-256 digests.
    expect(invites).toMatch(/code_hash\s+TEXT NOT NULL UNIQUE CHECK \(code_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
    expect(invites).toMatch(/token_hash\s+TEXT NOT NULL UNIQUE CHECK \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/i);

    // Control plane holds no spend-plane data and provisioning holds no identity.
    const ddl = invites.replace(/--[^\n]*/gu, '');
    const inviteTable = ddl.slice(ddl.indexOf('control_plane.pilot_invites'), ddl.indexOf('pilot_provisioning.funding_capabilities'));
    expect(inviteTable).not.toMatch(/commitment|transaction_hash|nullifier|proof/i);
    const capabilityTable = ddl.slice(ddl.indexOf('pilot_provisioning.funding_capabilities'));
    expect(capabilityTable).not.toMatch(/github|account_id|invite_id|session|email/i);

    // One commitment funds once, and only a funded row carries a result.
    expect(capabilityTable).toMatch(/commitment\s+TEXT UNIQUE/i);
    expect(capabilityTable).toMatch(/state\s+TEXT NOT NULL DEFAULT 'issued' CHECK \(state IN \('issued', 'funding', 'funded', 'failed'\)\)/i);
    expect(capabilityTable).toMatch(/CHECK \(state <> 'funded' OR \(commitment IS NOT NULL AND bundle_expiry IS NOT NULL AND transaction_hash IS NOT NULL AND funded_at IS NOT NULL\)\)/i);
    // 30-minute detached capability, seven-day invite default are enforced in code.
    expect(invites).toMatch(/expires_at\s+TIMESTAMPTZ NOT NULL/i);
  });

  it('activation window migration holds no operator identity or spend-plane join', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0017_activation_windows.sql'), 'utf8');
    const ddl = sql.replace(/--[^\n]*/gu, '');
    expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS control_plane\.activation_windows/i);
    expect(ddl).toMatch(/slot\s+TEXT PRIMARY KEY CHECK \(slot IN \('A', 'B', 'C'\)\)/i);
    expect(ddl).toMatch(/evidence_digest\s+TEXT CHECK \(evidence_digest IS NULL OR evidence_digest ~ '\^\[0-9a-f\]\{64\}\$'\)/i);

    // The deterministic cohort assignment is a database constraint.
    expect(ddl).toMatch(/activation_windows_slot_assignment_check/i);
    expect(ddl).toMatch(/slot IN \('A', 'C'\) AND participant_type = 'coding_agent' AND integration_mode = 'openai_compatible_sidecar'/i);
    expect(ddl).toMatch(/slot = 'B' AND participant_type = 'x402_native_agent' AND integration_mode = 'x402_zk_prepaid_adapter'/i);

    // No identity, invite code, credential, or spend-plane column may exist.
    expect(ddl).not.toMatch(/github|account_id|email|login/i);
    expect(ddl).not.toMatch(/commitment|nullifier|request_signal|proof|credential_secret/i);
    expect(ddl).not.toMatch(/code_hash|token_hash|plaintext/i);
    // The only invite column is the opaque handle, never the redeemable code.
    expect(ddl).toMatch(/invite_id\s+TEXT NOT NULL/i);
    expect(ddl).not.toMatch(/invite_code/i);
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
    await pool.query('DROP SCHEMA IF EXISTS control_plane CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS pilot_provisioning CASCADE');
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
       WHERE schema_name IN ('gateway', 'billing', 'fee-sponsor', 'evaluation', 'spend_plane', 'control_plane', 'pilot_provisioning')`,
    );
    const names = res.rows.map((r) => r.schema_name).sort();
    expect(names).toEqual(['billing', 'control_plane', 'evaluation', 'fee-sponsor', 'gateway', 'pilot_provisioning', 'spend_plane']);
  });
});
