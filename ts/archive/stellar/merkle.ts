// Off-chain Merkle tree — mirrors the on-chain tree for computing new roots.
// The circuits are compiled with `-p bls12381`, so the MiMCSponge arithmetic
// must use BLS12-381 Fr. circomlibjs exposes the standard round constants but
// its convenience hash is BN254-only; the field arithmetic below is local.

import { buildMimcSponge } from 'circomlibjs';

const TREE_DEPTH = 3;
const ZERO_VALUE = BigInt(0);
const MIMC_ROUNDS = 220;
const FIELD_ORDER = BigInt(
  '0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001',
);

let mimcConstantsPromise: Promise<bigint[]> | null = null;

async function getMimcConstants(): Promise<bigint[]> {
  if (!mimcConstantsPromise) {
    mimcConstantsPromise = buildMimcSponge().then((mimc) =>
      mimc.cts.map((constant) => BigInt(mimc.F.toObject(constant).toString())),
    );
  }
  return mimcConstantsPromise;
}

export function frOrder(): bigint {
  return FIELD_ORDER;
}

function mod(value: bigint): bigint {
  return value % FIELD_ORDER;
}

function pow5(value: bigint): bigint {
  const square = mod(value * value);
  return mod(mod(square * square) * value);
}

function mimcFeistel(
  xLInput: bigint,
  xRInput: bigint,
  constants: bigint[],
): { xL: bigint; xR: bigint } {
  let xL = mod(xLInput);
  let xR = mod(xRInput);

  for (let round = 0; round < MIMC_ROUNDS; round++) {
    const roundConstant = round === 0 || round === MIMC_ROUNDS - 1
      ? 0n
      : constants[round];
    const t = mod(xL + roundConstant);
    const xRPrevious = xR;

    if (round < MIMC_ROUNDS - 1) {
      xR = xL;
      xL = mod(xRPrevious + pow5(t));
    } else {
      xR = mod(xRPrevious + pow5(t));
    }
  }

  return { xL, xR };
}

async function hash(left: bigint, right: bigint): Promise<bigint> {
  const constants = await getMimcConstants();
  let rate = 0n;
  let capacity = 0n;

  for (const input of [left, right]) {
    rate = mod(rate + input);
    const state = mimcFeistel(rate, capacity, constants);
    rate = state.xL;
    capacity = state.xR;
  }

  return rate;
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

  static async fromLeaves(leaves: readonly (bigint | string)[]): Promise<MerkleTree> {
    if (leaves.length !== 2 ** TREE_DEPTH) {
      throw new Error(`Expected ${2 ** TREE_DEPTH} Merkle leaves, got ${leaves.length}`);
    }

    const tree = new MerkleTree();
    for (let index = 0; index < leaves.length; index++) {
      const rawLeaf = leaves[index]!;
      const leaf = typeof rawLeaf === 'bigint' ? rawLeaf : BigInt(rawLeaf);
      if (leaf < ZERO_VALUE || leaf >= FIELD_ORDER) {
        throw new Error(`Invalid Merkle leaf at index ${index}`);
      }
      if (leaf !== ZERO_VALUE) await tree.setLeaf(index, leaf);
    }
    return tree;
  }

  static async fromLayers(layers: readonly (readonly (bigint | string)[])[]): Promise<MerkleTree> {
    if (layers.length !== TREE_DEPTH + 1) {
      throw new Error(`Expected ${TREE_DEPTH + 1} Merkle layers, got ${layers.length}`);
    }

    const parsed = layers.map((layer, level) => {
      const expectedLength = 2 ** (TREE_DEPTH - level);
      if (layer.length !== expectedLength) {
        throw new Error(`Expected ${expectedLength} Merkle nodes at level ${level}, got ${layer.length}`);
      }
      return layer.map((raw, index) => {
        const value = typeof raw === 'bigint' ? raw : BigInt(raw);
        if (value < ZERO_VALUE || value >= FIELD_ORDER) {
          throw new Error(`Invalid Merkle node at level ${level}, index ${index}`);
        }
        return value;
      });
    });

    const zeroParent = await hash(ZERO_VALUE, ZERO_VALUE);
    for (let level = 0; level < TREE_DEPTH; level++) {
      for (let index = 0; index < parsed[level + 1]!.length; index++) {
        const left = parsed[level]![index * 2]!;
        const right = parsed[level]![index * 2 + 1]!;
        const parent = parsed[level + 1]![index]!;
        if (left === ZERO_VALUE && right === ZERO_VALUE) {
          if (parent !== ZERO_VALUE && parent !== zeroParent) {
            throw new Error(`Invalid empty Merkle branch at level ${level}, index ${index}`);
          }
        } else if (parent !== await hash(left, right)) {
          throw new Error(`Invalid Merkle parent at level ${level}, index ${index}`);
        }
      }
    }

    const tree = Object.create(MerkleTree.prototype) as MerkleTree;
    tree.layers = parsed;
    return tree;
  }

  async insert(leaf: bigint): Promise<bigint> {
    const index = this.layers[0].indexOf(ZERO_VALUE);
    if (index === -1) throw new Error('Tree is full');

    return this.setLeaf(index, leaf);
  }

  async setLeaf(index: number, leaf: bigint): Promise<bigint> {
    if (!Number.isInteger(index) || index < 0 || index >= this.layers[0].length) {
      throw new Error(`Invalid Merkle leaf index: ${index}`);
    }
    if (leaf < ZERO_VALUE || leaf >= FIELD_ORDER) {
      throw new Error(`Invalid Merkle leaf at index ${index}`);
    }

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

  getLeaf(index: number): bigint {
    if (!Number.isInteger(index) || index < 0 || index >= this.layers[0].length) {
      throw new Error(`Invalid Merkle leaf index: ${index}`);
    }
    return this.layers[0][index];
  }

  getLeaves(): bigint[] {
    return [...this.layers[0]];
  }

  getLayers(): bigint[][] {
    return this.layers.map((layer) => [...layer]);
  }

  clone(): MerkleTree {
    const copy = Object.create(MerkleTree.prototype) as MerkleTree;
    copy.layers = this.layers.map((layer) => [...layer]);
    return copy;
  }

  replaceWith(tree: MerkleTree): void {
    this.layers = tree.layers.map((layer) => [...layer]);
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
