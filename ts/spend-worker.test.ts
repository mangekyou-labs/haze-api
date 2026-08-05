// Spend-worker tests (M2.6). The worker is DI-driven (injected store +
// submitSpend) so the whole queue-drain behavior is tested offline.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryGatewayStore, type AcceptedCall } from './db/index.js';
import {
  drainSpendQueue,
  startSpendWorker,
  NullifierAlreadySpentError,
  type SpendSubmitter,
} from './spend-worker.js';

function sampleCall(over: Partial<AcceptedCall> = {}): AcceptedCall {
  return {
    proofHash: 'ph-1',
    nullifier: 'n-1',
    epoch: 20260804,
    slot: 0,
    nonceHash: 'nh-1',
    acceptedAt: new Date('2026-08-04T10:00:00Z'),
    proof: { a: '1' },
    pubSignals: ['root', 'n-1', 'x', 'y', '20260804'],
    ...over,
  };
}

describe('drainSpendQueue', () => {
  let store: MemoryGatewayStore;
  let submitSpend: ReturnType<typeof vi.fn> & SpendSubmitter;

  beforeEach(() => {
    store = new MemoryGatewayStore();
    submitSpend = vi.fn().mockResolvedValue('tx-hash-1') as unknown as SpendSubmitter;
  });

  it('submits pending spend() and records the tx hash', async () => {
    await store.recordAcceptedCall(sampleCall(), 'comm-1');
    const settled = await drainSpendQueue({ store, secretKey: 'sk', submitSpend });
    expect(settled).toBe(1);
    expect(submitSpend).toHaveBeenCalledWith('sk', { a: '1' }, ['root', 'n-1', 'x', 'y', '20260804']);

    const [call] = await store.listAcceptedCalls();
    expect(call.onChainSpendTx).toBe('tx-hash-1');
    expect(call.spentOnChain).toBe(true);
    // Durable nullifier spent-on-chain record set by markSpendResult.
    expect((await store.getNullifier('n-1'))?.spentOnChain).toBe(true);
  });

  it('marks a NullifierAlreadySpent error as spent without retrying forever', async () => {
    await store.recordAcceptedCall(sampleCall(), 'comm-1');
    submitSpend.mockRejectedValueOnce(new NullifierAlreadySpentError());
    const settled = await drainSpendQueue({ store, secretKey: 'sk', submitSpend });
    expect(settled).toBe(1);
    const [call] = await store.listAcceptedCalls();
    expect(call.spentOnChain).toBe(true);
    expect(call.onChainSpendTx).toBe('already-spent');
  });

  it('leaves a call pending on transient submit failure', async () => {
    await store.recordAcceptedCall(sampleCall(), 'comm-1');
    submitSpend.mockRejectedValueOnce(new Error('network timeout'));
    const settled = await drainSpendQueue({ store, secretKey: 'sk', submitSpend });
    expect(settled).toBe(0);
    const pending = await store.listAcceptedCalls({ onlyPendingSpend: true });
    expect(pending).toHaveLength(1);
  });

  it('does not double-submit a call that was already marked spent', async () => {
    await store.recordAcceptedCall(
      sampleCall({ proofHash: 'ph-spent-1', nullifier: 'n-spent-1', onChainSpendTx: 'tx-abc', spentOnChain: true }),
      'comm-1',
    );
    const settled = await drainSpendQueue({ store, secretKey: 'sk', submitSpend });
    expect(settled).toBe(0);
    expect(submitSpend).not.toHaveBeenCalled();
  });

  it('skips rows without a persisted proof (pre-M2.6) without blocking', async () => {
    await store.recordAcceptedCall(
      sampleCall({ proofHash: 'ph-noproof', nullifier: 'n-noproof', proof: null, pubSignals: null }),
      'comm-1',
    );
    const settled = await drainSpendQueue({ store, secretKey: 'sk', submitSpend });
    expect(settled).toBe(0);
    expect(submitSpend).not.toHaveBeenCalled();
  });
});

describe('startSpendWorker', () => {
  it('polls on an interval and stop() halts timers', async () => {
    const store = new MemoryGatewayStore();
    await store.recordAcceptedCall(sampleCall(), 'comm-1');
    const submitSpend = vi.fn().mockResolvedValue('tx-1') as unknown as SpendSubmitter;
    const onTick = vi.fn();

    const worker = startSpendWorker({ store, secretKey: 'sk', submitSpend, onTick }, 20);
    await new Promise((r) => setTimeout(r, 120));
    worker.stop();

    expect(submitSpend.mock.calls.length).toBeGreaterThanOrEqual(1);
    const [call] = await store.listAcceptedCalls();
    expect(call.spentOnChain).toBe(true);
  });
});
