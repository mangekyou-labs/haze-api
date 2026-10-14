import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { BaseBondSponsor } from './base-chain.js';
import { createBundleFundingSponsor } from './bundle-funding-sponsor.js';
import { FundingPreBroadcastError } from './pilot-funding.js';
import { FundingRevertedError } from './sandbox-billing.js';
import { HASH, ready } from './sandbox-test-support.js';

function setup(now?: () => number) {
  const query = vi.fn(async (sql: string) => ({ rows: [{ acquired: true }], rowCount: sql.includes('SELECT 1 FROM') ? 0 : 1 }));
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  const chain = {
    fundingStatus: vi.fn(async () => ready),
    fundBundle: vi.fn(async (_commitment: string, _tier: number, broadcast?: (hash: string) => Promise<void>) => {
      await broadcast?.(HASH);
      return { transaction: HASH, expiryAt: 1_900_000_000_999 };
    }),
    reconcileBundle: vi.fn<BaseBondSponsor['reconcileBundle']>(async () => undefined),
    isConfirmedRevert: vi.fn(async () => false),
    releaseBond: vi.fn(),
  };
  const createChainSponsor = vi.fn(() => chain);
  const sponsor = createBundleFundingSponsor({ pool: { connect } as unknown as Pool, createChainSponsor, now });
  return { sponsor, chain, createChainSponsor, connect, query, release };
}

describe('bundle funding sponsor', () => {
  it('coalesces simultaneous status reads and refreshes after ten seconds', async () => {
    let now = 0;
    const s = setup(() => now);
    await Promise.all([s.sponsor.status(), s.sponsor.status(), s.sponsor.status()]);
    expect(s.chain.fundingStatus).toHaveBeenCalledOnce();
    now = 9999;
    await s.sponsor.status();
    expect(s.chain.fundingStatus).toHaveBeenCalledOnce();
    now = 10_000;
    await s.sponsor.status();
    expect(s.chain.fundingStatus).toHaveBeenCalledTimes(2);
  });

  it('invalidates readiness after funding and never caches an RPC failure', async () => {
    const s = setup();
    s.chain.fundingStatus.mockRejectedValueOnce(new Error('RPC busy'));
    await expect(s.sponsor.status()).rejects.toThrow('RPC busy');
    await s.sponsor.status();
    await s.sponsor.fund('123', async () => {});
    await s.sponsor.status();
    expect(s.chain.fundingStatus).toHaveBeenCalledTimes(3);
  });

  it('constructs lazily and shares the chain adapter across readiness, funding and recovery', async () => {
    const s = setup();
    expect(s.createChainSponsor).not.toHaveBeenCalled();
    expect(await s.sponsor.status()).toEqual(ready);
    const persisted = vi.fn(async () => {});
    expect(await s.sponsor.fund('123', persisted)).toEqual({ transactionHash: HASH, expiry: 1_900_000_000 });
    await s.sponsor.reconcile('123', null);
    expect(s.createChainSponsor).toHaveBeenCalledTimes(1);
    expect(s.chain.fundBundle).toHaveBeenCalledWith('123', 0, persisted);
    expect(persisted).toHaveBeenCalledWith(HASH);
    expect(s.release).toHaveBeenCalledTimes(1);
  });

  it('allows construction to retry after a configuration failure', async () => {
    const s = setup();
    s.createChainSponsor.mockImplementationOnce(() => { throw new Error('configuration'); });
    expect(() => s.sponsor.status()).toThrow('sponsor_not_configured');
    expect(await s.sponsor.status()).toEqual(ready);
    expect(s.createChainSponsor).toHaveBeenCalledTimes(2);
  });

  it.each(['contention', 'unresolved'])('blocks chain submission on %s', async reason => {
    const s = setup();
    s.query.mockImplementation(async sql => ({ rows: [{ acquired: reason !== 'contention' }], rowCount: sql.includes('SELECT 1 FROM') ? 1 : 0 }));
    await expect(s.sponsor.fund('123', async () => {})).rejects.toThrow('sponsor_pending');
    expect(s.chain.fundBundle).not.toHaveBeenCalled();
    expect(s.createChainSponsor).not.toHaveBeenCalled();
    expect(s.release).toHaveBeenCalledOnce();
  });

  it('classifies connection failure before a write as pre-broadcast', async () => {
    const s = setup();
    s.connect.mockRejectedValueOnce(new Error('database down'));
    await expect(s.sponsor.fund('123', async () => {})).rejects.toBeInstanceOf(FundingPreBroadcastError);
    expect(s.chain.fundBundle).not.toHaveBeenCalled();
  });

  it('forwards original and replacement broadcasts and releases the lock on persistence failure', async () => {
    const s = setup();
    const replacement = `0x${'ab'.repeat(32)}`;
    s.chain.fundBundle.mockImplementationOnce(async (_, __, broadcast) => {
      await broadcast!(HASH);
      await broadcast!(replacement);
      return { transaction: replacement, expiryAt: 1_900_000_000_999 };
    });
    const error = new Error('hash persistence failed');
    const persist = vi.fn(async () => {}).mockRejectedValueOnce(error);
    await expect(s.sponsor.fund('123', persist)).rejects.toBe(error);
    expect(s.query).toHaveBeenCalledWith('SELECT pg_advisory_unlock($1)', [845320020]);
    expect(s.release).toHaveBeenCalledOnce();
    s.chain.fundBundle.mockImplementationOnce(async (_, __, broadcast) => {
      await broadcast!(HASH); await broadcast!(replacement);
      return { transaction: replacement, expiryAt: 1_900_000_000_999 };
    });
    expect(await s.sponsor.fund('123', persist)).toMatchObject({ transactionHash: replacement });
    expect(persist.mock.calls).toEqual([[HASH], [HASH], [replacement]]);
  });

  it.each([new FundingPreBroadcastError('preflight_failed'), new FundingRevertedError(), new Error('receipt timeout')])('preserves chain errors: %s', async error => {
    const s = setup();
    s.chain.fundBundle.mockRejectedValueOnce(error);
    await expect(s.sponsor.fund('123', async () => {})).rejects.toBe(error);
    expect(s.release).toHaveBeenCalledOnce();
  });

  it('rejects a funding result with no expiry', async () => {
    const s = setup();
    s.chain.fundBundle.mockResolvedValueOnce({ transaction: HASH, expiryAt: 0 });
    await expect(s.sponsor.fund('123', async () => {})).rejects.toThrow('base_funding_expiry_missing');
    expect(s.release).toHaveBeenCalledOnce();
  });

  it('prefers confirmed funding by commitment over checking a supplied reverted hash', async () => {
    const s = setup();
    s.chain.reconcileBundle.mockResolvedValueOnce({ transaction: HASH, expiryAt: 1_900_000_000_999 });
    s.chain.isConfirmedRevert.mockResolvedValue(true);
    expect(await s.sponsor.reconcile('123', 'old-hash')).toEqual({ state: 'funded', transactionHash: HASH, expiry: 1_900_000_000 });
    expect(s.chain.reconcileBundle).toHaveBeenCalledWith('123', 'old-hash');
    expect(s.chain.isConfirmedRevert).not.toHaveBeenCalled();
  });

  it('reports confirmed reverts and leaves missing or unconfirmed receipts inconclusive', async () => {
    const s = setup();
    expect(await s.sponsor.reconcile('123', null)).toBeUndefined();
    expect(s.chain.isConfirmedRevert).not.toHaveBeenCalled();
    expect(await s.sponsor.reconcile('123', HASH)).toBeUndefined();
    s.chain.isConfirmedRevert.mockResolvedValue(true);
    expect(await s.sponsor.reconcile('123', HASH)).toEqual({ state: 'reverted' });
    expect(s.connect).not.toHaveBeenCalled();
  });

  it('propagates readiness and reconciliation RPC failures without claiming an outcome', async () => {
    const s = setup();
    const error = new Error('RPC unavailable');
    s.chain.fundingStatus.mockRejectedValueOnce(error);
    await expect(s.sponsor.status()).rejects.toBe(error);
    s.chain.reconcileBundle.mockRejectedValueOnce(error);
    await expect(s.sponsor.reconcile('123', HASH)).rejects.toBe(error);
    s.chain.isConfirmedRevert.mockRejectedValueOnce(error);
    await expect(s.sponsor.reconcile('123', HASH)).rejects.toBe(error);
  });
});
