/**
 * Architectural guardrail: the GitHub control plane and the detached funding
 * provisioning plane must not import each other, share identifiers, or accept
 * each other's data.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MemoryFundingCapabilityStore, PilotFundingService } from './pilot-funding.js';

const TS_DIR = resolve(import.meta.dirname);

describe('control plane and provisioning plane separation', () => {
  it('never imports across the plane boundary', () => {
    const invites = readFileSync(join(TS_DIR, 'pilot-invites.ts'), 'utf8');
    const funding = readFileSync(join(TS_DIR, 'pilot-funding.ts'), 'utf8');
    expect(invites).not.toMatch(/pilot-funding/u);
    expect(funding).not.toMatch(/pilot-invites/u);
    expect(invites).not.toMatch(/funding_capabilities|pilot_provisioning/u);
    expect(funding).not.toMatch(/pilot_invites|control_plane/u);
  });

  it('mints capabilities from no identity at all', async () => {
    const funding = new PilotFundingService({
      store: new MemoryFundingCapabilityStore(),
      sponsor: { async fundCommitment() { return { transactionHash: '0x0' }; } },
      contractAddress: '0x0000000000000000000000000000000000000001',
    });
    expect(PilotFundingService.prototype.issueCapability.length).toBe(0);
    const capability = await funding.issueCapability();
    expect(capability.fundingToken).not.toMatch(/github|invite|account|[0-9]{5,}/u);
  });
});
