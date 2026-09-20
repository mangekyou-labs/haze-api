/**
 * Postgres integration for the pilot planes: single-use invites, detached
 * capabilities, and idempotent funding against the real schema and its
 * uniqueness constraints.
 *
 * Opt-in via RUN_DB_TESTS=1 so the default suite stays green without a DB.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { runMigrations } from './db/migrate.js';
import { PostgresInviteStore, PilotInviteService } from './pilot-invites.js';
import { PilotFundingService, PostgresFundingCapabilityStore, hashFundingToken } from './pilot-funding.js';

const MIGRATIONS_DIR = resolve(import.meta.dirname, 'db', 'migrations');
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/zk_credits_test';
const ADMIN_DATABASE_URL = process.env.TEST_ADMIN_DATABASE_URL || 'postgres://localhost:5432/postgres';
// Shares the advisory lock used by the other Postgres integration files so the
// migration-reset test in db/migrate.test.ts cannot drop these schemas mid-run.
const DB_TEST_LOCK = 8_402_062_006;
const CONTRACT = '0x0000000000000000000000000000000000000001';
const COMMITMENT = '8687213900595150509063186631634067671233157784124627437219499552928422827997';
const OTHER_COMMITMENT = '12992319314469106065811618978512789981623859879058485908347559722389823331150';
const GITHUB_ID = '4242';

const dbTestsEnabled = process.env.RUN_DB_TESTS === '1';

describe.skipIf(!dbTestsEnabled)('pilot planes (integration, requires Postgres)', () => {
  let pool: Pool;
  let lockClient: Awaited<ReturnType<Pool['connect']>>;
  let invites: PilotInviteService;
  let funding: PilotFundingService;
  let sponsorCalls: string[] = [];
  let sponsorFails = false;

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
    await pool.query('TRUNCATE control_plane.pilot_invites');
    await pool.query('TRUNCATE pilot_provisioning.funding_capabilities');

    funding = new PilotFundingService({
      store: new PostgresFundingCapabilityStore(pool),
      contractAddress: CONTRACT,
      deploymentDomain: '84532',
      sponsor: {
        async fundCommitment(commitment: string) {
          if (sponsorFails) throw new Error('sponsor_unavailable');
          sponsorCalls.push(commitment);
          return { transactionHash: '0xtx', expiryAt: Date.now() + 1000 };
        },
      },
    });
    invites = new PilotInviteService({
      store: new PostgresInviteStore(pool),
      capabilities: { issue: () => funding.issueCapability() },
    });
  });

  afterAll(async () => {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [DB_TEST_LOCK]);
    lockClient.release();
    await pool.end();
  });

  it('stores only digests and keeps the planes unjoinable', async () => {
    const issued = await invites.issue({ githubAccountId: GITHUB_ID });
    const rows = await pool.query('SELECT * FROM control_plane.pilot_invites');
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].code_hash).toHaveLength(64);
    expect(rows.rows[0].code_hash).not.toBe(issued.code);
    expect(Object.keys(rows.rows[0])).not.toContain('commitment');

    const redeemed = await invites.redeem({ code: issued.code, githubAccountId: GITHUB_ID });
    const capabilities = await pool.query('SELECT * FROM pilot_provisioning.funding_capabilities');
    expect(capabilities.rowCount).toBe(1);
    expect(capabilities.rows[0].token_hash).toBe(hashFundingToken(redeemed.fundingToken));
    expect(Object.keys(capabilities.rows[0])).not.toContain('github_account_id');
    expect(Object.keys(capabilities.rows[0])).not.toContain('invite_id');
  });

  it('enforces one redemption across processes and one commitment per capability', async () => {
    const issued = await invites.issue({ githubAccountId: GITHUB_ID });
    const attempts = await Promise.allSettled([
      invites.redeem({ code: issued.code, githubAccountId: GITHUB_ID }),
      invites.redeem({ code: issued.code, githubAccountId: GITHUB_ID }),
      invites.redeem({ code: issued.code, githubAccountId: GITHUB_ID }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    const token = (attempts.find((attempt) => attempt.status === 'fulfilled') as PromiseFulfilledResult<{ fundingToken: string }>).value.fundingToken;

    sponsorCalls = [];
    const funded = await funding.fund({ fundingToken: token, commitment: COMMITMENT });
    expect(sponsorCalls).toEqual([COMMITMENT]);
    expect(funded.tierId).toBe(0);

    const retry = await funding.fund({ fundingToken: token, commitment: COMMITMENT });
    expect(retry).toEqual(funded);
    expect(sponsorCalls).toEqual([COMMITMENT]);

    await expect(funding.fund({ fundingToken: token, commitment: OTHER_COMMITMENT })).rejects.toThrow('funding_commitment_conflict');
    expect(sponsorCalls).toEqual([COMMITMENT]);

    const bundle = await funding.lookupByCommitment(COMMITMENT);
    expect(bundle).toMatchObject({ commitment: COMMITMENT, tierId: 0, transactionHash: '0xtx' });
  });

  it('leases a concurrent funding attempt and recovers a failed sponsorship', async () => {
    const issued = await invites.issue({ githubAccountId: GITHUB_ID });
    const { fundingToken } = await invites.redeem({ code: issued.code, githubAccountId: GITHUB_ID });

    sponsorCalls = [];
    sponsorFails = true;
    await expect(funding.fund({ fundingToken, commitment: OTHER_COMMITMENT })).rejects.toThrow('funding_unavailable');
    const failed = await pool.query('SELECT state, commitment, failure_reason FROM pilot_provisioning.funding_capabilities WHERE token_hash = $1', [hashFundingToken(fundingToken)]);
    expect(failed.rows[0]).toMatchObject({ state: 'failed', commitment: OTHER_COMMITMENT, failure_reason: 'sponsor_unavailable' });

    sponsorFails = false;
    const recovered = await funding.fund({ fundingToken, commitment: OTHER_COMMITMENT });
    expect(recovered.transactionHash).toBe('0xtx');
    expect(sponsorCalls).toEqual([OTHER_COMMITMENT]);
  });

  it('never accepts a revoked or expired code after the fact', async () => {
    const revoked = await invites.issue({ githubAccountId: GITHUB_ID });
    expect(await invites.revoke(revoked.inviteId)).toBe(true);
    await expect(invites.redeem({ code: revoked.code, githubAccountId: GITHUB_ID })).rejects.toThrow('invite_revoked');

    // Expiry is enforced by the SQL claim, not just the in-memory check.
    let clock = Date.now();
    const timed = new PilotInviteService({
      store: new PostgresInviteStore(pool),
      capabilities: { issue: () => funding.issueCapability() },
      now: () => clock,
    });
    const expiring = await timed.issue({ githubAccountId: GITHUB_ID, ttlMs: 1000 });
    clock += 2000;
    await expect(timed.redeem({ code: expiring.code, githubAccountId: GITHUB_ID })).rejects.toThrow('invite_expired');
    expect((await timed.inspect(expiring.inviteId))?.state).toBe('expired');

    await expect(timed.issue({ githubAccountId: GITHUB_ID, ttlMs: 0 })).rejects.toThrow('invalid_invite_ttl');
  });
});
