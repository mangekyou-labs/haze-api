import { describe, expect, it, beforeEach } from 'vitest';
import request from 'supertest';
import { Keypair } from '@stellar/stellar-sdk';
import { app } from './server.js';
import { buildSep53PayloadDigest, deriveParticipantIdentity } from './evaluation.js';

describe('internal evaluation routes', () => {
  beforeEach(() => {
    process.env.GATEWAY_SECRET = 'evaluation-route-secret';
  });

  it('requires gateway authentication and returns only pseudonymous status', async () => {
    const participant = deriveParticipantIdentity(`route-${Date.now()}-auth`, 'secret');
    const unauthorized = await request(app)
      .post('/v1/evaluation/enroll')
      .set('x-evaluation-participant-id', participant.fullId)
      .send({ consentVersion: '2026-09-11' });
    expect(unauthorized.status).toBe(401);

    const enrolled = await request(app)
      .post('/v1/evaluation/enroll')
      .set('Authorization', 'Bearer evaluation-route-secret')
      .set('x-evaluation-participant-id', participant.fullId)
      .send({ consentVersion: '2026-09-11' });
    expect(enrolled.status).toBe(200);
    expect(enrolled.body.participantCode).toBe(participant.publicCode);
    expect(enrolled.body).not.toHaveProperty('fullId');

    const status = await request(app)
      .get('/v1/evaluation/status')
      .set('Authorization', 'Bearer evaluation-route-secret')
      .set('x-evaluation-participant-id', participant.fullId);
    expect(status.status).toBe(200);
    expect(status.body.wallet).toEqual({ verified: false, addressRedacted: null });
    expect(JSON.stringify(status.body)).not.toContain(participant.fullId);
  });

  it('verifies a challenge without accepting a client-supplied message', async () => {
    const participant = deriveParticipantIdentity(`route-${Date.now()}-proof`, 'secret');
    const headers = {
      Authorization: 'Bearer evaluation-route-secret',
      'x-evaluation-participant-id': participant.fullId,
    };
    await request(app).post('/v1/evaluation/enroll').set(headers).send({ consentVersion: '2026-09-11' });
    const challengeResponse = await request(app).post('/v1/evaluation/challenge').set(headers).send({});
    expect(challengeResponse.status).toBe(200);

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
    expect(verified.body.addressRedacted).toContain('…');
  });

  it('rejects malformed wallet-proof fields at the gateway boundary', async () => {
    const participant = deriveParticipantIdentity(`route-${Date.now()}-invalid-proof`, 'secret');
    const response = await request(app)
      .post('/v1/evaluation/wallet-proof')
      .set('Authorization', 'Bearer evaluation-route-secret')
      .set('x-evaluation-participant-id', participant.fullId)
      .send({ challengeId: { nested: true }, address: 'GABC', signature: 42, network: 'testnet' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'invalid_fields' });
  });
});
