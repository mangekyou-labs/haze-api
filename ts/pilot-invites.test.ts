/**
 * Control-plane invite behavior: hashed single-use codes, expiry, revocation,
 * GitHub binding, and one-redemption enforcement. The invite plane never sees
 * a commitment and never stores a funding capability.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { MemoryInviteStore, PilotInviteService, hashInviteCode } from './pilot-invites.js';

const NOW = 1_800_000_000_000;
const GITHUB_ID = '4242';

function service(options: { now?: () => number; inviteTtlMs?: number } = {}) {
  const store = new MemoryInviteStore();
  const issued: Array<{ fundingToken: string; expiresAt: number }> = [];
  const capabilities = {
    async issue() {
      const capability = { fundingToken: `token-${issued.length + 1}`, expiresAt: (options.now?.() ?? NOW) + 30 * 60 * 1000 };
      issued.push(capability);
      return capability;
    },
  };
  const invites = new PilotInviteService({ store, capabilities, now: options.now ?? (() => NOW), inviteTtlMs: options.inviteTtlMs });
  return { store, invites, issued };
}

describe('pilot invites', () => {
  it('issues a 256-bit code, stores only its digest, and defaults to a seven-day validity', async () => {
    const { store, invites } = service();
    const issued = await invites.issue({ githubAccountId: GITHUB_ID });
    expect(issued.code).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(issued.inviteId).toMatch(/^inv_[A-Za-z0-9_-]{16,64}$/u);
    expect(issued.expiresAt).toBe(NOW + 7 * 24 * 60 * 60 * 1000);

    const [record] = await store.list();
    expect(record).toBeDefined();
    expect(record!.codeHash).toBe(hashInviteCode(issued.code));
    expect(record!.codeHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(record)).not.toContain(issued.code);
    // The control plane holds no commitment and no funding capability.
    expect(Object.keys(record!)).not.toContain('commitment');
    expect(Object.keys(record!)).not.toContain('fundingToken');
  });

  it('binds redemption to the invited GitHub account and returns a capability only once', async () => {
    const { invites, issued } = service();
    const { code } = await invites.issue({ githubAccountId: GITHUB_ID });

    await expect(invites.redeem({ code, githubAccountId: '9999' })).rejects.toThrow('invite_account_mismatch');
    expect(issued).toHaveLength(0);

    const redeemed = await invites.redeem({ code, githubAccountId: GITHUB_ID });
    expect(redeemed).toEqual(issued[0]);
    expect(redeemed.fundingToken).toBeTruthy();

    await expect(invites.redeem({ code, githubAccountId: GITHUB_ID })).rejects.toThrow('invite_already_redeemed');
    expect(issued).toHaveLength(1);
  });

  it('enforces one redemption under concurrent attempts', async () => {
    const { invites, issued } = service();
    const { code } = await invites.issue({ githubAccountId: GITHUB_ID });
    const attempts = await Promise.allSettled([
      invites.redeem({ code, githubAccountId: GITHUB_ID }),
      invites.redeem({ code, githubAccountId: GITHUB_ID }),
      invites.redeem({ code, githubAccountId: GITHUB_ID }),
    ]);
    const fulfilled = attempts.filter((attempt) => attempt.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    expect(issued).toHaveLength(1);
    for (const rejected of attempts.filter((attempt) => attempt.status === 'rejected')) {
      expect((rejected as PromiseRejectedResult).reason.message).toBe('invite_already_redeemed');
    }
  });

  it('rejects unknown, expired, and revoked codes', async () => {
    let clock = NOW;
    const { invites } = service({ now: () => clock });
    await expect(invites.redeem({ code: 'not-a-code', githubAccountId: GITHUB_ID })).rejects.toThrow('invalid_invite_code');
    await expect(invites.redeem({ code: '', githubAccountId: GITHUB_ID })).rejects.toThrow('invalid_invite_code');

    const expiring = await invites.issue({ githubAccountId: GITHUB_ID, ttlMs: 1000 });
    clock = NOW + 1001;
    await expect(invites.redeem({ code: expiring.code, githubAccountId: GITHUB_ID })).rejects.toThrow('invite_expired');

    clock = NOW;
    const revoked = await invites.issue({ githubAccountId: GITHUB_ID });
    expect(await invites.revoke(revoked.inviteId)).toBe(true);
    expect(await invites.revoke(revoked.inviteId)).toBe(false);
    await expect(invites.redeem({ code: revoked.code, githubAccountId: GITHUB_ID })).rejects.toThrow('invite_revoked');
  });

  it('inspects invite state by invite id without exposing the code', async () => {
    let clock = NOW;
    const { invites } = service({ now: () => clock });
    const open = await invites.issue({ githubAccountId: GITHUB_ID });
    expect(await invites.inspect(open.inviteId)).toMatchObject({ inviteId: open.inviteId, githubAccountId: GITHUB_ID, state: 'open' });
    expect(JSON.stringify(await invites.inspect(open.inviteId))).not.toContain(open.code);

    const redeeming = await invites.issue({ githubAccountId: GITHUB_ID });
    await invites.redeem({ code: redeeming.code, githubAccountId: GITHUB_ID });
    expect(await invites.inspect(redeeming.inviteId)).toMatchObject({ state: 'redeemed' });

    clock = open.expiresAt + 1;
    expect(await invites.inspect(open.inviteId)).toMatchObject({ state: 'expired' });
    expect(await invites.inspect('inv_missing_invite')).toBeUndefined();
  });
});
