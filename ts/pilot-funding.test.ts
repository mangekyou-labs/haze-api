/**
 * Provisioning-plane capability behavior: detached funding tokens, one
 * commitment binding, idempotent retries, concurrent funding, and recovery
 * lookups. The provisioning plane never sees a GitHub identity.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { MemoryFundingCapabilityStore, PilotFundingService, hashFundingToken } from './pilot-funding.js';

const NOW = 1_800_000_000_000;
const COMMITMENT = '8687213900595150509063186631634067671233157784124627437219499552928422827997';
const OTHER_COMMITMENT = '12992319314469106065811618978512789981623859879058485908347559722389823331150';

function service(options: { now?: () => number; sponsor?: { fundCommitment(commitment: string): Promise<{ transactionHash: string; expiryAt?: number }> } } = {}) {
  const store = new MemoryFundingCapabilityStore();
  const calls: string[] = [];
  const sponsor = options.sponsor ?? {
    async fundCommitment(commitment: string) {
      calls.push(commitment);
      return { transactionHash: '0xfunded' };
    },
  };
  const funding = new PilotFundingService({
    store,
    sponsor,
    now: options.now ?? (() => NOW),
    network: 'eip155:84532',
    contractAddress: '0x0000000000000000000000000000000000000001',
  });
  return { store, funding, calls };
}

describe('pilot funding capabilities', () => {
  it('issues a 256-bit token, stores only its digest, and expires after 30 minutes', async () => {
    const { store, funding } = service();
    const capability = await funding.issueCapability();
    expect(capability.fundingToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(capability.expiresAt).toBe(NOW + 30 * 60 * 1000);

    const stored = await store.findByTokenHash(hashFundingToken(capability.fundingToken));
    expect(stored).toBeDefined();
    expect(stored!.tokenHash).toMatch(/^[0-9a-f]{64}$/u);
    // No GitHub account, invite, or cross-plane identifier is ever stored.
    expect(Object.keys(stored!)).not.toContain('githubAccountId');
    expect(Object.keys(stored!)).not.toContain('inviteId');
    expect(JSON.stringify(stored)).not.toContain(capability.fundingToken);
  });

  it('funds tier 0 with an authoritative expiry and a transaction hash', async () => {
    const { funding, calls } = service();
    const capability = await funding.issueCapability();
    const result = await funding.fund({ fundingToken: capability.fundingToken, commitment: COMMITMENT });
    expect(result).toEqual({
      network: 'eip155:84532',
      chainId: 84532,
      contractAddress: '0x0000000000000000000000000000000000000001',
      deploymentDomain: '84532',
      tierId: 0,
      expiry: Math.floor(NOW / 1000) + 30 * 24 * 60 * 60,
      transactionHash: '0xfunded',
    });
    expect(calls).toEqual([COMMITMENT]);
    expect(JSON.stringify(result)).not.toContain('github');
  });

  it('prefers the sponsor-reported expiry when the chain returns one', async () => {
    const onChainExpiryMs = NOW + 12_345_000;
    const { funding } = service({ sponsor: { async fundCommitment() { return { transactionHash: '0xabc', expiryAt: onChainExpiryMs }; } } });
    const capability = await funding.issueCapability();
    const result = await funding.fund({ fundingToken: capability.fundingToken, commitment: COMMITMENT });
    expect(result.expiry).toBe(Math.floor(onChainExpiryMs / 1000));
  });

  it('binds one token to one commitment: retries are idempotent and reuse with another commitment fails', async () => {
    const { funding, calls } = service();
    const capability = await funding.issueCapability();
    const first = await funding.fund({ fundingToken: capability.fundingToken, commitment: COMMITMENT });
    const retry = await funding.fund({ fundingToken: capability.fundingToken, commitment: COMMITMENT });
    expect(retry).toEqual(first);
    expect(calls).toEqual([COMMITMENT]);

    await expect(funding.fund({ fundingToken: capability.fundingToken, commitment: OTHER_COMMITMENT })).rejects.toThrow('funding_commitment_conflict');
    expect(calls).toEqual([COMMITMENT]);
  });

  it('funds concurrently exactly once and returns the same result to every caller', async () => {
    const { funding, calls } = service();
    const capability = await funding.issueCapability();
    const results = await Promise.all([
      funding.fund({ fundingToken: capability.fundingToken, commitment: COMMITMENT }),
      funding.fund({ fundingToken: capability.fundingToken, commitment: COMMITMENT }),
      funding.fund({ fundingToken: capability.fundingToken, commitment: COMMITMENT }),
    ]);
    expect(calls).toEqual([COMMITMENT]);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it('recovers a failed sponsorship attempt on retry with the same commitment', async () => {
    let fail = true;
    const store = new MemoryFundingCapabilityStore();
    const funding = new PilotFundingService({
      store,
      now: () => NOW,
      network: 'eip155:84532',
      contractAddress: '0x0000000000000000000000000000000000000001',
      sponsor: {
        async fundCommitment() {
          if (fail) throw new Error('sponsor_unavailable');
          return { transactionHash: '0xrecovered' };
        },
      },
    });
    const capability = await funding.issueCapability();
    await expect(funding.fund({ fundingToken: capability.fundingToken, commitment: COMMITMENT })).rejects.toThrow('funding_unavailable');

    const failed = await store.findByTokenHash(hashFundingToken(capability.fundingToken));
    expect(failed).toMatchObject({ state: 'failed', commitment: COMMITMENT, failureReason: 'sponsor_unavailable' });
    await expect(funding.fund({ fundingToken: capability.fundingToken, commitment: OTHER_COMMITMENT })).rejects.toThrow('funding_commitment_conflict');

    fail = false;
    const recovered = await funding.fund({ fundingToken: capability.fundingToken, commitment: COMMITMENT });
    expect(recovered.transactionHash).toBe('0xrecovered');
    expect((await store.findByTokenHash(hashFundingToken(capability.fundingToken)))!.state).toBe('funded');
  });

  it('rejects unknown tokens, expired capabilities, and invalid commitments', async () => {
    let clock = NOW;
    const { funding } = service({ now: () => clock });
    await expect(funding.fund({ fundingToken: 'unknown-token', commitment: COMMITMENT })).rejects.toThrow('invalid_funding_token');

    const expired = await funding.issueCapability();
    clock = NOW + 30 * 60 * 1000 + 1;
    await expect(funding.fund({ fundingToken: expired.fundingToken, commitment: COMMITMENT })).rejects.toThrow('funding_capability_expired');

    clock = NOW;
    const capability = await funding.issueCapability();
    for (const invalid of ['', '0', '-1', 'not-a-number', '0x', '21888242871839275222246405745257275088548364400416034343698204186575808495617']) {
      await expect(funding.fund({ fundingToken: capability.fundingToken, commitment: invalid })).rejects.toThrow('invalid_commitment');
    }
  });

  it('publishes immutable funding metadata for recovery by commitment', async () => {
    const { funding } = service();
    const capability = await funding.issueCapability();
    const funded = await funding.fund({ fundingToken: capability.fundingToken, commitment: COMMITMENT });

    const bundle = await funding.lookupByCommitment(COMMITMENT);
    expect(bundle).toMatchObject({
      commitment: COMMITMENT,
      tierId: 0,
      expiry: funded.expiry,
      network: 'eip155:84532',
      contractAddress: '0x0000000000000000000000000000000000000001',
      transactionHash: '0xfunded',
    });
    expect(Object.keys(bundle!)).not.toContain('githubAccountId');
    expect(Object.keys(bundle!)).not.toContain('fundingToken');
    expect(await funding.lookupByCommitment(OTHER_COMMITMENT)).toBeUndefined();
  });
});
