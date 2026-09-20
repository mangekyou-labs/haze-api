/**
 * Pilot endpoints on the gateway: internal invite redemption, sessionless
 * funding, and public bundle lookup. These tests also scan every response for
 * forbidden cross-plane data.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createZkPrepaidGateway } from './zk-prepaid-gateway.js';
import { MockProviderAdapter } from './providerAdapter.js';
import { MemoryInviteStore, PilotInviteService } from './pilot-invites.js';
import { MemoryFundingCapabilityStore, PilotFundingService } from './pilot-funding.js';

const NOW = 1_800_000_000_000;
const GITHUB_ID = '4242';
const CONTRACT = '0x0000000000000000000000000000000000000001';
const COMMITMENT = '8687213900595150509063186631634067671233157784124627437219499552928422827997';
const OTHER_COMMITMENT = '12992319314469106065811618978512789981623859879058485908347559722389823331150';
const INTERNAL_TOKEN = 'internal-secret';
const FORBIDDEN = /github_account_id|githubAccountId|password|secret|private_key|nullifier|request_signal|proof|prompt|responses?":|remaining|balance|credit_balance|email/iu;

async function pilotGateway() {
  const invitations = new MemoryInviteStore();
  const funding = new PilotFundingService({
    store: new MemoryFundingCapabilityStore(),
    sponsor: { async fundCommitment() { return { transactionHash: '0xfunded', expiryAt: NOW + 30 * 24 * 60 * 60 * 1000 }; } },
    now: () => NOW,
    contractAddress: CONTRACT,
  });
  const invites = new PilotInviteService({
    store: invitations,
    capabilities: { issue: () => funding.issueCapability() },
    now: () => NOW,
  });
  const gateway = await createZkPrepaidGateway({
    now: () => NOW,
    provider: new MockProviderAdapter(),
    config: { publicBaseUrl: 'http://test.local', currentRoot: '1', knownRoots: ['1'] },
    verifyProof: async () => ({ isValid: true as const }),
    pilotInvites: invites,
    pilotFunding: funding,
  });
  return { gateway, invites, funding, invitations };
}

function issueCode(invites: PilotInviteService, githubAccountId = GITHUB_ID) {
  return invites.issue({ githubAccountId });
}

async function redeem(gateway: { app: Parameters<typeof request>[0] }, code: string) {
  return request(gateway.app)
    .post('/v1/pilot/invites/redeem')
    .set('authorization', `Bearer ${INTERNAL_TOKEN}`)
    .send({ code, githubAccountId: GITHUB_ID });
}

describe('gateway pilot endpoints', () => {
  it('requires the internal service token for invite redemption', async () => {
    process.env.BILLING_INTERNAL_TOKEN = INTERNAL_TOKEN;
    try {
      const { gateway, invites } = await pilotGateway();
      const issued = await issueCode(invites);
      const unauthorized = await request(gateway.app).post('/v1/pilot/invites/redeem').send({ code: issued.code, githubAccountId: GITHUB_ID });
      expect(unauthorized.status).toBe(401);

      const response = await redeem(gateway, issued.code);
      expect(response.status).toBe(200);
      expect(response.body.fundingToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(response.body.expiresAt).toBe(NOW + 30 * 60 * 1000);
      expect(JSON.stringify(response.body)).not.toMatch(FORBIDDEN);
      expect(JSON.stringify(response.body)).not.toContain(COMMITMENT);
    } finally {
      delete process.env.BILLING_INTERNAL_TOKEN;
    }
  });

  it('refuses a second redemption and uninvited accounts', async () => {
    process.env.BILLING_INTERNAL_TOKEN = INTERNAL_TOKEN;
    try {
      const { gateway, invites } = await pilotGateway();
      const issued = await issueCode(invites);
      expect((await redeem(gateway, issued.code)).status).toBe(200);
      const replay = await redeem(gateway, issued.code);
      expect(replay.status).toBe(409);
      expect(replay.body.error).toBe('invite_already_redeemed');

      const uninvited = await redeem(gateway, 'unknown-code-value-1234567890');
      expect(uninvited.status).toBe(400);
      expect(uninvited.body.error).toBe('invalid_invite_code');
    } finally {
      delete process.env.BILLING_INTERNAL_TOKEN;
    }
  });

  it('funds a bound commitment without any session or identity', async () => {
    process.env.BILLING_INTERNAL_TOKEN = INTERNAL_TOKEN;
    try {
      const { gateway, invites } = await pilotGateway();
      const issued = await issueCode(invites);
      const { body: redemption } = await redeem(gateway, issued.code);
      const token = redemption.fundingToken as string;

      const funded = await request(gateway.app).post('/v1/pilot/funding').send({ fundingToken: token, commitment: COMMITMENT });
      expect(funded.status).toBe(200);
      expect(funded.body).toEqual({
        network: 'eip155:84532',
        chainId: 84532,
        contractAddress: CONTRACT,
        deploymentDomain: '84532',
        tierId: 0,
        expiry: Math.floor((NOW + 30 * 24 * 60 * 60 * 1000) / 1000),
        transactionHash: '0xfunded',
      });
      expect(JSON.stringify(funded.body)).not.toMatch(FORBIDDEN);

      // Idempotent retry returns the same authoritative result.
      const retry = await request(gateway.app).post('/v1/pilot/funding').send({ fundingToken: token, commitment: COMMITMENT });
      expect(retry.body).toEqual(funded.body);

      // The same token never funds a different commitment.
      const conflict = await request(gateway.app).post('/v1/pilot/funding').send({ fundingToken: token, commitment: OTHER_COMMITMENT });
      expect(conflict.status).toBe(409);
      expect(conflict.body.error).toBe('funding_commitment_conflict');

      // A supplied identity field is ignored, never echoed, and never stored.
      const withIdentity = await request(gateway.app)
        .post('/v1/pilot/funding')
        .send({ fundingToken: token, commitment: COMMITMENT, githubAccountId: GITHUB_ID, accountId: GITHUB_ID });
      expect(withIdentity.body).toEqual(funded.body);
      expect(JSON.stringify(withIdentity.body)).not.toContain(GITHUB_ID);
    } finally {
      delete process.env.BILLING_INTERNAL_TOKEN;
    }
  });

  it('rejects unknown tokens, expired capabilities, and invalid commitments', async () => {
    const { gateway, invites } = await pilotGateway();
    const issued = await issueCode(invites);
    const { body: redemption } = await redeem(gateway, issued.code);

    expect((await request(gateway.app).post('/v1/pilot/funding').send({ fundingToken: 'unknown-token-value', commitment: COMMITMENT })).status).toBe(400);
    expect((await request(gateway.app).post('/v1/pilot/funding').send({ fundingToken: redemption.fundingToken, commitment: 'not-a-field' })).status).toBe(400);
    expect((await request(gateway.app).post('/v1/pilot/funding').send({})).status).toBe(400);
  });

  it('publishes only immutable funding metadata for recovery by commitment', async () => {
    process.env.BILLING_INTERNAL_TOKEN = INTERNAL_TOKEN;
    try {
      const { gateway, invites } = await pilotGateway();
      const issued = await issueCode(invites);
      const { body: redemption } = await redeem(gateway, issued.code);
      const { body: funded } = await request(gateway.app).post('/v1/pilot/funding').send({ fundingToken: redemption.fundingToken, commitment: COMMITMENT });

      const bundle = await request(gateway.app).get(`/v1/pilot/bundles/${COMMITMENT}`);
      expect(bundle.status).toBe(200);
      expect(bundle.body).toMatchObject({
        commitment: COMMITMENT,
        tierId: 0,
        expiry: funded.expiry,
        network: 'eip155:84532',
        contractAddress: CONTRACT,
        transactionHash: '0xfunded',
      });
      expect(JSON.stringify(bundle.body)).not.toMatch(FORBIDDEN);

      expect((await request(gateway.app).get(`/v1/pilot/bundles/${OTHER_COMMITMENT}`)).status).toBe(404);
      expect((await request(gateway.app).get('/v1/pilot/bundles/not-a-field')).status).toBe(400);
    } finally {
      delete process.env.BILLING_INTERNAL_TOKEN;
    }
  });

  it('fails closed when pilot stores are not configured', async () => {
    process.env.BILLING_INTERNAL_TOKEN = INTERNAL_TOKEN;
    try {
      const gateway = await createZkPrepaidGateway({
        now: () => NOW,
        provider: new MockProviderAdapter(),
        config: { publicBaseUrl: 'http://test.local', currentRoot: '1', knownRoots: ['1'] },
        verifyProof: async () => ({ isValid: true as const }),
      });
      const redemption = await request(gateway.app)
        .post('/v1/pilot/invites/redeem')
        .set('authorization', `Bearer ${INTERNAL_TOKEN}`)
        .send({ code: 'invite-code-value-1234567890', githubAccountId: GITHUB_ID });
      expect(redemption.status).toBe(503);
      const funding = await request(gateway.app).post('/v1/pilot/funding').send({ fundingToken: 'token-value-1234567890', commitment: COMMITMENT });
      expect(funding.status).toBe(503);
      const bundle = await request(gateway.app).get(`/v1/pilot/bundles/${COMMITMENT}`);
      expect(bundle.status).toBe(503);
    } finally {
      delete process.env.BILLING_INTERNAL_TOKEN;
    }
  });
});
