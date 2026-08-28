import { describe, expect, it } from 'vitest';
import { MemoryGatewayStore } from './db/gateway.js';
import { MerkleTree } from './merkle.js';
import {
  bootstrapMembershipTreeFromLeaves,
  bootstrapMembershipTreeFromSnapshot,
  parseMembershipTreeBootstrapSnapshot,
  reconstructMembershipTreeFromStore,
  repairMembershipTreeFromSnapshot,
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

  it('reconstructs active tree state from legacy hex commitment representation', async () => {
    const store = new MemoryGatewayStore();
    const tree = new MerkleTree();
    const hexCommitment = '0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c';
    const root = (await tree.insert(BigInt(hexCommitment))).toString();

    // Store holds legacy hex string, state holds computed layers
    await store.reserveMembershipLeaf({
      leafIndex: 0,
      commitment: hexCommitment,
      candidateRoot: root,
    });
    await store.activateMembershipLeaf(
      0,
      root,
      tree.getLayers().map((layer) => layer.map(String)),
    );

    const restored = await reconstructMembershipTreeFromStore(store, root);
    expect(restored.root().toString()).toBe(root);
    expect(restored.getLeaf(0)).toBe(BigInt(hexCommitment));
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

  it('repairs a stale durable store via atomic CAS when expected stale root matches', async () => {
    const store = new MemoryGatewayStore();
    const staleTree = new MerkleTree();
    const staleRoot = (await staleTree.insert(101n)).toString();
    await store.reserveMembershipLeaf({
      leafIndex: 0,
      commitment: '101',
      candidateRoot: staleRoot,
    });
    await store.activateMembershipLeaf(
      0,
      staleRoot,
      staleTree.getLayers().map((layer) => layer.map(String)),
    );

    const freshTree = staleTree.clone();
    const freshRoot = (await freshTree.insert(202n)).toString();
    const freshSnapshot = {
      leaves: freshTree.getLeaves().map(String),
      layers: freshTree.getLayers().map((layer) => layer.map(String)),
    };

    // Repair with matching stale root succeeds
    const repaired = await repairMembershipTreeFromSnapshot(
      store,
      freshSnapshot,
      staleRoot,
      freshRoot,
    );
    expect(repaired.root().toString()).toBe(freshRoot);
    expect(await store.listMembershipLeaves()).toMatchObject([
      { leafIndex: 0, commitment: '101', status: 'active' },
      { leafIndex: 1, commitment: '202', status: 'active' },
    ]);
    expect(await store.getMembershipTreeState()).toMatchObject({
      root: freshRoot,
      version: 1,
    });
  });

  it('refuses CAS repair and does not mutate store when expected stale root does not match', async () => {
    const store = new MemoryGatewayStore();
    const staleTree = new MerkleTree();
    const staleRoot = (await staleTree.insert(101n)).toString();
    await store.reserveMembershipLeaf({
      leafIndex: 0,
      commitment: '101',
      candidateRoot: staleRoot,
    });
    await store.activateMembershipLeaf(
      0,
      staleRoot,
      staleTree.getLayers().map((layer) => layer.map(String)),
    );

    const freshTree = staleTree.clone();
    const freshRoot = (await freshTree.insert(202n)).toString();
    const freshSnapshot = {
      leaves: freshTree.getLeaves().map(String),
      layers: freshTree.getLayers().map((layer) => layer.map(String)),
    };

    // Refuse when wrong stale root passed
    await expect(
      repairMembershipTreeFromSnapshot(store, freshSnapshot, 'wrong-stale-root', freshRoot),
    ).rejects.toThrow(/CAS repair expected stale DB root/);

    // Verify no mutation occurred
    expect(await store.listMembershipLeaves()).toMatchObject([
      { leafIndex: 0, commitment: '101', status: 'active' },
    ]);
    expect((await store.getMembershipTreeState())?.root).toBe(staleRoot);
  });

  it('refuses CAS repair when snapshot root does not match active chain root', async () => {
    const store = new MemoryGatewayStore();
    const staleTree = new MerkleTree();
    const staleRoot = (await staleTree.insert(101n)).toString();
    await store.reserveMembershipLeaf({
      leafIndex: 0,
      commitment: '101',
      candidateRoot: staleRoot,
    });
    await store.activateMembershipLeaf(
      0,
      staleRoot,
      staleTree.getLayers().map((layer) => layer.map(String)),
    );

    const freshTree = staleTree.clone();
    await freshTree.insert(202n);
    const freshSnapshot = {
      leaves: freshTree.getLeaves().map(String),
      layers: freshTree.getLayers().map((layer) => layer.map(String)),
    };

    // Refuse when chainRoot does not match snapshot root
    await expect(
      repairMembershipTreeFromSnapshot(store, freshSnapshot, staleRoot, 'different-chain-root'),
    ).rejects.toThrow(/Membership tree root mismatch/);
  });
});
