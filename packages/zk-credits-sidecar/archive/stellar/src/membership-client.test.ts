import { describe, expect, it, vi } from 'vitest';
import { mimcHash, skToField } from '@zk-credits/shared';
import { MembershipClient } from './membership-client.js';

async function snapshotFor(secretK: Uint8Array) {
  const commitment = await mimcHash([BigInt(skToField(secretK))]);
  const leaves = [commitment, '0', '0', '0', '0', '0', '0', '0'];
  const level1 = [
    await mimcHash([BigInt(leaves[0]!), 0n]),
    '0',
    '0',
    '0',
  ];
  const level2 = [await mimcHash([BigInt(level1[0]!), 0n]), '0'];
  const root = await mimcHash([BigInt(level2[0]!), 0n]);
  return { root, depth: 3, leaves, layers: [leaves, level1, level2, [root]] };
}

describe('MembershipClient', () => {
  it('derives a local witness from a parameter-free snapshot that matches the reported chain root', async () => {
    const secretK = new Uint8Array(32).fill(9);
    const snapshot = await snapshotFor(secretK);
    const fetch = vi.fn(async (input: string) => new Response(JSON.stringify(
      input.endsWith('/v1/contract-status')
        ? { currentRoot: snapshot.root }
        : { ...snapshot, generatedAt: new Date().toISOString() },
    ), { status: 200 }));
    const client = new MembershipClient('https://gateway.example', fetch);

    const witness = await client.witnessForSecret(secretK);

    expect(witness).toMatchObject({ root: snapshot.root, leafIndex: 0 });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://gateway.example/v1/contract-status',
      'https://gateway.example/v1/membership-tree',
    ]);
  });

  it('rejects a snapshot that disagrees with the current chain root', async () => {
    const secretK = new Uint8Array(32).fill(10);
    const snapshot = await snapshotFor(secretK);
    const fetch = vi.fn(async (input: string) => new Response(JSON.stringify(
      input.endsWith('/v1/contract-status')
        ? { currentRoot: '123' }
        : { ...snapshot, generatedAt: new Date().toISOString() },
    ), { status: 200 }));
    const client = new MembershipClient('https://gateway.example', fetch);

    await expect(client.witnessForSecret(secretK)).rejects.toThrow('does not match the current chain root');
  });
});
