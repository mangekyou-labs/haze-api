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
