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

  it('splits scans at the provider-compatible maximum block range', async () => {
    const ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
    const client = {
      async getBlockNumber() { return 25n; },
      async getBlock({ blockNumber }: { blockNumber: bigint }) {
        return { hash: (`0x${blockNumber.toString(16).padStart(64, '0')}`) as Hex };
      },
      async getLogs(args: { fromBlock: bigint; toBlock: bigint }) {
        ranges.push({ fromBlock: args.fromBlock, toBlock: args.toBlock });
        if (args.toBlock - args.fromBlock + 1n > 10n) throw new Error('provider_range_limit');
        return [];
      },
    };
    const store = new MemoryBaseEventStore({ contractAddress: CONTRACT, deploymentBlock: 1n });
    const sync = new BaseContractEventSynchronizer({
      contractAddress: CONTRACT,
      client,
      store,
      confirmations: 0n,
      maxBlockRange: 10n,
    });

    const state = await sync.syncOnce();

    expect(ranges).toEqual([
      { fromBlock: 1n, toBlock: 10n },
      { fromBlock: 11n, toBlock: 20n },
      { fromBlock: 21n, toBlock: 25n },
    ]);
    expect(state.lastScannedBlock).toBe(25n);
  });

  it('seeds the constructor root when no root event was emitted', async () => {
    const blockHash = '0x3333333333333333333333333333333333333333333333333333333333333333' as Hex;
    const client = {
      async getBlockNumber() { return 10n; },
      async getBlock() { return { hash: blockHash }; },
      async getLogs() { return []; },
    };
    const store = new MemoryBaseEventStore({
      contractAddress: CONTRACT,
      lastScannedBlock: 10n,
      lastScannedBlockHash: blockHash,
    });
    const sync = new BaseContractEventSynchronizer({
      contractAddress: CONTRACT,
      client,
      store,
      confirmations: 0n,
      initialRoot: '0x0000000000000000000000000000000000000000000000000000000000000002',
    });

    const state = await sync.syncOnce();

    expect(state.currentRoot).toBe('2');
    expect(state.knownRoots).toEqual(['2']);
  });
});
