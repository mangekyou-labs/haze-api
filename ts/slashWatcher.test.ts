import { describe, expect, it, vi } from 'vitest';
import { nativeToScVal } from '@stellar/stellar-sdk';
import { SlashWatcher } from './slashWatcher.js';

describe('SlashWatcher', () => {
  it('detects a repeated NullifierSpent event and reports the collision', async () => {
    const event = (id: string) => ({
      id,
      type: 'contract' as const,
      contractId: 'CABC',
      topic: [nativeToScVal('NullifierSpent', { type: 'symbol' })],
      value: nativeToScVal([42n, 1000], { type: ['u256', 'u32'] }),
      ledger: 1000,
      ledgerClosedAt: new Date(0).toISOString(),
      transactionIndex: 0,
      operationIndex: 0,
      inSuccessfulContractCall: true,
      txHash: id,
    });
    const getEvents = vi.fn().mockResolvedValue({
      events: [event('first'), event('second')],
      cursor: 'cursor-1',
      latestLedger: 1000,
      oldestLedger: 1,
      latestLedgerCloseTime: new Date(0).toISOString(),
      oldestLedgerCloseTime: new Date(0).toISOString(),
    });
    const onCollision = vi.fn();
    const watcher = new SlashWatcher({
      contractId: 'CABC',
      startLedger: 1,
      eventSource: { getEvents },
      onCollision,
    });

    const collisions = await watcher.pollOnce();

    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toMatchObject({
      nullifier: '42',
      firstEventId: 'first',
      secondEventId: 'second',
    });
    expect(onCollision).toHaveBeenCalledWith(collisions[0]);
    expect(getEvents).toHaveBeenCalledWith({
      filters: [{ type: 'contract', contractIds: ['CABC'] }],
      startLedger: 1,
      limit: 100,
    });
  });

  it('uses the returned cursor for subsequent polls', async () => {
    const getEvents = vi.fn()
      .mockResolvedValueOnce({
        events: [],
        cursor: 'cursor-1',
        latestLedger: 100,
        oldestLedger: 1,
        latestLedgerCloseTime: new Date(0).toISOString(),
        oldestLedgerCloseTime: new Date(0).toISOString(),
      })
      .mockResolvedValueOnce({
        events: [],
        cursor: 'cursor-2',
        latestLedger: 101,
        oldestLedger: 1,
        latestLedgerCloseTime: new Date(0).toISOString(),
        oldestLedgerCloseTime: new Date(0).toISOString(),
      });
    const watcher = new SlashWatcher({
      contractId: 'CABC',
      startLedger: 1,
      eventSource: { getEvents },
    });

    await watcher.pollOnce();
    await watcher.pollOnce();

    expect(getEvents).toHaveBeenNthCalledWith(2, {
      filters: [{ type: 'contract', contractIds: ['CABC'] }],
      cursor: 'cursor-1',
      limit: 100,
    });
  });
});
