// Isomorphic crypto core — shared by the browser (web) and Node (gateway/CLI).
// Pure functions only: no `fs`/`path`/`createRequire`, no Node `Buffer`, no
// `globalThis`/`window` usage. `crypto.getRandomValues` is available in both
// modern browsers and Node 18+.

import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

// BLS12-381 Fr order (matches the Circom circuits and the v1 gateway).
export const FR_ORDER =
  '0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001';

const FIELD_ORDER = BigInt(FR_ORDER);
const MIMC_ROUNDS = 220;
export const MEMBERSHIP_TREE_DEPTH = 3;
const MEMBERSHIP_TREE_CAPACITY = 2 ** MEMBERSHIP_TREE_DEPTH;
let mimcConstantsPromise: Promise<bigint[]> | null = null;

function toHexBytes(secretK: Uint8Array): string {
  return Array.from(secretK)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateSecretK(): Uint8Array {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function deriveMnemonic(secretK: Uint8Array): string {
  return entropyToMnemonic(secretK, wordlist);
}

export function recoverSecretK(mnemonic: string): Uint8Array {
  return mnemonicToEntropy(mnemonic.trim(), wordlist);
}

// Reduce the 32-byte secret_k into the BLS12-381 Fr field as a decimal string.
export function skToField(secretK: Uint8Array): string {
  const val = BigInt('0x' + toHexBytes(secretK));
  return (val % FIELD_ORDER).toString();
}

function mod(value: bigint): bigint {
  const reduced = value % FIELD_ORDER;
  return reduced < 0n ? reduced + FIELD_ORDER : reduced;
}

async function mimcConstants(): Promise<bigint[]> {
  if (!mimcConstantsPromise) {
    const { buildMimcSponge } = await import('circomlibjs');
    mimcConstantsPromise = buildMimcSponge().then((mimc) =>
      mimc.cts.map((constant) => BigInt(mimc.F.toObject(constant).toString())),
    );
  }
  return mimcConstantsPromise;
}

function pow5(value: bigint): bigint {
  const square = mod(value * value);
  return mod(mod(square * square) * value);
}

function mimcFeistel(
  leftInput: bigint,
  rightInput: bigint,
  constants: bigint[],
): { left: bigint; right: bigint } {
  let left = mod(leftInput);
  let right = mod(rightInput);

  for (let round = 0; round < MIMC_ROUNDS; round += 1) {
    const constant = round === 0 || round === MIMC_ROUNDS - 1 ? 0n : constants[round];
    const previousRight = right;
    const powered = pow5(left + constant);
    if (round < MIMC_ROUNDS - 1) {
      right = left;
      left = mod(previousRight + powered);
    } else {
      right = mod(previousRight + powered);
    }
  }

  return { left, right };
}

/** MiMCSponge with the same BLS12-381 Fr arithmetic as the Circom circuits. */
export async function mimcHash(inputs: readonly bigint[]): Promise<string> {
  if (inputs.length === 0) throw new Error('MiMCSponge requires an input');
  const constants = await mimcConstants();
  let rate = 0n;
  let capacity = 0n;
  for (const input of inputs) {
    rate = mod(rate + input);
    const state = mimcFeistel(rate, capacity, constants);
    rate = state.left;
    capacity = state.right;
  }
  return rate.toString();
}

export interface PublicMembershipSnapshot {
  root: string;
  depth: number;
  leaves: string[];
  /**
   * Public node layers preserve zero-branch hashes after a removal. Older
   * additive-only snapshots can omit this and are reconstructed from leaves.
   */
  layers?: string[][];
  generatedAt?: string;
}

export interface MembershipWitness {
  root: string;
  leafIndex: number;
  merklePathElements: string[];
  merklePathIndices: string[];
}

function normalizeField(value: string, label: string): string {
  let field: bigint;
  try {
    field = BigInt(value);
  } catch {
    throw new Error(`Invalid ${label}`);
  }
  if (field < 0n || field >= FIELD_ORDER) throw new Error(`Invalid ${label}`);
  return field.toString();
}

async function setSnapshotLeaf(layers: string[][], leafIndex: number, leaf: string): Promise<void> {
  layers[0]![leafIndex] = leaf;
  let index = leafIndex;
  for (let level = 0; level < MEMBERSHIP_TREE_DEPTH; level++) {
    const left = BigInt(layers[level]![index & ~1]!);
    const right = BigInt(layers[level]![(index & ~1) | 1]!);
    const parentIndex = Math.floor(index / 2);
    layers[level + 1]![parentIndex] = await mimcHash([left, right]);
    index = parentIndex;
  }
}

async function normalizedSnapshotLayers(snapshot: PublicMembershipSnapshot): Promise<string[][]> {
  if (snapshot.depth !== MEMBERSHIP_TREE_DEPTH) {
    throw new Error(`Unsupported membership-tree depth: ${snapshot.depth}`);
  }
  if (!Array.isArray(snapshot.leaves) || snapshot.leaves.length !== MEMBERSHIP_TREE_CAPACITY) {
    throw new Error(`Expected ${MEMBERSHIP_TREE_CAPACITY} membership leaves`);
  }
  const leaves = snapshot.leaves.map((leaf, index) => normalizeField(leaf, `membership leaf ${index}`));

  if (!snapshot.layers) {
    const layers = Array.from(
      { length: MEMBERSHIP_TREE_DEPTH + 1 },
      (_, level) => Array<string>(2 ** (MEMBERSHIP_TREE_DEPTH - level)).fill('0'),
    );
    for (let index = 0; index < leaves.length; index++) {
      if (leaves[index] !== '0') await setSnapshotLeaf(layers, index, leaves[index]!);
    }
    return layers;
  }

  if (!Array.isArray(snapshot.layers) || snapshot.layers.length !== MEMBERSHIP_TREE_DEPTH + 1) {
    throw new Error('Invalid membership-tree layers');
  }
  const layers = snapshot.layers.map((layer, level) => {
    const expectedLength = 2 ** (MEMBERSHIP_TREE_DEPTH - level);
    if (!Array.isArray(layer) || layer.length !== expectedLength) {
      throw new Error(`Invalid membership-tree layer ${level}`);
    }
    return layer.map((node, index) => normalizeField(node, `membership node ${level}:${index}`));
  });
  if (layers[0]!.some((leaf, index) => leaf !== leaves[index])) {
    throw new Error('Membership-tree leaves do not match its layers');
  }

  const zeroParent = await mimcHash([0n, 0n]);
  for (let level = 0; level < MEMBERSHIP_TREE_DEPTH; level++) {
    for (let index = 0; index < layers[level + 1]!.length; index++) {
      const left = layers[level]![index * 2]!;
      const right = layers[level]![index * 2 + 1]!;
      const parent = layers[level + 1]![index]!;
      if (left === '0' && right === '0') {
        if (parent !== '0' && parent !== zeroParent) {
          throw new Error('Invalid empty membership-tree branch');
        }
      } else if (parent !== await mimcHash([BigInt(left), BigInt(right)])) {
        throw new Error('Invalid membership-tree parent');
      }
    }
  }
  return layers;
}

/**
 * Derives a private circuit path from public tree data. The caller supplies
 * its own commitment; no server receives it in order to construct a witness.
 */
export async function deriveMembershipWitness(
  commitment: string,
  snapshot: PublicMembershipSnapshot,
): Promise<MembershipWitness> {
  const normalizedCommitment = normalizeField(commitment, 'membership commitment');
  if (normalizedCommitment === '0') throw new Error('Membership commitment is not active');
  const layers = await normalizedSnapshotLayers(snapshot);
  const root = normalizeField(snapshot.root, 'membership root');
  if (layers[MEMBERSHIP_TREE_DEPTH]![0] !== root) {
    throw new Error('Membership-tree root does not match its layers');
  }

  const matchingIndices = layers[0]!
    .map((leaf, index) => leaf === normalizedCommitment ? index : -1)
    .filter((index) => index >= 0);
  if (matchingIndices.length !== 1) {
    throw new Error('Membership commitment must appear exactly once in the public snapshot');
  }

  const merklePathElements: string[] = [];
  const merklePathIndices: string[] = [];
  let node = normalizedCommitment;
  let index = matchingIndices[0]!;
  for (let level = 0; level < MEMBERSHIP_TREE_DEPTH; level++) {
    const sibling = layers[level]![index ^ 1]!;
    const isRight = index & 1;
    merklePathElements.push(sibling);
    merklePathIndices.push(isRight.toString());
    node = isRight
      ? await mimcHash([BigInt(sibling), BigInt(node)])
      : await mimcHash([BigInt(node), BigInt(sibling)]);
    index = Math.floor(index / 2);
  }
  if (node !== root) throw new Error('Membership witness does not reproduce the snapshot root');

  return {
    root,
    leafIndex: matchingIndices[0]!,
    merklePathElements,
    merklePathIndices,
  };
}

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue };

function normalizeForCanonicalJson(value: unknown): CanonicalValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((item) => normalizeForCanonicalJson(item));
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, normalizeForCanonicalJson(object[key])]),
    );
  }
  return null;
}

/** Stable JSON representation used as the exact request message M. */
export function canonicalizeRequest(request: unknown): string {
  return JSON.stringify(normalizeForCanonicalJson(request));
}

export interface RequestDigest {
  canonical: string;
  digest: string;
  field: string;
}

export async function requestDigestToField(request: unknown): Promise<RequestDigest> {
  const canonical = canonicalizeRequest(request);
  const digestBytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)),
  );
  const digest = Array.from(digestBytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return { canonical, digest, field: mod(BigInt(`0x${digest}`)).toString() };
}

export interface TicketSignals extends RequestDigest {
  ticketIndex: number;
  slope: string;
  nullifier: string;
  signalX: string;
  signalY: string;
}

/** Derive one paper ticket and bind its share to the canonical API request. */
export async function deriveTicketSignals(
  secretK: Uint8Array,
  ticketIndex: number,
  request: unknown,
): Promise<TicketSignals> {
  if (!Number.isInteger(ticketIndex) || ticketIndex < 0 || ticketIndex >= 100) {
    throw new Error('ticket index must be an integer in the range 0..99');
  }

  const requestDigest = await requestDigestToField(request);
  const secretField = BigInt(skToField(secretK));
  const slope = await mimcHash([secretField, BigInt(ticketIndex)]);
  const nullifier = await mimcHash([BigInt(slope)]);
  const signalY = mod(secretField + BigInt(slope) * BigInt(requestDigest.field)).toString();

  return {
    ...requestDigest,
    ticketIndex,
    slope,
    nullifier,
    signalX: requestDigest.field,
    signalY,
  };
}
