import { describe, it, expect } from 'vitest';
import { MerkleTree, frOrder } from './merkle.js';
import { groth16 } from 'snarkjs';
import { resolve } from 'node:path';

const CIRCUITS_DIR = resolve(import.meta.dirname!, '..', 'circuits');

describe('MerkleTree', () => {
  it('starts with zero root', () => {
    const tree = new MerkleTree();
    expect(tree.root()).toBe(BigInt(0));
  });

  it('starts with 0 leaves', () => {
    const tree = new MerkleTree();
    expect(tree.getLeafCount()).toBe(0);
  });

  it('insert returns a non-zero root', async () => {
    const tree = new MerkleTree();
    const root = await tree.insert(BigInt(42));
    expect(root).not.toBe(BigInt(0));
  });

  it('insert increments leaf count', async () => {
    const tree = new MerkleTree();
    await tree.insert(BigInt(1));
    expect(tree.getLeafCount()).toBe(1);
    await tree.insert(BigInt(2));
    expect(tree.getLeafCount()).toBe(2);
  });

  it('different leaves produce different roots', async () => {
    const tree1 = new MerkleTree();
    const tree2 = new MerkleTree();
    const root1 = await tree1.insert(BigInt(1));
    const root2 = await tree2.insert(BigInt(2));
    expect(root1).not.toBe(root2);
  });

  it('same leaf produces same root (deterministic)', async () => {
    const tree1 = new MerkleTree();
    const tree2 = new MerkleTree();
    const root1 = await tree1.insert(BigInt(42));
    const root2 = await tree2.insert(BigInt(42));
    expect(root1).toBe(root2);
  });

  it('root changes after each insert', async () => {
    const tree = new MerkleTree();
    const root1 = await tree.insert(BigInt(1));
    const root2 = await tree.insert(BigInt(2));
    expect(root1).not.toBe(root2);
  });

  it('fills up to capacity (2^depth = 8)', async () => {
    const tree = new MerkleTree();
    for (let i = 0; i < 8; i++) {
      await tree.insert(BigInt(i + 1));
    }
    expect(tree.getLeafCount()).toBe(8);
  });

  it('throws when tree is full', async () => {
    const tree = new MerkleTree();
    for (let i = 0; i < 8; i++) {
      await tree.insert(BigInt(i + 1));
    }
    await expect(tree.insert(BigInt(99))).rejects.toThrow('Tree is full');
  });

  it('root fits in BLS12-381 Fr', async () => {
    const tree = new MerkleTree();
    const root = await tree.insert(BigInt(42));
    expect(root).toBeLessThan(frOrder());
  });

  it('matches the BLS12-381 MiMC root produced by the RLN circuit', async () => {
    const { publicSignals } = await groth16.fullProve(
      {
        secret_k: '12345',
        merkle_path_elements: ['0', '0', '0'],
        merkle_path_indices: ['0', '0', '0'],
      },
      resolve(CIRCUITS_DIR, 'deposit_membership.wasm'),
      resolve(CIRCUITS_DIR, 'deposit_membership_final.zkey'),
    );
    const tree = new MerkleTree();
    const root = await tree.insert(BigInt(publicSignals[1]));

    expect(root.toString()).toBe(publicSignals[0]);
  }, 120_000);
});
