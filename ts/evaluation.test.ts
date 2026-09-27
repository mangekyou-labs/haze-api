import { describe, expect, it } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import {
  MemoryEvaluationStore,
  deriveParticipantIdentity,
  buildSep53PayloadDigest,
  verifyWalletProof,
  validateFeedback,
  redactWalletAddress,
  exportEvidence,
  RETENTION_MS,
} from './evaluation.js';

const SEP53_SEED = 'SAKICEVQLYWGSOJS4WW7HZJWAHZVEEBS527LHK5V4MLJALYKICQCJXMW';
const SEP53_MESSAGE = 'Hello, World!';
const SEP53_SIGNATURE =
  'fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==';

describe('evaluation identity', () => {
  it('derives a stable opaque participant identity and shortened public code', () => {
    const first = deriveParticipantIdentity('github-subject-42', 'evaluation-secret');
    const second = deriveParticipantIdentity('github-subject-42', 'evaluation-secret');

    expect(first.fullId).toBe(second.fullId);
    expect(first.fullId).toMatch(/^[a-f0-9]{64}$/);
    expect(first.publicCode).toMatch(/^L4-[a-f0-9]{12}$/);
    expect(first.publicCode).not.toContain('github');
    expect(deriveParticipantIdentity('github-subject-43', 'evaluation-secret').fullId)
      .not.toBe(first.fullId);
  });

  it('rejects non-string identity inputs at the boundary', () => {
    expect(() => deriveParticipantIdentity(null as never, 'evaluation-secret'))
      .toThrowError(/Authenticated subject is required/);
    expect(() => deriveParticipantIdentity('subject', null as never))
      .toThrowError(/EVALUATION_HMAC_SECRET is required/);
  });
});

describe('SEP-53 wallet proofs', () => {
  it('accepts the canonical SEP-53 test vector', () => {
    const keypair = Keypair.fromSecret(SEP53_SEED);

    expect(verifyWalletProof({
      address: keypair.publicKey(),
      message: SEP53_MESSAGE,
      signature: SEP53_SIGNATURE,
      network: 'testnet',
    })).toBe(true);
  });

  it('rejects a changed message, wallet, or network', () => {
    const keypair = Keypair.fromSecret(SEP53_SEED);
    const signature = keypair.sign(buildSep53PayloadDigest(SEP53_MESSAGE)).toString('base64');
    const proof = { address: keypair.publicKey(), message: SEP53_MESSAGE, signature, network: 'testnet' as const };

    expect(verifyWalletProof(proof)).toBe(true);
    expect(verifyWalletProof({ ...proof, message: 'different' })).toBe(false);
    expect(verifyWalletProof({ ...proof, address: Keypair.random().publicKey() })).toBe(false);
    expect(verifyWalletProof({ ...proof, network: 'mainnet' as const })).toBe(false);
    expect(verifyWalletProof({ ...proof, signature: {} as never })).toBe(false);
  });
});

describe('evaluation enrollment and evidence', () => {
  it('expires a challenge and prevents replay after one successful proof', async () => {
    let now = 1_700_000_000_000;
    const store = new MemoryEvaluationStore({ now: () => now });
    const participant = deriveParticipantIdentity('subject-1', 'secret');
    await store.enroll(participant.fullId, '2026-09-11');
    const challenge = await store.createChallenge(participant.fullId);
    const keypair = Keypair.random();
    const signature = keypair.sign(buildSep53PayloadDigest(challenge.message)).toString('base64');

    expect(verifyWalletProof({
      address: keypair.publicKey(),
      message: challenge.message,
      signature,
      network: 'testnet',
    })).toBe(true);

    await expect(store.verifyWallet(participant.fullId, {
      challengeId: challenge.id,
      address: keypair.publicKey(),
      signature,
      network: 'testnet',
    })).resolves.toMatchObject({ verified: true });

    await expect(store.verifyWallet(participant.fullId, {
      challengeId: challenge.id,
      address: keypair.publicKey(),
      signature,
      network: 'testnet',
    })).rejects.toMatchObject({ code: 'challenge_replayed' });

    const expired = await store.createChallenge(participant.fullId);
    now += 10 * 60 * 1000 + 1;
    await expect(store.verifyWallet(participant.fullId, {
      challengeId: expired.id,
      address: Keypair.random().publicKey(),
      signature,
      network: 'testnet',
    })).rejects.toMatchObject({ code: 'challenge_expired' });
  });

  it('rejects duplicate wallets and invalid feedback fields', async () => {
    const store = new MemoryEvaluationStore();
    const first = deriveParticipantIdentity('subject-1', 'secret');
    const second = deriveParticipantIdentity('subject-2', 'secret');
    await store.enroll(first.fullId, '2026-09-11');
    await store.enroll(second.fullId, '2026-09-11');
    const keypair = Keypair.random();
    const challenge = await store.createChallenge(first.fullId);
    const signature = keypair.sign(buildSep53PayloadDigest(challenge.message)).toString('base64');
    await store.verifyWallet(first.fullId, {
      challengeId: challenge.id,
      address: keypair.publicKey(),
      signature,
      network: 'testnet',
    });

    const secondChallenge = await store.createChallenge(second.fullId);
    const secondSignature = keypair.sign(buildSep53PayloadDigest(secondChallenge.message)).toString('base64');
    await expect(store.verifyWallet(second.fullId, {
      challengeId: secondChallenge.id,
      address: keypair.publicKey(),
      signature: secondSignature,
      network: 'testnet',
    })).rejects.toMatchObject({ code: 'wallet_already_used' });

    expect(validateFeedback({
      easeRating: 6,
      taskCompleted: true,
      wouldUseAgain: true,
      mostValuableAspect: 'x',
      biggestFriction: 'y',
      quoteConsent: false,
    })).toMatchObject({ ok: false, code: 'invalid_ease_rating' });
    expect(validateFeedback(null as never)).toMatchObject({ ok: false, code: 'invalid_ease_rating' });
  });

  it('publishes only redacted evidence and enforces ten completed participants', async () => {
    const store = new MemoryEvaluationStore();
    await expect(exportEvidence(store)).rejects.toMatchObject({ code: 'minimum_participants' });

    for (let i = 0; i < 10; i += 1) {
      const identity = deriveParticipantIdentity(`subject-${i}`, 'secret');
      await store.enroll(identity.fullId, '2026-09-11');
      const keypair = Keypair.random();
      const challenge = await store.createChallenge(identity.fullId);
      const signature = keypair.sign(buildSep53PayloadDigest(challenge.message)).toString('base64');
      await store.verifyWallet(identity.fullId, {
        challengeId: challenge.id,
        address: keypair.publicKey(),
        signature,
        network: 'testnet',
      });
      await store.linkDeposit(identity.fullId, i.toString(16).padStart(64, '0'));
      await store.submitFeedback(identity.fullId, {
        easeRating: 5,
        taskCompleted: true,
        wouldUseAgain: true,
        mostValuableAspect: 'private API access',
        biggestFriction: 'cold start',
        quoteConsent: false,
      });
    }

    const evidence = await exportEvidence(store);
    expect(evidence.participants).toHaveLength(10);
    expect(evidence.participants[0]).toMatchObject({
      participantCode: expect.stringMatching(/^L4-/),
      walletAddress: expect.stringMatching(/^G...[…]/),
      transactionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(evidence)).not.toContain('signature');
    expect(JSON.stringify(evidence)).not.toContain('subject-');
    expect(redactWalletAddress(Keypair.fromSecret(SEP53_SEED).publicKey())).toMatch(/^G...[…]/);
  });

  it('makes checkout receipt processing idempotent and ownership-bound', async () => {
    const store = new MemoryEvaluationStore();
    const first = deriveParticipantIdentity('checkout-subject-1', 'secret');
    const second = deriveParticipantIdentity('checkout-subject-2', 'secret');
    await store.enroll(first.fullId, '2026-09-11');
    await store.enroll(second.fullId, '2026-09-11');

    const initial = await store.recordCheckout(first.fullId, {
      checkoutSessionId: 'cs_level4_idempotent',
      amountCents: 100,
      eventId: 'evt_first',
    });
    const duplicate = await store.recordCheckout(first.fullId, {
      checkoutSessionId: 'cs_level4_idempotent',
      amountCents: 100,
      eventId: 'evt_duplicate',
    });
    expect(duplicate).toEqual(initial);

    await expect(store.recordCheckout(second.fullId, {
      checkoutSessionId: 'cs_level4_idempotent',
      amountCents: 100,
    })).rejects.toMatchObject({ code: 'checkout_already_used' });

    const transactionHash = 'a'.repeat(64);
    const confirmed = await store.markCheckout(first.fullId, 'cs_level4_idempotent', {
      status: 'confirmed',
      transactionHash,
      newRoot: 'root-1',
    });
    expect(confirmed).toMatchObject({
      processingStatus: 'confirmed',
      transactionHash,
      newRoot: 'root-1',
    });
    await expect(store.getCheckout(second.fullId, 'cs_level4_idempotent'))
      .rejects.toMatchObject({ code: 'checkout_not_found' });
  });

  it('rate-limits challenges and purges restricted proof material after retention', async () => {
    let now = 1_700_000_000_000;
    const store = new MemoryEvaluationStore({ now: () => now });
    const participant = deriveParticipantIdentity('retention-subject', 'secret');
    await store.enroll(participant.fullId, '2026-09-11');
    for (let index = 0; index < 5; index += 1) await store.createChallenge(participant.fullId);
    await expect(store.createChallenge(participant.fullId)).rejects.toMatchObject({ code: 'rate_limited' });

    const keypair = Keypair.random();
    const later = new MemoryEvaluationStore({ now: () => now });
    await later.enroll(participant.fullId, '2026-09-11');
    const challenge = await later.createChallenge(participant.fullId);
    const signature = keypair.sign(buildSep53PayloadDigest(challenge.message)).toString('base64');
    await later.verifyWallet(participant.fullId, {
      challengeId: challenge.id,
      address: keypair.publicKey(),
      signature,
      network: 'testnet',
    });
    const before = await later.listRestrictedRecords();
    expect(before[0].walletSignature).toBe(signature);

    now += RETENTION_MS + 1;
    expect(await later.purgeExpired()).toBe(1);
    const after = await later.listRestrictedRecords();
    expect(after[0]).toMatchObject({
      walletAddress: null,
      walletSignature: null,
      anonymizedAtMs: now,
    });
  });
});
