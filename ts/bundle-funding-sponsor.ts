/** Sandbox bundle funding coordination. Billing owns durable reservations.
 * SPDX-License-Identifier: AGPL-3.0-or-later */

import type { Pool } from 'pg';
import { createBaseBondSponsor, type BaseBondSponsor } from './base-chain.js';
import { FundingPreBroadcastError } from './pilot-funding.js';
import type { SandboxSponsor } from './sandbox-billing.js';
import { withSandboxSponsorLock } from './sandbox-sponsor-lock.js';

export function createBundleFundingSponsor(options: {
  pool: Pool;
  createChainSponsor?: () => BaseBondSponsor;
}): SandboxSponsor {
  let chainSponsor: BaseBondSponsor | undefined;
  function requireSponsor(): BaseBondSponsor {
    try { return chainSponsor ??= (options.createChainSponsor ?? createBaseBondSponsor)(); }
    catch { throw new FundingPreBroadcastError('sponsor_not_configured'); }
  }

  return {
    status: () => requireSponsor().fundingStatus(),
    async fund(commitment, onBroadcast) {
      return withSandboxSponsorLock(options.pool, commitment, async () => {
        const result = await requireSponsor().fundBundle(commitment, 0, onBroadcast);
        if (!result.expiryAt) throw new Error('base_funding_expiry_missing');
        return { transactionHash: result.transaction, expiry: Math.floor(result.expiryAt / 1000) };
      });
    },
    async reconcile(commitment, hash) {
      const sponsor = requireSponsor();
      const found = await sponsor.reconcileBundle(commitment);
      if (found) return { state: 'funded', transactionHash: found.transaction, expiry: Math.floor(found.expiryAt / 1000) };
      if (hash && await sponsor.isConfirmedRevert(hash)) return { state: 'reverted' };
      return undefined;
    },
  };
}
