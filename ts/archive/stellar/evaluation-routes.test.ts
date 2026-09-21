import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Keypair } from '@stellar/stellar-sdk';
import {
  app,
  resetGatewayStoreForTests,
  setEvaluationStore,
  startEvaluationPurgeScheduler,
  stopEvaluationPurgeScheduler,
} from './server.js';
import {
  EVALUATION_CONSENT_VERSION,
  buildSep53PayloadDigest,
  deriveParticipantIdentity,
  MemoryEvaluationStore,
} from './evaluation.js';

const gatewayHeaders = (participantId: string) => ({
  Authorization: 'Bearer evaluation-route-secret',
  'x-evaluation-participant-id': participantId,
});

describe('authenticated internal evaluation routes', () => {
  beforeEach(async () => {
    await resetGatewayStoreForTests();
    process.env.GATEWAY_SECRET = 'evaluation-route-secret';
    delete process.env.EVALUATION_PURGE_SECRET;
  });

  it('requires both gateway authentication and a valid opaque participant header', async () => {
    const participant = deriveParticipantIdentity('route-auth', 'secret');
    const missingAuth = await request(app)
      .post('/v1/evaluation/enroll')
      .set('x-evaluation-participant-id', participant.fullId)
      .send({ consentVersion: EVALUATION_CONSENT_VERSION });
    expect(missingAuth.status).toBe(401);

    const missingParticipant = await request(app)
      .post('/v1/evaluation/enroll')
      .set('Authorization', 'Bearer evaluation-route-secret')
      .send({ consentVersion: EVALUATION_CONSENT_VERSION });
    expect(missingParticipant.status).toBe(401);

    const malformedParticipant = await request(app)
      .post('/v1/evaluation/enroll')
      .set(gatewayHeaders('github-subject'))
      .send({ consentVersion: EVALUATION_CONSENT_VERSION });
    expect(malformedParticipant.status).toBe(400);
  });

  it('enrolls with the exact consent version and returns pseudonymous status', async () => {
    const participant = deriveParticipantIdentity('route-enrollment', 'secret');
    const headers = gatewayHeaders(participant.fullId);

    const wrongVersion = await request(app)
      .post('/v1/evaluation/enroll').set(headers).send({ consentVersion: '2026-09-11' });
    expect(wrongVersion.status).toBe(400);

    const enrolled = await request(app)
      .post('/v1/evaluation/enroll').set(headers).send({ consentVersion: EVALUATION_CONSENT_VERSION });
    expect(enrolled.status).toBe(200);
    expect(enrolled.body).toMatchObject({ participantCode: participant.publicCode });
    expect(enrolled.body).not.toHaveProperty('fullId');

    const status = await request(app).get('/v1/evaluation/status').set(headers);
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      participantCode: participant.publicCode,
      wallet: { verified: false, addressRedacted: null },
      deposit: { confirmed: false, transactionHash: null },
      complete: false,
    });
    expect(JSON.stringify(status.body)).not.toContain(participant.fullId);
  });

  it('runs the challenge/proof flow and never returns the raw signature', async () => {
    const participant = deriveParticipantIdentity('route-proof', 'secret');
    const headers = gatewayHeaders(participant.fullId);
    await request(app).post('/v1/evaluation/enroll').set(headers)
      .send({ consentVersion: EVALUATION_CONSENT_VERSION });

    const challengeResponse = await request(app).post('/v1/evaluation/challenge').set(headers).send({});
    expect(challengeResponse.status).toBe(200);
    expect(challengeResponse.body.message).toContain('stellar:testnet');

    const wallet = Keypair.random();
    const signature = wallet.sign(buildSep53PayloadDigest(challengeResponse.body.message)).toString('base64');
    const verified = await request(app)
      .post('/v1/evaluation/wallet-proof')
      .set(headers)
      .send({
        challengeId: challengeResponse.body.id,
        address: wallet.publicKey(),
        signature,
        network: 'testnet',
      });
    expect(verified.status).toBe(200);
    expect(verified.body).toMatchObject({ verified: true });
    expect(JSON.stringify(verified.body)).not.toContain(signature);

    const replay = await request(app)
      .post('/v1/evaluation/wallet-proof')
      .set(headers)
      .send({
        challengeId: challengeResponse.body.id,
        address: wallet.publicKey(),
        signature,
        network: 'testnet',
      });
    expect(replay.status).toBe(409);
    expect(replay.body.error).toBe('challenge_replayed');
  });

  it('rejects malformed proof and feedback fields at the boundary', async () => {
    const participant = deriveParticipantIdentity('route-validation', 'secret');
    const headers = gatewayHeaders(participant.fullId);
    const invalidProof = await request(app)
      .post('/v1/evaluation/wallet-proof')
      .set(headers)
      .send({ challengeId: { nested: true }, address: 'GABC', signature: 42, network: 'testnet' });
    expect(invalidProof.status).toBe(400);
    expect(invalidProof.body).toEqual({ error: 'invalid_fields' });

    await request(app).post('/v1/evaluation/enroll').set(headers)
      .send({ consentVersion: EVALUATION_CONSENT_VERSION });
    const feedback = await request(app).post('/v1/evaluation/feedback').set(headers)
      .send({ easeRating: 6 });
    expect(feedback.status).toBe(409);
    expect(feedback.body.error).toBe('feedback_not_ready');
  });

  it('links a confirmed deposit only after wallet proof and serves checkout ownership routes', async () => {
    const participant = deriveParticipantIdentity('route-deposit-checkout', 'secret');
    const headers = gatewayHeaders(participant.fullId);
    await request(app).post('/v1/evaluation/enroll').set(headers)
      .send({ consentVersion: EVALUATION_CONSENT_VERSION });
    const challenge = await request(app).post('/v1/evaluation/challenge').set(headers).send({});
    const wallet = Keypair.random();
    const signature = wallet.sign(buildSep53PayloadDigest(challenge.body.message)).toString('base64');
    await request(app).post('/v1/evaluation/wallet-proof').set(headers).send({
      challengeId: challenge.body.id,
      address: wallet.publicKey(),
      signature,
      network: 'testnet',
    });

    const transactionHash = 'c'.repeat(64);
    const deposit = await request(app).post('/v1/evaluation/deposit').set(headers).send({ transactionHash });
    expect(deposit.status).toBe(200);
    expect(deposit.body.deposit).toMatchObject({ confirmed: true, transactionHash });

    const checkout = await request(app).post('/v1/evaluation/checkout').set(headers).send({
      checkoutSessionId: 'cs_route_1', amountCents: 100, eventId: 'evt_route_1',
    });
    expect(checkout.status).toBe(200);
    expect(checkout.body).toMatchObject({ checkoutSessionId: 'cs_route_1', processingStatus: 'pending' });
    const fetched = await request(app).get('/v1/evaluation/checkout?sessionId=cs_route_1').set(headers);
    expect(fetched.status).toBe(200);
    expect(fetched.body.checkoutSessionId).toBe('cs_route_1');
    const marked = await request(app).post('/v1/evaluation/checkout/status').set(headers).send({
      checkoutSessionId: 'cs_route_1', status: 'failed',
    });
    expect(marked.status).toBe(200);
    expect(marked.body.processingStatus).toBe('failed');
  });

  it('runs retention purge only with the dedicated secret and returns a redacted count', async () => {
    const participant = deriveParticipantIdentity('route-purge', 'secret');
    const expiredStore = new MemoryEvaluationStore({ now: () => 0 });
    setEvaluationStore(expiredStore);
    await expiredStore.enroll(participant.fullId, EVALUATION_CONSENT_VERSION);
    process.env.EVALUATION_PURGE_SECRET = 'purge-route-secret';

    const gatewaySecretAttempt = await request(app)
      .post('/v1/internal/evaluation/purge')
      .set('Authorization', 'Bearer evaluation-route-secret');
    expect(gatewaySecretAttempt.status).toBe(401);

    const purged = await request(app)
      .post('/v1/internal/evaluation/purge')
      .set('Authorization', 'Bearer purge-route-secret');
    expect(purged.status).toBe(200);
    expect(purged.body).toEqual({ purged: 1 });
    expect(JSON.stringify(purged.body)).not.toContain(participant.fullId);
    expect((await expiredStore.listRestrictedRecords())[0]?.anonymizedAtMs).not.toBeNull();
  });

  it('supports a bounded in-process retention schedule without overlapping purges', async () => {
    const store = new MemoryEvaluationStore();
    let releaseFirstPurge: (value: number) => void = () => undefined;
    const firstPurge = new Promise<number>((resolve) => {
      releaseFirstPurge = resolve;
    });
    const purge = vi.spyOn(store, 'purgeExpired')
      .mockImplementationOnce(async () => firstPurge)
      .mockResolvedValue(0);
    setEvaluationStore(store);

    startEvaluationPurgeScheduler(5);
    await vi.waitFor(() => expect(purge).toHaveBeenCalled(), { timeout: 500 });
    expect(purge.mock.calls[0]?.[0]).toEqual(expect.any(Number));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(purge).toHaveBeenCalledTimes(1);
    releaseFirstPurge(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    stopEvaluationPurgeScheduler();
    expect(purge.mock.calls.length).toBeGreaterThan(1);
  });
});
