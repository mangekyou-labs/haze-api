import { describe, expect, it } from 'vitest';
import { createBaseEventWitnessProvider, type BaseEventWitnessClient } from './base-event-sync.js';
import { computeCreditLeaf } from '@zk-credits/shared/base';

describe('sidecar Base event witness synchronization', () => {
  it('indexes public BundleFunded events and builds a sparse witness', async () => {
    const commitment = '123';
    const expiry = 1_800_000_000;
    const leaf = await computeCreditLeaf(commitment, 0, expiry);
    const client: BaseEventWitnessClient = {
      async getBlockNumber() { return 10n; },
      async getBlock() { return { hash: '0x1111111111111111111111111111111111111111111111111111111111111111' }; },
      async getLogs() {
        return [{ args: { commitment: BigInt(commitment), tierId: 0n, expiry: BigInt(expiry), leafIndex: 0n } }];
      },
    };
    const provider = createBaseEventWitnessProvider({
      rpcUrl: 'http://localhost:8545',
      contractAddress: '0x00000000000000000000000000000000000000a1',
      confirmations: 0n,
      client,
    });
    const witness = await provider.witnessForCredential({
      version: 1,
      secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      commitment,
      tierId: 0,
      expiry,
      deploymentDomain: '84532',
    });
    expect(witness.root).toMatch(/^\d+$/u);
    expect(witness.pathElements).toHaveLength(20);
    expect(witness.pathIndices).toEqual(Array.from({ length: 20 }, () => 0));
    expect(witness.expiry).toBe(expiry);
    expect(leaf).toMatch(/^\d+$/u);
  });
});
