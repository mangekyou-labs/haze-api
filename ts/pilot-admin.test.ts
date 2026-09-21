/**
 * Founder CLI behavior: issue (printing the code exactly once), inspect, and
 * revoke by invite id, plus the launch kill switch and spend readout.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { MemoryInviteStore, PilotInviteService } from './pilot-invites.js';
import { LaunchControl, MemoryLaunchControlStore } from './launch-control.js';
import { runPilotAdmin } from './pilot-admin.js';

const NOW = 1_800_000_000_000;

function dependencies() {
  const store = new MemoryInviteStore();
  const invites = new PilotInviteService({
    store,
    capabilities: { async issue() { return { fundingToken: 'token', expiresAt: NOW }; } },
    now: () => NOW,
  });
  const launchControl = new LaunchControl({ store: new MemoryLaunchControlStore(), now: () => NOW });
  return { store, invites, launchControl };
}

describe('pilot-admin CLI', () => {
  it('issues an invite with the github account and prints the plaintext code once', async () => {
    const { invites, launchControl, store } = dependencies();
    const output = await runPilotAdmin(['issue-invite', '--github-id', '4242'], { invites, launchControl });
    const [record] = await store.list();
    expect(record!.githubAccountId).toBe('4242');
    expect(output).toMatch(/invite id:\s+inv_/u);
    expect(output).toMatch(/expires:\s+/u);
    expect(output).toMatch(/code \(shown once\):\s+\S+/u);
    const code = /code \(shown once\):\s+(\S+)/u.exec(output)![1]!;
    expect(record!.codeHash).not.toBe(code);
    // The code is printable material only: it never appears in a second read.
    const inspect = await runPilotAdmin(['inspect-invite', record!.inviteId], { invites, launchControl });
    expect(inspect).not.toContain(code);
    expect(inspect).toMatch(/state:\s+open/u);
  });

  it('honors an explicit validity window in days', async () => {
    const { invites, launchControl, store } = dependencies();
    await runPilotAdmin(['issue-invite', '--github-id', '4242', '--days', '2'], { invites, launchControl });
    const [record] = await store.list();
    expect(record!.expiresAt).toBe(NOW + 2 * 24 * 60 * 60 * 1000);
  });

  it('revokes by invite id and reports redeemed and expired states', async () => {
    const { invites, launchControl } = dependencies();
    const issued = await invites.issue({ githubAccountId: '4242' });
    const revoked = await runPilotAdmin(['revoke-invite', issued.inviteId], { invites, launchControl });
    expect(revoked).toMatch(/revoked:\s+true/u);
    expect(await runPilotAdmin(['inspect-invite', issued.inviteId], { invites, launchControl })).toMatch(/state:\s+revoked/u);

    const other = await invites.issue({ githubAccountId: '4242' });
    await invites.redeem({ code: other.code, githubAccountId: '4242' });
    expect(await runPilotAdmin(['inspect-invite', other.inviteId], { invites, launchControl })).toMatch(/state:\s+redeemed/u);

    const missing = await runPilotAdmin(['inspect-invite', 'inv_missing'], { invites, launchControl });
    expect(missing).toMatch(/not found/u);
  });

  it('rejects unknown commands and missing arguments without touching state', async () => {
    const { invites, launchControl, store } = dependencies();
    await expect(runPilotAdmin([], { invites, launchControl })).rejects.toThrow(/usage/u);
    await expect(runPilotAdmin(['issue-invite'], { invites, launchControl })).rejects.toThrow(/github-id/u);
    await expect(runPilotAdmin(['issue-invite', '--github-id', '4242', '--days', '0'], { invites, launchControl })).rejects.toThrow(/days/u);
    await expect(runPilotAdmin(['revoke-invite'], { invites, launchControl })).rejects.toThrow(/invite id/u);
    expect(await store.list()).toHaveLength(0);
  });

  it('pauses, reports, and resumes the launch from the founder CLI', async () => {
    const { invites, launchControl } = dependencies();

    const initial = await runPilotAdmin(['launch-status'], { invites, launchControl });
    expect(initial).toMatch(/launch state:\s+enabled/u);
    expect(initial).toMatch(/spend today:\s+0 micro-USD of 40000000/u);
    expect(initial).toMatch(/spend 30d:\s+0 micro-USD of 200000000/u);

    await expect(runPilotAdmin(['launch-pause'], { invites, launchControl })).rejects.toThrow(/reason/u);
    const paused = await runPilotAdmin(['launch-pause', '--reason', 'provider incident'], { invites, launchControl });
    expect(paused).toMatch(/launch paused: provider incident/u);
    await expect(launchControl.isPaused()).resolves.toBe(true);

    const reported = await runPilotAdmin(['launch-status'], { invites, launchControl });
    expect(reported).toMatch(/launch state:\s+paused/u);
    expect(reported).toMatch(/reason: provider incident/u);

    const resumed = await runPilotAdmin(['launch-resume'], { invites, launchControl });
    expect(resumed).toMatch(/launch state:\s+enabled/u);
    await expect(launchControl.isPaused()).resolves.toBe(false);
  });
});
