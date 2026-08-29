// Gateway durable-store tests (M2.2). The MemoryGatewayStore shares the same
// contract as the PostgresGatewayStore, so the full flow is tested offline;
// PostgresIntegrationGatewayStore tests are opt-in via RUN_DB_TESTS=1.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemoryGatewayStore,
  reconstructGatewayState,
  type AcceptedCall,
} from './gateway.js';

function sampleCall(over: Partial<AcceptedCall> = {}): AcceptedCall {
  return {
    proofHash: 'ph1',
    nullifier: 'n1',
    epoch: 20260804,
    slot: 0,
    nonceHash: 'nh1',
    acceptedAt: new Date('2026-08-04T10:00:00Z'),
    ...over,
  };
}

describe('MemoryGatewayStore (gateway durable state contract)', () => {
  let store: MemoryGatewayStore;

  beforeEach(() => {
    store = new MemoryGatewayStore();
  });

  it('records an accepted call and rejects a duplicate proof hash', async () => {
    await store.recordAcceptedCall(sampleCall(), 'comm-1');
    const calls = await store.listAcceptedCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].nullifier).toBe('n1');
    await expect(store.recordAcceptedCall(sampleCall(), 'comm-1')).rejects.toThrow(/duplicate|exists|PK/i);
  });

  it('marks a nullifier seen and flips it to spent-on-chain', async () => {
    await store.markNullifierSeen('n1', 20260804, 0);
    let rec = await store.getNullifier('n1');
    expect(rec).toBeTruthy();
    expect(rec!.spentOnChain).toBe(false);

    await store.markNullifierSpentOnChain('n1');
    rec = await store.getNullifier('n1');
    expect(rec!.spentOnChain).toBe(true);
    expect(rec!.spentAt).toBeTruthy();
  });

  it('creates, looks up, and lists API keys by commitment (privacy: no call link)', async () => {
    await store.createApiKey('hash-a', 'comm-1', 'dev');
    await store.createApiKey('hash-b', 'comm-1', 'prod');

    const a = await store.getApiKey('hash-a');
    expect(a?.commitment).toBe('comm-1');
    expect(await store.getApiKey('missing')).toBeNull();

    const keys = await store.listApiKeys('comm-1');
    expect(keys.map((k) => k.keyHash).sort()).toEqual(['hash-a', 'hash-b']);
  });

  it('increments per-epoch call counts and reports lifetime totals', async () => {
    expect(await store.getCallCount('comm-1')).toBe(0);
    await store.incrementCallCount('comm-1', 20260804);
    await store.incrementCallCount('comm-1', 20260804);
    await store.incrementCallCount('comm-1', 20260805);
    expect(await store.getCallCount('comm-1')).toBe(3);
  });

  it('reconstructs nullifier set + call counts for restart durability', async () => {
    await store.markNullifierSeen('n1', 20260804, 0);
    await store.markNullifierSeen('n2', 20260804, 1);
    await store.markNullifierSpentOnChain('n2');
    await store.incrementCallCount('comm-1', 20260804);
    await store.incrementCallCount('comm-1', 20260804);
    await store.incrementCallCount('comm-2', 20260804);

    const state = await reconstructGatewayState(store);
    expect(state.nullifiers).toEqual(new Set(['n1', 'n2']));
    expect(state.callCounts.get('comm-1')).toBe(2);
    expect(state.callCounts.get('comm-2')).toBe(1);
  });

  it('persists a pending membership leaf before activating its root without touching call records', async () => {
    await store.reserveMembershipLeaf({
      leafIndex: 1,
      commitment: 'member-2',
      candidateRoot: 'root-after-member-2',
    });

    expect(await store.listMembershipLeaves()).toMatchObject([
      {
        leafIndex: 1,
        commitment: 'member-2',
        status: 'pending',
        candidateRoot: 'root-after-member-2',
      },
    ]);
    expect(await store.getMembershipTreeState()).toBeNull();
    expect(await store.listAcceptedCalls()).toEqual([]);

    const layers = [
      ['0', 'member-2', '0', '0', '0', '0', '0', '0'],
      ['node-0', '0', '0', '0'],
      ['node-1', '0'],
      ['root-after-member-2'],
    ];
    await store.activateMembershipLeaf(1, 'root-after-member-2', layers);

    expect(await store.listMembershipLeaves()).toMatchObject([
      { leafIndex: 1, status: 'active' },
    ]);
    expect(await store.getMembershipTreeState()).toMatchObject({
      root: 'root-after-member-2',
      version: 1,
      layers,
    });
  });

  it('marks a removed membership leaf and records the resulting root layers', async () => {
    const activeLayers = [
      ['member-1', '0', '0', '0', '0', '0', '0', '0'],
      ['active-node-0', '0', '0', '0'],
      ['active-node-1', '0'],
      ['active-root'],
    ];
    await store.reserveMembershipLeaf({
      leafIndex: 0,
      commitment: 'member-1',
      candidateRoot: 'active-root',
    });
    await store.activateMembershipLeaf(0, 'active-root', activeLayers);

    const removedLayers = [
      ['0', '0', '0', '0', '0', '0', '0', '0'],
      ['removed-node-0', '0', '0', '0'],
      ['removed-node-1', '0'],
      ['removed-root'],
    ];
    await store.removeMembershipLeaf(0, 'removed-root', removedLayers);

    expect(await store.listMembershipLeaves()).toMatchObject([
      { leafIndex: 0, status: 'removed' },
    ]);
    expect(await store.getMembershipTreeState()).toMatchObject({
      root: 'removed-root',
      version: 2,
      layers: removedLayers,
    });
  });

  it('lists accepted calls pending on-chain spend (settlement queue resumption)', async () => {
    await store.recordAcceptedCall(sampleCall({ proofHash: 'ph-pending' }), 'comm-1');
    await store.recordAcceptedCall(
      sampleCall({ proofHash: 'ph-spent', onChainSpendTx: 'tx-1', spentOnChain: true }),
      'comm-1',
    );
    const pending = await store.listAcceptedCalls({ onlyPendingSpend: true });
    expect(pending.map((c) => c.proofHash)).toEqual(['ph-pending']);
  });
});
