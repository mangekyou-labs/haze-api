/**
 * Founder CLI behavior: issue (printing the code exactly once), inspect, and
 * revoke by invite id.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { MemoryInviteStore, PilotInviteService } from './pilot-invites.js';
import { runPilotAdmin } from './pilot-admin.js';

const NOW = 1_800_000_000_000;

function dependencies() {
  const store = new MemoryInviteStore();
  const invites = new PilotInviteService({
    store,
    capabilities: { async issue() { return { fundingToken: 'token', expiresAt: NOW }; } },
    now: () => NOW,
  });
  return { store, invites };
}

describe('pilot-admin CLI', () => {
  it('issues an invite with the github account and prints the plaintext code once', async () => {
    const { invites, store } = dependencies();
    const output = await runPilotAdmin(['issue-invite', '--github-id', '4242'], { invites });
    const [record] = await store.list();
    expect(record!.githubAccountId).toBe('4242');
    expect(output).toMatch(/invite id:\s+inv_/u);
    expect(output).toMatch(/expires:\s+/u);
    expect(output).toMatch(/code \(shown once\):\s+\S+/u);
    const code = /code \(shown once\):\s+(\S+)/u.exec(output)![1]!;
    expect(record!.codeHash).not.toBe(code);
    // The code is printable material only: it never appears in a second read.
    const inspect = await runPilotAdmin(['inspect-invite', record!.inviteId], { invites });
    expect(inspect).not.toContain(code);
    expect(inspect).toMatch(/state:\s+open/u);
  });

  it('honors an explicit validity window in days', async () => {
    const { invites, store } = dependencies();
    await runPilotAdmin(['issue-invite', '--github-id', '4242', '--days', '2'], { invites });
    const [record] = await store.list();
    expect(record!.expiresAt).toBe(NOW + 2 * 24 * 60 * 60 * 1000);
  });

  it('revokes by invite id and reports redeemed and expired states', async () => {
    const { invites } = dependencies();
    const issued = await invites.issue({ githubAccountId: '4242' });
    const revoked = await runPilotAdmin(['revoke-invite', issued.inviteId], { invites });
    expect(revoked).toMatch(/revoked:\s+true/u);
    expect(await runPilotAdmin(['inspect-invite', issued.inviteId], { invites })).toMatch(/state:\s+revoked/u);

    const other = await invites.issue({ githubAccountId: '4242' });
    await invites.redeem({ code: other.code, githubAccountId: '4242' });
    expect(await runPilotAdmin(['inspect-invite', other.inviteId], { invites })).toMatch(/state:\s+redeemed/u);

    const missing = await runPilotAdmin(['inspect-invite', 'inv_missing'], { invites });
    expect(missing).toMatch(/not found/u);
  });

  it('rejects unknown commands and missing arguments without touching state', async () => {
    const { invites, store } = dependencies();
    await expect(runPilotAdmin([], { invites })).rejects.toThrow(/usage/u);
    await expect(runPilotAdmin(['issue-invite'], { invites })).rejects.toThrow(/github-id/u);
    await expect(runPilotAdmin(['issue-invite', '--github-id', '4242', '--days', '0'], { invites })).rejects.toThrow(/days/u);
    await expect(runPilotAdmin(['revoke-invite'], { invites })).rejects.toThrow(/invite id/u);
    expect(await store.list()).toHaveLength(0);
  });
});
