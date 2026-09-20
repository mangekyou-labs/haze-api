/**
 * Local Base event synchronization for sidecar Merkle witnesses.
 *
 * BundleFunded events are public chain data. The cache contains only indexed
 * leaves, block continuity, and roots; credentials and request spend metadata
 * never enter it.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { baseSepolia } from 'viem/chains';
import { createPublicClient, http, parseAbi, type Address, type Hex } from 'viem';
import {
  BASE_MEMBERSHIP_TREE_CAPACITY,
  BN254_FIELD_ORDER,
  computeCreditLeaf,
  deriveSparseCreditWitness,
  type CreditCredential,
} from '@zk-credits/shared/base';
import type { BaseCreditWitness, BaseWitnessProvider } from './base-sidecar.js';

const BUNDLE_FUNDED_ABI = parseAbi([
  'event BundleFunded(bytes32 indexed commitment, uint8 indexed tierId, uint64 expiry, uint256 leafIndex, uint256 bondAmount, bytes32 root)',
]);

export interface BaseEventWitnessClient {
  getBlockNumber(): Promise<bigint>;
  getBlock(args: { blockNumber: bigint }): Promise<{ hash?: Hex | null }>;
  getLogs(args: unknown): Promise<readonly unknown[]>;
}

interface CachedLeafState {
  scannedTo: string;
  scannedToHash: string;
  /** The fourth tuple member was added when exact contract expiry became authoritative. */
  leaves: Array<[number, string, string, number?]>;
}

export interface BaseEventWitnessProviderOptions {
  rpcUrl: string;
  contractAddress: string;
  deploymentBlock?: bigint;
  confirmations?: bigint;
  maxBlockRange?: bigint;
  cachePath?: string;
  /** Dependency injection for deterministic tests and embedded clients. */
  client?: BaseEventWitnessClient;
}

function field(value: unknown, label: string): string {
  const text = typeof value === 'bigint' ? value.toString() : String(value);
  if (!/^(?:\d+|0x[0-9a-fA-F]{1,64})$/u.test(text)) throw new Error(`Invalid ${label}`);
  const parsed = BigInt(text);
  if (parsed < 0n || parsed >= BN254_FIELD_ORDER) throw new Error(`Invalid ${label}`);
  return parsed.toString();
}

function address(value: string): Address {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(value)) throw new Error('BASE_PRIVATE_CREDIT_BOND_ADDRESS is invalid');
  return value as Address;
}

function numeric(value: unknown, label: string): number {
  const parsed = BigInt(typeof value === 'bigint' ? value : String(value));
  const number = Number(parsed);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Invalid ${label}`);
  return number;
}

function decodeFundedLog(log: unknown): { commitment: string; tierId: number; expiry: number; leafIndex: number } | null {
  if (!log || typeof log !== 'object') return null;
  const args = (log as { args?: unknown }).args;
  if (!args || typeof args !== 'object') return null;
  const values = args as Record<string, unknown>;
  try {
    return {
      commitment: field(values.commitment, 'commitment'),
      tierId: numeric(values.tierId, 'tier id'),
      expiry: numeric(values.expiry, 'expiry'),
      leafIndex: numeric(values.leafIndex, 'leaf index'),
    };
  } catch {
    return null;
  }
}

function readCachedLeaves(state: CachedLeafState): Map<number, { commitment: string; leaf: string; expiry?: number }> {
  const leaves = new Map<number, { commitment: string; leaf: string; expiry?: number }>();
  for (const item of state.leaves) {
    if (!Array.isArray(item) || (item.length !== 3 && item.length !== 4)) continue;
    const index = Number(item[0]);
    if (!Number.isSafeInteger(index) || index < 0 || index >= BASE_MEMBERSHIP_TREE_CAPACITY) continue;
    const expiry = item[3] === undefined ? undefined : Number(item[3]);
    if (expiry !== undefined && (!Number.isSafeInteger(expiry) || expiry <= 0)) continue;
    leaves.set(index, {
      commitment: field(item[1], 'cached commitment'),
      leaf: field(item[2], 'cached leaf'),
      ...(expiry === undefined ? {} : { expiry }),
    });
  }
  return leaves;
}

function serializeLeaves(leaves: Map<number, { commitment: string; leaf: string; expiry?: number }>): Array<[number, string, string, number?]> {
  return [...leaves.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, value]) => [index, value.commitment, value.leaf, value.expiry]);
}

/** Creates a witness provider that syncs finalized BundleFunded events. */
export function createBaseEventWitnessProvider(options: BaseEventWitnessProviderOptions): BaseWitnessProvider {
  const client = options.client ?? createPublicClient({ chain: baseSepolia, transport: http(options.rpcUrl) }) as unknown as BaseEventWitnessClient;
  const contract = address(options.contractAddress);
  const confirmations = options.confirmations ?? 3n;
  const maxBlockRange = options.maxBlockRange ?? 2_000n;
  let cache: CachedLeafState | undefined;
  let leaves = new Map<number, { commitment: string; leaf: string; expiry?: number }>();

  async function loadCache(): Promise<void> {
    if (cache || !options.cachePath) return;
    try {
      cache = JSON.parse(await readFile(options.cachePath, 'utf8')) as CachedLeafState;
      leaves = readCachedLeaves(cache);
    } catch {
      cache = undefined;
      leaves = new Map();
    }
  }

  async function saveCache(): Promise<void> {
    if (!options.cachePath || !cache) return;
    await mkdir(dirname(options.cachePath), { recursive: true });
    await writeFile(options.cachePath, JSON.stringify(cache), { mode: 0o600 });
  }

  async function synchronize(): Promise<void> {
    await loadCache();
    const latest = await client.getBlockNumber();
    const target = latest > confirmations ? latest - confirmations : 0n;
    let from = options.deploymentBlock ?? 0n;
    if (cache) {
      const previousBlock = BigInt(cache.scannedTo);
      const previous = await client.getBlock({ blockNumber: previousBlock });
      if (previous.hash && previous.hash !== cache.scannedToHash) {
        cache = undefined;
        leaves = new Map();
      } else {
        from = previousBlock + 1n;
      }
    }
    while (from <= target) {
      const to = from + maxBlockRange - 1n < target ? from + maxBlockRange - 1n : target;
      const logs = await client.getLogs({ address: contract, event: BUNDLE_FUNDED_ABI[0], fromBlock: from, toBlock: to });
      for (const log of logs) {
        const funded = decodeFundedLog(log);
        if (!funded) continue;
        if (funded.leafIndex >= BASE_MEMBERSHIP_TREE_CAPACITY) throw new Error('Base membership tree is full');
        const leaf = await computeCreditLeaf(funded.commitment, funded.tierId, funded.expiry);
        leaves.set(funded.leafIndex, { commitment: funded.commitment, leaf, expiry: funded.expiry });
      }
      const block = await client.getBlock({ blockNumber: to });
      cache = { scannedTo: to.toString(), scannedToHash: block.hash ?? '', leaves: serializeLeaves(leaves) };
      await saveCache();
      from = to + 1n;
    }
  }

  return {
    async witnessForCredential(credential: CreditCredential): Promise<BaseCreditWitness> {
      await synchronize();
      const commitment = field(credential.commitment, 'credential commitment');
      const entry = [...leaves.entries()].find(([, value]) => value.commitment === commitment);
      if (!entry) throw new Error('No funded Base bundle was found for this credential');
      const sparse = new Map<number, string>([...leaves.entries()].map(([index, value]) => [index, value.leaf]));
      const witness = await deriveSparseCreditWitness(sparse, entry[0]);
      return {
        root: witness.root,
        pathElements: witness.pathElements,
        pathIndices: witness.pathIndices,
        ...(entry[1].expiry === undefined ? {} : { expiry: entry[1].expiry }),
      };
    },
  };
}
