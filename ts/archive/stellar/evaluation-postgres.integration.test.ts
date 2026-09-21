import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { Pool } from 'pg';
import { runMigrations } from './db/migrate.js';
import {
  EVALUATION_CONSENT_VERSION,
  RETENTION_MS,
  buildSep53PayloadDigest,
  deriveParticipantIdentity,
} from './evaluation.js';
import { PostgresEvaluationStore, type SqlPool } from './evaluation-postgres.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/zk_credits_test';
const MIGRATIONS_DIR = new URL('./db/migrations', import.meta.url).pathname;
const dbTestsEnabled = process.env.RUN_DB_TESTS === '1';

describe.skipIf(!dbTestsEnabled)('PostgresEvaluationStore (integration, requires disposable Postgres)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await pool.query('DROP SCHEMA IF EXISTS evaluation CASCADE');
    await pool.query('CREATE TABLE IF NOT EXISTS public.schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    await pool.query("DELETE FROM public.schema_migrations WHERE filename = '0009_evaluation.sql'");
  });

  afterAll(async () => {
    await pool.end();
  });

  it('runs migration 0009 once and makes the second run a no-op', async () => {
    const first = await runMigrations(pool, MIGRATIONS_DIR);
    expect(first.applied).toContain('0009_evaluation.sql');

    const second = await runMigrations(pool, MIGRATIONS_DIR);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toContain('0009_evaluation.sql');
  });

  it('persists proofs and status across store instances', async () => {
    const participant = deriveParticipantIdentity('postgres-evaluation-subject', 'secret');
    const store1 = new PostgresEvaluationStore(pool, { id: () => 'challenge-postgres-1' });
    const store2 = new PostgresEvaluationStore(pool);
    await store1.enroll(participant.fullId, EVALUATION_CONSENT_VERSION);
    const challenge = await store1.createChallenge(participant.fullId);
    const keypair = Keypair.random();
    const signature = keypair.sign(buildSep53PayloadDigest(challenge.message)).toString('base64');

    await expect(store2.verifyWallet(participant.fullId, {
      challengeId: challenge.id,
      address: keypair.publicKey(),
      signature,
      network: 'testnet',
    })).resolves.toMatchObject({ verified: true });
    await expect(store2.linkDeposit(participant.fullId, 'b'.repeat(64)))
      .resolves.toMatchObject({ deposit: { confirmed: true, transactionHash: 'b'.repeat(64) } });
    await expect(store2.submitFeedback(participant.fullId, {
      easeRating: 4,
      taskCompleted: true,
      wouldUseAgain: true,
      mostValuableAspect: 'durable state',
      biggestFriction: 'none',
      quoteConsent: false,
    })).resolves.toMatchObject({ complete: true });

    await expect(store1.getStatus(participant.fullId)).resolves.toMatchObject({
      wallet: { verified: true },
      deposit: { transactionHash: 'b'.repeat(64) },
      feedbackSubmitted: true,
      complete: true,
    });
  });

  it('does not replace a wallet or deposit under concurrent requests', async () => {
    const participant = deriveParticipantIdentity('postgres-ownership-race', 'secret');
    const store1 = new PostgresEvaluationStore(pool, { id: () => 'challenge-ownership-1' });
    const store2 = new PostgresEvaluationStore(pool, { id: () => 'challenge-ownership-2' });
    await store1.enroll(participant.fullId, EVALUATION_CONSENT_VERSION);

    const wallet1 = Keypair.random();
    const wallet2 = Keypair.random();
    const challenge1 = await store1.createChallenge(participant.fullId);
    const challenge2 = await store2.createChallenge(participant.fullId);
    const proof1 = {
      challengeId: challenge1.id,
      address: wallet1.publicKey(),
      signature: wallet1.sign(buildSep53PayloadDigest(challenge1.message)).toString('base64'),
      network: 'testnet' as const,
    };
    const proof2 = {
      challengeId: challenge2.id,
      address: wallet2.publicKey(),
      signature: wallet2.sign(buildSep53PayloadDigest(challenge2.message)).toString('base64'),
      network: 'testnet' as const,
    };

    const walletResults = await Promise.allSettled([
      store1.verifyWallet(participant.fullId, proof1),
      store2.verifyWallet(participant.fullId, proof2),
    ]);
    expect(walletResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(walletResults.filter((result) => result.status === 'rejected'))
      .toEqual([expect.objectContaining({ reason: expect.objectContaining({ code: 'wallet_already_used' }) })]);

    const depositResults = await Promise.allSettled([
      store1.linkDeposit(participant.fullId, 'c'.repeat(64)),
      store2.linkDeposit(participant.fullId, 'd'.repeat(64)),
    ]);
    expect(depositResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(depositResults.filter((result) => result.status === 'rejected'))
      .toEqual([expect.objectContaining({ reason: expect.objectContaining({ code: 'deposit_already_used' }) })]);
  });

  it('makes concurrent same-session checkout inserts ownership-safe', async () => {
    const participant = deriveParticipantIdentity('postgres-checkout-subject', 'secret');
    const other = deriveParticipantIdentity('postgres-checkout-other', 'secret');
    const store1 = new PostgresEvaluationStore(pool);
    const store2 = new PostgresEvaluationStore(pool);
    await store1.enroll(participant.fullId, EVALUATION_CONSENT_VERSION);
    await store1.enroll(other.fullId, EVALUATION_CONSENT_VERSION);

    const results = await Promise.all([
      store1.recordCheckout(participant.fullId, {
        checkoutSessionId: 'cs_postgres_concurrent',
        amountCents: 100,
        eventId: 'evt_postgres_1',
      }),
      store2.recordCheckout(participant.fullId, {
        checkoutSessionId: 'cs_postgres_concurrent',
        amountCents: 100,
        eventId: 'evt_postgres_2',
      }),
    ]);
    expect(results[0]).toMatchObject({ checkoutSessionId: 'cs_postgres_concurrent', amountCents: 100 });
    expect(results[1]).toEqual(results[0]);
    await expect(store1.recordCheckout(other.fullId, {
      checkoutSessionId: 'cs_postgres_concurrent',
      amountCents: 100,
    })).rejects.toMatchObject({ code: 'checkout_already_used' });
  });

  it('claims a checkout once across stores and reclaims it after failure', async () => {
    const participant = deriveParticipantIdentity('postgres-checkout-claim-subject', 'secret');
    const store1 = new PostgresEvaluationStore(pool);
    const store2 = new PostgresEvaluationStore(pool);
    await store1.enroll(participant.fullId, EVALUATION_CONSENT_VERSION);
    await store1.recordCheckout(participant.fullId, {
      checkoutSessionId: 'cs_postgres_claim',
      amountCents: 100,
      eventId: 'evt_postgres_claim',
    });

    const claims = await Promise.all([
      store1.claimCheckout(participant.fullId, 'cs_postgres_claim'),
      store2.claimCheckout(participant.fullId, 'cs_postgres_claim'),
    ]);
    expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
    expect(claims.filter((claim) => !claim.claimed)).toHaveLength(1);
    expect(claims.find((claim) => !claim.claimed)?.receipt.processingStatus).toBe('processing');

    await store1.markCheckout(participant.fullId, 'cs_postgres_claim', { status: 'failed' });
    await expect(store2.claimCheckout(participant.fullId, 'cs_postgres_claim')).resolves.toMatchObject({
      claimed: true,
      receipt: { processingStatus: 'processing' },
    });
  });

  it('never lets a stale checkout worker downgrade a confirmed receipt', async () => {
    const participant = deriveParticipantIdentity('postgres-checkout-monotonic', 'secret');
    const store = new PostgresEvaluationStore(pool);
    await store.enroll(participant.fullId, EVALUATION_CONSENT_VERSION);
    await store.recordCheckout(participant.fullId, {
      checkoutSessionId: 'cs_postgres_monotonic',
      amountCents: 100,
      eventId: 'evt_postgres_monotonic',
    });

    let releaseUpdate!: () => void;
    let signalUpdate!: () => void;
    const updateReleased = new Promise<void>((resolve) => { releaseUpdate = resolve; });
    const updateStarted = new Promise<void>((resolve) => { signalUpdate = resolve; });
    const delayedPool: SqlPool = {
      connect: () => pool.connect(),
      async query<Row extends Record<string, unknown> = Record<string, unknown>>(
        text: string,
        values?: readonly unknown[],
      ) {
        if (/UPDATE evaluation\.checkout_receipts[\s\S]*SET processing_status = \$1/.test(text)
          && values?.[0] === 'failed') {
          signalUpdate();
          await updateReleased;
        }
        return pool.query<Row>(text, values as unknown[] | undefined);
      },
    };
    const staleStore = new PostgresEvaluationStore(delayedPool);
    const staleFailure = staleStore.markCheckout(participant.fullId, 'cs_postgres_monotonic', {
      status: 'failed',
    });
    await updateStarted;
    await store.markCheckout(participant.fullId, 'cs_postgres_monotonic', {
      status: 'confirmed',
      transactionHash: 'f'.repeat(64),
    });
    releaseUpdate();

    await expect(staleFailure).resolves.toMatchObject({ processingStatus: 'confirmed' });
    await expect(store.getCheckout(participant.fullId, 'cs_postgres_monotonic')).resolves.toMatchObject({
      processingStatus: 'confirmed',
      transactionHash: 'f'.repeat(64),
    });
  });

  it('retains completion and wallet ownership after raw proof purge', async () => {
    let now = 1_700_000_000_000;
    let challengeSequence = 0;
    const store = new PostgresEvaluationStore(pool, {
      now: () => now,
      id: () => `challenge-retention-${challengeSequence += 1}`,
    });
    const first = deriveParticipantIdentity('postgres-retention-owner-1', 'secret');
    const second = deriveParticipantIdentity('postgres-retention-owner-2', 'secret');
    await store.enroll(first.fullId, EVALUATION_CONSENT_VERSION);
    await store.enroll(second.fullId, EVALUATION_CONSENT_VERSION);

    const wallet = Keypair.random();
    const challenge = await store.createChallenge(first.fullId);
    await store.verifyWallet(first.fullId, {
      challengeId: challenge.id,
      address: wallet.publicKey(),
      signature: wallet.sign(buildSep53PayloadDigest(challenge.message)).toString('base64'),
      network: 'testnet',
    });
    await store.linkDeposit(first.fullId, '9'.repeat(64));
    await store.submitFeedback(first.fullId, {
      easeRating: 5,
      taskCompleted: true,
      wouldUseAgain: true,
      mostValuableAspect: 'privacy',
      biggestFriction: 'none',
      quoteConsent: false,
    });

    now += RETENTION_MS + 1;
    await store.purgeExpired();
    await expect(store.getStatus(first.fullId)).resolves.toMatchObject({
      wallet: { verified: true, addressRedacted: null },
      complete: true,
    });

    const repeatChallenge = await store.createChallenge(first.fullId);
    await expect(store.verifyWallet(first.fullId, {
      challengeId: repeatChallenge.id,
      address: wallet.publicKey(),
      signature: wallet.sign(buildSep53PayloadDigest(repeatChallenge.message)).toString('base64'),
      network: 'testnet',
    })).resolves.toMatchObject({ verified: true });
    const restricted = await store.listRestrictedRecords();
    expect(restricted.find((record) => record.participantId === first.fullId)).toMatchObject({
      walletAddress: null,
      walletSignature: null,
      anonymizedAtMs: now,
    });

    const duplicateChallenge = await store.createChallenge(second.fullId);
    await expect(store.verifyWallet(second.fullId, {
      challengeId: duplicateChallenge.id,
      address: wallet.publicKey(),
      signature: wallet.sign(buildSep53PayloadDigest(duplicateChallenge.message)).toString('base64'),
      network: 'testnet',
    })).rejects.toMatchObject({ code: 'wallet_already_used' });
  });

  it('enforces the rolling challenge limit under concurrent requests', async () => {
    const participant = deriveParticipantIdentity('postgres-challenge-rate-race', 'secret');
    const store = new PostgresEvaluationStore(pool);
    await store.enroll(participant.fullId, EVALUATION_CONSENT_VERSION);

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => store.createChallenge(participant.fullId)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(5);
    expect(results.filter((result) => result.status === 'rejected'))
      .toEqual([expect.objectContaining({ reason: expect.objectContaining({ code: 'rate_limited' }) })]);
  });
});
