import { describe, expect, it } from 'vitest';
import { encodeEventTopics, type Hex } from 'viem';
import {
  BASE_BOND_EVENT_ABI,
  BaseContractEventSynchronizer,
  MemoryBaseEventStore,
} from './base-event-sync.js';

const CONTRACT = '0x00000000000000000000000000000000000000a1';

function rootEvent(root: Hex, tx: Hex, blockHash: Hex, blockNumber = 10n) {
  return {
    blockNumber,
    blockHash,
    transactionHash: tx,
    logIndex: 0,
    data: '0x' as Hex,
    topics: encodeEventTopics({
      abi: BASE_BOND_EVENT_ABI,
      eventName: 'MerkleRootUpdated',
      args: [root, 1n],
    }),
  };
}

describe('Base contract event synchronization', () => {
  it('indexes finalized roots idempotently and survives a reorg', async () => {
    let logs = [rootEvent('0x0000000000000000000000000000000000000000000000000000000000000001', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '0x1111111111111111111111111111111111111111111111111111111111111111')];
    let canonicalHash: Hex = '0x1111111111111111111111111111111111111111111111111111111111111111';
    const client = {
      async getBlockNumber() { return 10n; },
      async getBlock() { return { hash: canonicalHash }; },
      async getLogs() { return logs; },
    };
    const store = new MemoryBaseEventStore({ contractAddress: CONTRACT, currentRoot: '0', knownRoots: ['0'] });
    const sync = new BaseContractEventSynchronizer({ contractAddress: CONTRACT, client, store, confirmations: 0n });

    let state = await sync.syncOnce(1000);
    expect(state.currentRoot).toBe('1');
    expect(state.knownRoots).toEqual(['0', '1']);
    state = await sync.syncOnce(2000);
    expect(state.currentRoot).toBe('1');

    canonicalHash = '0x2222222222222222222222222222222222222222222222222222222222222222';
    logs = [rootEvent('0x0000000000000000000000000000000000000000000000000000000000000002', '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', canonicalHash)];
    state = await sync.syncOnce(3000);
    expect(state.currentRoot).toBe('2');
    expect(state.knownRoots).toEqual(['0', '2']);
    expect((await store.listEvents(CONTRACT))).toHaveLength(1);
  });
});
