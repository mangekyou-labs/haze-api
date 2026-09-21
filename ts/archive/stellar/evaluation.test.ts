import { describe, expect, it } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import {
  CHALLENGE_TTL_MS,
  EVALUATION_CONSENT_VERSION,
  RETENTION_MS,
  MemoryEvaluationStore,
  buildSep53PayloadDigest,
  deriveParticipantIdentity,
  exportEvidence,
  redactWalletAddress,
  validateFeedback,
  verifyWalletProof,
} from './evaluation.js';

const SEP53_SEED = 'SAKICEVQLYWGSOJS4WW7HZJWAHZVEEBS527LHK5V4MLJALYKICQCJXMW';
const SEP53_MESSAGE = 'Hello, World!';
const SEP53_SIGNATURE =
  'fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==';

function makeFeedback() {
  return {
    easeRating: 5,
    taskCompleted: true,
    wouldUseAgain: true,
    mostValuableAspect: 'private API access',
    biggestFriction: 'cold start',
    quoteConsent: false,
  };
}

async function completeParticipant(store: MemoryEvaluationStore, subject: string, index: number) {
  const participant = deriveParticipantIdentity(subject, 'evaluation-secret');
  await store.enroll(participant.fullId, EVALUATION_CONSENT_VERSION);
  const keypair = Keypair.random();
  const challenge = await store.createChallenge(participant.fullId);
  const signature = keypair.sign(buildSep53PayloadDigest(challenge.message)).toString('base64');
  await store.verifyWallet(participant.fullId, {
    challengeId: challenge.id,
    address: keypair.publicKey(),
    signature,
    network: 'testnet',
  });
  await store.linkDeposit(participant.fullId, index.toString(16).padStart(64, '0'));
  await store.submitFeedback(participant.fullId, makeFeedback());
}

describe('evaluation identity', () => {
  it('derives a stable opaque participant identity and shortened public code', () => {
    const first = deriveParticipantIdentity('github-subject-42', 'evaluation-secret');
    const second = deriveParticipantIdentity('github-subject-42', 'evaluation-secret');

    expect(first).toEqual(second);
    expect(first.fullId).toMatch(/^[a-f0-9]{64}$/);
    expect(first.publicCode).toMatch(/^L4-[a-f0-9]{12}$/);
    expect(first.publicCode).not.toContain('github');
    expect(deriveParticipantIdentity('github-subject-43', 'evaluation-secret').fullId)
      .not.toBe(first.fullId);
  });

  it('rejects missing identity inputs at the boundary', () => {
    expect(() => deriveParticipantIdentity(null as never, 'evaluation-secret'))
      .toThrowError(/Authenticated subject is required/);
    expect(() => deriveParticipantIdentity('subject', null as never))
      .toThrowError(/EVALUATION_HMAC_SECRET is required/);
  });
});

describe('SEP-53 wallet proofs', () => {
  it('accepts the canonical testnet test vector', () => {
    const keypair = Keypair.fromSecret(SEP53_SEED);

    expect(verifyWalletProof({
      address: keypair.publicKey(),
      message: SEP53_MESSAGE,
      signature: SEP53_SIGNATURE,
      network: 'testnet',
    })).toBe(true);
  });

  it('rejects changed messages, wallets, networks, and non-canonical signatures', () => {
    const keypair = Keypair.fromSecret(SEP53_SEED);
    const signature = keypair.sign(buildSep53PayloadDigest(SEP53_MESSAGE)).toString('base64');
    const proof = { address: keypair.publicKey(), message: SEP53_MESSAGE, signature, network: 'testnet' as const };

    expect(verifyWalletProof(proof)).toBe(true);
    expect(verifyWalletProof({ ...proof, message: 'different' })).toBe(false);
    expect(verifyWalletProof({ ...proof, address: Keypair.random().publicKey() })).toBe(false);
    expect(verifyWalletProof({ ...proof, network: 'mainnet' as const })).toBe(false);
    expect(verifyWalletProof({ ...proof, signature: `${signature} ` })).toBe(false);
  });
});

describe('evaluation enrollment and retention', () => {
  it('enforces the exact consent version and stable enrollment', async () => {
    const store = new MemoryEvaluationStore();
    const participant = deriveParticipantIdentity('subject-consent', 'secret');

    await expect(store.enroll(participant.fullId, '2026-09-11'))
      .rejects.toMatchObject({ code: 'invalid_consent_version' });
    await expect(store.enroll(participant.fullId, EVALUATION_CONSENT_VERSION))
      .resolves.toMatchObject({ participantCode: participant.publicCode });
    await expect(store.enroll(participant.fullId, EVALUATION_CONSENT_VERSION))
      .resolves.toMatchObject({ participantCode: participant.publicCode });
    await expect(store.enroll(participant.fullId, 'level4-other'))
      .rejects.toMatchObject({ code: 'invalid_consent_version' });
  });

  it('expires a challenge and prevents replay after one successful proof', async () => {
    let now = 1_700_000_000_000;
    const store = new MemoryEvaluationStore({ now: () => now });
    const participant = deriveParticipantIdentity('subject-1', 'secret');
    await store.enroll(participant.fullId, EVALUATION_CONSENT_VERSION);
    const challenge = await store.createChallenge(participant.fullId);
    const keypair = Keypair.random();
    const signature = keypair.sign(buildSep53PayloadDigest(challenge.message)).toString('base64');

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
    now += CHALLENGE_TTL_MS + 1;
    await expect(store.verifyWallet(participant.fullId, {
      challengeId: expired.id,
      address: Keypair.random().publicKey(),
      signature,
      network: 'testnet',
    })).rejects.toMatchObject({ code: 'challenge_expired' });
  });

  it('limits challenges to five attempts per fifteen-minute window', async () => {
    let now = 1_700_000_000_000;
    const store = new MemoryEvaluationStore({ now: () => now });
    const participant = deriveParticipantIdentity('rate-subject', 'secret');
    await store.enroll(participant.fullId, EVALUATION_CONSENT_VERSION);

    for (let index = 0; index < 5; index += 1) await store.createChallenge(participant.fullId);
    await expect(store.createChallenge(participant.fullId)).rejects.toMatchObject({ code: 'rate_limited' });
    now += 15 * 60 * 1000 + 1;
    await expect(store.createChallenge(participant.fullId)).resolves.toBeDefined();
  });

  it('rejects duplicate wallets and requires a verified wallet before deposits', async () => {
    const store = new MemoryEvaluationStore();
    const first = deriveParticipantIdentity('subject-1', 'secret');
    const second = deriveParticipantIdentity('subject-2', 'secret');
    await store.enroll(first.fullId, EVALUATION_CONSENT_VERSION);
    await store.enroll(second.fullId, EVALUATION_CONSENT_VERSION);
    const keypair = Keypair.random();
    const challenge = await store.createChallenge(first.fullId);
    const signature = keypair.sign(buildSep53PayloadDigest(challenge.message)).toString('base64');

    await expect(store.linkDeposit(first.fullId, 'a'.repeat(64)))
      .rejects.toMatchObject({ code: 'wallet_not_verified' });
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
  });
});

describe('evaluation feedback, checkout, and evidence', () => {
  it('validates feedback without accepting sensitive or unbounded input', () => {
    expect(validateFeedback({ ...makeFeedback(), easeRating: 6 }))
      .toMatchObject({ ok: false, code: 'invalid_ease_rating' });
    expect(validateFeedback({ ...makeFeedback(), biggestFriction: 'x'.repeat(1_001) }))
      .toMatchObject({ ok: false, code: 'invalid_feedback_text' });
    expect(validateFeedback(null as never)).toMatchObject({ ok: false });
  });

  it('makes checkout ownership and receipt processing idempotent', async () => {
    const store = new MemoryEvaluationStore();
    const first = deriveParticipantIdentity('checkout-subject-1', 'secret');
    const second = deriveParticipantIdentity('checkout-subject-2', 'secret');
    await store.enroll(first.fullId, EVALUATION_CONSENT_VERSION);
    await store.enroll(second.fullId, EVALUATION_CONSENT_VERSION);

    const initial = await store.recordCheckout(first.fullId, {
      checkoutSessionId: 'cs_level4_idempotent',
      amountCents: 100,
      eventId: 'evt_first',
    });
    await expect(store.recordCheckout(first.fullId, {
      checkoutSessionId: 'cs_level4_idempotent',
      amountCents: 100,
      eventId: 'evt_duplicate',
    })).resolves.toEqual(initial);
    await expect(store.recordCheckout(second.fullId, {
      checkoutSessionId: 'cs_level4_idempotent',
      amountCents: 100,
    })).rejects.toMatchObject({ code: 'checkout_already_used' });

    const transactionHash = 'a'.repeat(64);
    await expect(store.markCheckout(first.fullId, 'cs_level4_idempotent', {
      status: 'confirmed',
      transactionHash,
      newRoot: 'root-1',
    })).resolves.toMatchObject({ processingStatus: 'confirmed', transactionHash, newRoot: 'root-1' });
    await expect(store.getCheckout(second.fullId, 'cs_level4_idempotent'))
      .rejects.toMatchObject({ code: 'checkout_not_found' });
  });

  it('claims a checkout exactly once and allows a failed claim to resume', async () => {
    const store = new MemoryEvaluationStore();
    const participant = deriveParticipantIdentity('checkout-claim-subject', 'secret');
    await store.enroll(participant.fullId, EVALUATION_CONSENT_VERSION);
    await store.recordCheckout(participant.fullId, {
      checkoutSessionId: 'cs_level4_claim',
      amountCents: 100,
      eventId: 'evt_claim',
    });

    const claims = await Promise.all([
      store.claimCheckout(participant.fullId, 'cs_level4_claim'),
      store.claimCheckout(participant.fullId, 'cs_level4_claim'),
    ]);
    expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
    expect(claims.filter((claim) => !claim.claimed)[0].receipt.processingStatus).toBe('processing');

    await store.markCheckout(participant.fullId, 'cs_level4_claim', { status: 'failed' });
    const retry = await store.claimCheckout(participant.fullId, 'cs_level4_claim');
    expect(retry.claimed).toBe(true);
    expect(retry.receipt.processingStatus).toBe('processing');
  });

  it('publishes only redacted evidence and enforces ten completed participants', async () => {
    const store = new MemoryEvaluationStore();
    await expect(exportEvidence(store)).rejects.toMatchObject({ code: 'minimum_participants' });

    for (let index = 0; index < 10; index += 1) {
      await completeParticipant(store, `subject-${index}`, index);
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

  it('purges wallet and signature material after ninety days', async () => {
    let now = 1_700_000_000_000;
    const store = new MemoryEvaluationStore({ now: () => now });
    const participant = deriveParticipantIdentity('retention-subject', 'secret');
    await store.enroll(participant.fullId, EVALUATION_CONSENT_VERSION);
    const keypair = Keypair.random();
    const challenge = await store.createChallenge(participant.fullId);
    const signature = keypair.sign(buildSep53PayloadDigest(challenge.message)).toString('base64');
    await store.verifyWallet(participant.fullId, {
      challengeId: challenge.id,
      address: keypair.publicKey(),
      signature,
      network: 'testnet',
    });
    expect((await store.listRestrictedRecords())[0].walletSignature).toBe(signature);

    now += RETENTION_MS + 1;
    await expect(store.purgeExpired()).resolves.toBe(1);
    await expect(store.listRestrictedRecords()).resolves.toMatchObject([{
      walletAddress: null,
      walletSignature: null,
      anonymizedAtMs: now,
    }]);
    await expect(store.getStatus(participant.fullId)).resolves.toMatchObject({
      wallet: { verified: true, addressRedacted: null },
      complete: false,
    });
  });

  it('retains completion and wallet ownership after raw proof material is purged', async () => {
    let now = 1_700_000_000_000;
    const store = new MemoryEvaluationStore({ now: () => now });
    const first = deriveParticipantIdentity('retention-owner-1', 'secret');
    const second = deriveParticipantIdentity('retention-owner-2', 'secret');
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
    await store.linkDeposit(first.fullId, 'e'.repeat(64));
    await store.submitFeedback(first.fullId, makeFeedback());

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
    await expect(store.listRestrictedRecords()).resolves.toMatchObject([{
      walletAddress: null,
      walletSignature: null,
      anonymizedAtMs: now,
    }, {}]);

    const replacement = Keypair.random();
    const replacementChallenge = await store.createChallenge(first.fullId);
    await expect(store.verifyWallet(first.fullId, {
      challengeId: replacementChallenge.id,
      address: replacement.publicKey(),
      signature: replacement.sign(buildSep53PayloadDigest(replacementChallenge.message)).toString('base64'),
      network: 'testnet',
    })).rejects.toMatchObject({ code: 'wallet_already_used' });

    const duplicateChallenge = await store.createChallenge(second.fullId);
    await expect(store.verifyWallet(second.fullId, {
      challengeId: duplicateChallenge.id,
      address: wallet.publicKey(),
      signature: wallet.sign(buildSep53PayloadDigest(duplicateChallenge.message)).toString('base64'),
      network: 'testnet',
    })).rejects.toMatchObject({ code: 'wallet_already_used' });
  });
});
