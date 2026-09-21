// Spend-worker settlement queue contract (M2.6). The durable accepted-call
// row must carry the full RLN proof + public signals so the per-call async
// on-chain spend() can be re-submitted after a restart (idempotent resumption).

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryGatewayStore } from './gateway.js';
import type { AcceptedCall } from './gateway.js';

function sampleCall(over: Partial<AcceptedCall> = {}): AcceptedCall {
  return {
    proofHash: 'ph-spend-1',
    nullifier: 'n-spend-1',
    epoch: 20260804,
    slot: 0,
    nonceHash: 'nh-spend-1',
    acceptedAt: new Date('2026-08-04T10:00:00Z'),
    proof: { a: ['1', '2'], b: [['3', '4']], c: ['5', '6'] },
    pubSignals: ['root', 'n-spend-1', 'x', 'y', '20260804'],
    ...over,
  };
}

describe('MemoryGatewayStore (spend settlement queue)', () => {
  let store: MemoryGatewayStore;

  beforeEach(() => {
    store = new MemoryGatewayStore();
  });

  it('persists the full proof + public signals with the accepted call', async () => {
    await store.recordAcceptedCall(sampleCall(), 'comm-1');
    const [call] = await store.listAcceptedCalls({ onlyPendingSpend: true });
    expect(call).toMatchObject({
      proofHash: 'ph-spend-1',
      nullifier: 'n-spend-1',
      proof: { a: ['1', '2'], b: [['3', '4']], c: ['5', '6'] },
      pubSignals: ['root', 'n-spend-1', 'x', 'y', '20260804'],
    });
  });

  it('excludes spent rows from the pending settlement queue', async () => {
    await store.recordAcceptedCall(
      sampleCall({ proofHash: 'pending-1', nullifier: 'n-pending-1' }),
      'comm-1',
    );
    await store.recordAcceptedCall(
      sampleCall({ proofHash: 'spent-1', nullifier: 'n-spent-1', onChainSpendTx: 'tx-abc', spentOnChain: true }),
      'comm-1',
    );
    const pending = await store.listAcceptedCalls({ onlyPendingSpend: true });
    expect(pending.map((c) => c.proofHash).sort()).toEqual(['pending-1']);
  });
});
