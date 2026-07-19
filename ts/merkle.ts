// Off-chain Merkle tree — mirrors the on-chain tree for computing new roots.
// Uses MiMCSponge (same hash as the Circom circuits) with arity-2, depth-3.

import { buildMimcSponge } from 'circomlibjs';

const TREE_DEPTH = 3;
const ZERO_VALUE = BigInt(0);

let mimc: Awaited<ReturnType<typeof buildMimcSponge>> | null = null;

async function getMimc() {
  if (!mimc) {
    mimc = await buildMimcSponge();
  }
  return mimc;
}

export function frOrder(): bigint {
  return BigInt('0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001');
}

async function hash(left: bigint, right: bigint): Promise<bigint> {
  const m = await getMimc();
  const result = m.F.e(m.multiHash([left, right]));
  // result is a Uint8Array — convert to bigint
  let val = BigInt(0);
  for (let i = 0; i < result.length; i++) {
    val = (val << BigInt(8)) | BigInt(result[i]);
  }
  return val % frOrder();
}

export class MerkleTree {
  private layers: bigint[][];

  constructor() {
    // Build empty tree
    this.layers = [];
    let current = ZERO_VALUE;
    const layer0: bigint[] = [];
    for (let i = 0; i < 2 ** TREE_DEPTH; i++) {
      layer0.push(ZERO_VALUE);
    }
    this.layers.push(layer0);

    for (let level = 1; level <= TREE_DEPTH; level++) {
      const prev = this.layers[level - 1];
      const next: bigint[] = [];
      for (let i = 0; i < prev.length; i += 2) {
        // Synchronous zero-hash for empty tree initialization
        next.push(ZERO_VALUE);
      }
      this.layers.push(next);
    }
  }

  async insert(leaf: bigint): Promise<bigint> {
    const index = this.layers[0].indexOf(ZERO_VALUE);
    if (index === -1) throw new Error('Tree is full');

    this.layers[0][index] = leaf;

    // Recompute hashes up the tree
    let idx = index;
    for (let level = 0; level < TREE_DEPTH; level++) {
      const left = this.layers[level][idx & ~1];
      const right = this.layers[level][(idx & ~1) | 1];
      const parentIdx = Math.floor(idx / 2);
      this.layers[level + 1][parentIdx] = await hash(left, right);
      idx = parentIdx;
    }

    return this.root();
  }

  root(): bigint {
    return this.layers[TREE_DEPTH][0];
  }

  getLeafCount(): number {
    let count = 0;
    for (const leaf of this.layers[0]) {
      if (leaf !== ZERO_VALUE) count++;
    }
    return count;
  }
}
