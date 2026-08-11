import { describe, expect, it } from 'vitest';
import { MemoryGatewayStore } from './db/gateway.js';
import { MerkleTree } from './merkle.js';
import {
  bootstrapMembershipTreeFromLeaves,
  bootstrapMembershipTreeFromSnapshot,
  parseMembershipTreeBootstrapSnapshot,
  reconstructMembershipTreeFromStore,
} from './membership-tree.js';

describe('reconstructMembershipTreeFromStore', () => {
  it('parses a full bootstrap snapshot without reducing it to a leaf-only tree', () => {
    const snapshot = {
      leaves: ['0', '0', '303', '0', '0', '0', '0', '0'],
      layers: [
        ['0', '0', '303', '0', '0', '0', '0', '0'],
        ['123', '456', '0', '0'],
        ['789', '0'],
        ['999'],
      ],
    };

    expect(parseMembershipTreeBootstrapSnapshot(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('promotes a chain-confirmed pending leaf after a restart', async () => {
    const store = new MemoryGatewayStore();
    const firstTree = new MerkleTree();
    const firstRoot = await firstTree.insert(101n);
    await store.reserveMembershipLeaf({
      leafIndex: 0,
      commitment: '101',
      candidateRoot: firstRoot.toString(),
    });
    await store.activateMembershipLeaf(
      0,
      firstRoot.toString(),
      firstTree.getLayers().map((layer) => layer.map(String)),
    );

    const chainTree = firstTree.clone();
    const chainRoot = await chainTree.insert(202n);
    await store.reserveMembershipLeaf({
      leafIndex: 1,
      commitment: '202',
      candidateRoot: chainRoot.toString(),
    });

    const restored = await reconstructMembershipTreeFromStore(store, chainRoot.toString());

    expect(restored.root()).toBe(chainRoot);
    expect(restored.getLeaves().map(String)).toEqual(['101', '202', '0', '0', '0', '0', '0', '0']);
    expect(await store.getMembershipTreeState()).toMatchObject({
      root: chainRoot.toString(),
      version: 2,
    });
    expect(await store.listMembershipLeaves()).toMatchObject([
      { leafIndex: 0, status: 'active' },
      { leafIndex: 1, status: 'active' },
    ]);
  });

  it('fails closed when persisted leaves cannot reproduce the active chain root', async () => {
    const store = new MemoryGatewayStore();
    await store.reserveMembershipLeaf({
      leafIndex: 0,
      commitment: '101',
      candidateRoot: 'not-a-real-root',
    });

    await expect(reconstructMembershipTreeFromStore(store, 'unexpected-chain-root'))
      .rejects.toThrow(/membership tree root mismatch/i);
  });

  it('bootstraps an empty durable store only from an exact public snapshot', async () => {
    const store = new MemoryGatewayStore();
    const snapshot = await MerkleTree.fromLeaves(['101', '0', '303', '0', '0', '0', '0', '0']);

    await bootstrapMembershipTreeFromLeaves(
      store,
      snapshot.getLeaves().map(String),
      snapshot.root().toString(),
    );

    expect(await store.listMembershipLeaves()).toMatchObject([
      { leafIndex: 0, commitment: '101', status: 'active' },
      { leafIndex: 2, commitment: '303', status: 'active' },
    ]);
    expect(await store.getMembershipTreeState()).toMatchObject({
      root: snapshot.root().toString(),
      version: 1,
    });
  });

  it('bootstraps a post-removal tree from public layers without canonicalizing zero branches', async () => {
    const store = new MemoryGatewayStore();
    const original = new MerkleTree();
    await original.setLeaf(0, 101n);
    await original.setLeaf(2, 303n);
    const removed = original.clone();
    await removed.setLeaf(0, 0n);
    const snapshot = {
      leaves: removed.getLeaves().map(String),
      layers: removed.getLayers().map((layer) => layer.map(String)),
    };
    const canonicalFromLeaves = await MerkleTree.fromLeaves(snapshot.leaves);
    expect(canonicalFromLeaves.root()).not.toBe(removed.root());

    await bootstrapMembershipTreeFromSnapshot(store, snapshot, removed.root().toString());

    await expect(reconstructMembershipTreeFromStore(store, removed.root().toString()))
      .resolves.toMatchObject({});
    expect(await store.getMembershipTreeState()).toMatchObject({
      root: removed.root().toString(),
      version: 1,
      layers: snapshot.layers,
    });
    expect(await store.listMembershipLeaves()).toMatchObject([
      { leafIndex: 2, commitment: '303', status: 'active' },
    ]);
  });
});
