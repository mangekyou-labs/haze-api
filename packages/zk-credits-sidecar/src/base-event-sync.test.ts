import { describe, expect, it, vi } from 'vitest';
import { createBaseEventWitnessProvider, type BaseEventWitnessClient } from './base-event-sync.js';
import { computeCreditLeaf } from '@zk-credits/shared/base';
import { encodeAbiParameters, encodeEventTopics, parseAbi, toHex } from 'viem';

describe('sidecar Base event witness synchronization', () => {
  it('completes witness synchronization through the real HTTP client after transient throttling', async () => {
    const contract = '0x00000000000000000000000000000000000000a1';
    const hash = `0x${'11'.repeat(32)}`;
    const abi = parseAbi(['event BundleFunded(bytes32 indexed commitment, uint8 indexed tierId, uint64 expiry, uint256 leafIndex, uint256 bondAmount, bytes32 root)']);
    const log = { address: contract, blockHash: hash, blockNumber: '0xa', transactionHash: hash, transactionIndex: '0x0', logIndex: '0x0', removed: false,
      topics: encodeEventTopics({ abi, eventName: 'BundleFunded', args: { commitment: toHex(123n, { size: 32 }), tierId: 0n } }),
      data: encodeAbiParameters([{ type: 'uint64' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }], [1800000000n, 0n, 20000000n, toHex(1n, { size: 32 })]),
    };
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '1' } }))
      .mockImplementation(async (_, init) => {
        const body = JSON.parse(init!.body as string);
        const result = body.method === 'eth_blockNumber' ? '0xa' : body.method === 'eth_getLogs' ? [log] : { hash, number: '0xa' };
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
      });
    try {
      const provider = createBaseEventWitnessProvider({ rpcUrl: 'https://rpc.invalid', contractAddress: contract, confirmations: 0n });
      const pending = provider.witnessForCredential({ version: 1, secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', commitment: '123', tierId: 0, expiry: 1800000000, deploymentDomain: '84532' });
      expect(await pending).toMatchObject({ expiry: 1800000000, pathIndices: Array(20).fill(0) });
      expect(fetch).toHaveBeenCalledTimes(4);
    } finally { fetch.mockRestore(); }
  });
  it('shares one sync across concurrent witness requests and can recover after an RPC failure', async () => {
    const client = {
      getBlockNumber: vi.fn().mockRejectedValueOnce(new Error('RPC unavailable')).mockResolvedValue(10n),
      getBlock: vi.fn().mockResolvedValue({ hash: `0x${'11'.repeat(32)}` }),
      getLogs: vi.fn().mockResolvedValue([{ args: { commitment: 123n, tierId: 0n, expiry: 1800000000n, leafIndex: 0n } }]),
    };
    const provider = createBaseEventWitnessProvider({ rpcUrl: 'https://rpc.invalid', contractAddress: '0x00000000000000000000000000000000000000a1', confirmations: 0n, client });
    const credential = { version: 1, secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', commitment: '123', tierId: 0, expiry: 1800000000, deploymentDomain: '84532' };
    await expect(provider.witnessForCredential(credential)).rejects.toThrow('RPC request failed');
    const witnesses = await Promise.all([provider.witnessForCredential(credential), provider.witnessForCredential(credential)]);
    expect(witnesses[0]).toEqual(witnesses[1]);
    expect(client.getBlockNumber).toHaveBeenCalledTimes(2);
    expect(client.getLogs).toHaveBeenCalledOnce();
  });
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

it('redacts provider errors and explains how to replace a rate-limited RPC', async () => {
  const client: BaseEventWitnessClient = {
    async getBlockNumber() { throw new Error('HTTP 429 https://provider.example/private-key'); },
    async getBlock() { return {}; }, async getLogs() { return []; },
  };
  const provider = createBaseEventWitnessProvider({ rpcUrl: 'https://provider.example/private-key', contractAddress: '0x00000000000000000000000000000000000000a1', client });
  const request = provider.witnessForCredential({ version: 1, secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', commitment: '123', tierId: 0, expiry: 1800000000, deploymentDomain: '84532' });
  await expect(request).rejects.toThrow(/zk-credits config rpc/);
  await expect(request).rejects.not.toThrow(/private-key/);
});
