/**
 * Durable Base contract event/root synchronization for the zk-prepaid gateway.
 *
 * The immutable bond contract is the source of truth for accepted Merkle roots.
 * This indexer deliberately stores only public chain events and root state; it
 * never joins the spend plane to accounts, orders, prompts, or responses.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { decodeEventLog, parseAbi, type Address, type Hex } from 'viem';
import type { Pool } from 'pg';

export const BN254_FIELD_ORDER =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export const BASE_BOND_EVENT_ABI = parseAbi([
  'event BundleFunded(bytes32 indexed commitment, uint8 indexed tierId, uint64 expiry, uint256 leafIndex, uint256 bondAmount, bytes32 root)',
  'event MerkleRootUpdated(bytes32 indexed root, uint256 indexed leafIndex)',
  'event BondSlashed(bytes32 indexed commitment, uint256 indexed nullifier, address indexed reporter, uint256 reporterAmount, uint256 treasuryAmount)',
  'event BondReleased(bytes32 indexed commitment, uint256 bondAmount, address indexed recipient)',
]);

export type BaseContractEventName = 'BundleFunded' | 'MerkleRootUpdated' | 'BondSlashed' | 'BondReleased';

export interface BaseContractEvent {
  eventId: string;
  contractAddress: string;
  blockNumber: bigint;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
  eventName: BaseContractEventName;
  args: Record<string, string>;
  observedAt: number;
}

export interface BaseRootSnapshot {
  contractAddress: string;
  deploymentBlock?: bigint;
  currentRoot?: string;
  knownRoots: string[];
  lastScannedBlock?: bigint;
  lastScannedBlockHash?: string;
}

export interface BaseEventStore {
  getState(contractAddress: string): Promise<BaseRootSnapshot>;
  saveState(state: BaseRootSnapshot): Promise<void>;
  saveEvent(event: BaseContractEvent): Promise<boolean>;
  listEvents(contractAddress: string): Promise<BaseContractEvent[]>;
  rewind(contractAddress: string, fromBlock: bigint): Promise<void>;
}

export interface BaseEventSyncClient {
  getBlockNumber(): Promise<bigint>;
  getBlock(args: { blockNumber: bigint }): Promise<{ hash?: Hex | null }>;
  getLogs(args: { address: Address; fromBlock: bigint; toBlock: bigint }): Promise<readonly BaseLog[]>;
}

interface BaseLog {
  address?: Address;
  blockNumber?: bigint | null;
  blockHash?: Hex | null;
  transactionHash?: Hex | null;
  logIndex?: number | bigint | null;
  data: Hex;
  topics: readonly Hex[];
}

export interface BaseEventSyncOptions {
  contractAddress: string;
  client: BaseEventSyncClient;
  store: BaseEventStore;
  deploymentBlock?: bigint;
  confirmations?: bigint;
  maxBlockRange?: bigint;
  /** Root written by the bond constructor before any root event exists. */
  initialRoot?: string;
}

function cloneState(state: BaseRootSnapshot): BaseRootSnapshot {
  return {
    ...state,
    knownRoots: [...state.knownRoots],
  };
}

function initialState(contractAddress: string, deploymentBlock?: bigint): BaseRootSnapshot {
  return { contractAddress, deploymentBlock, knownRoots: [] } as BaseRootSnapshot;
}

function normalizeRoot(value: string): string | null {
  if (!/^(?:\d+|0x[0-9a-fA-F]{1,64})$/u.test(value)) return null;
  try {
    const field = BigInt(value);
    if (field < 0n || field >= BN254_FIELD_ORDER) return null;
    return field.toString();
  } catch {
    return null;
  }
}

function seedInitialRoot(state: BaseRootSnapshot, initialRoot?: string): BaseRootSnapshot {
  if (state.currentRoot || state.knownRoots.length > 0 || !initialRoot) return state;
  const root = normalizeRoot(initialRoot);
  if (!root) return state;
  return { ...state, currentRoot: root, knownRoots: [root] };
}

function stringValue(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value) ?? '';
}

function stringifyArgs(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/^\d+$/u.test(key))
      .map(([key, item]) => [key, stringValue(item)]),
  );
}

function eventFromLog(log: BaseLog, contractAddress: string, observedAt: number): BaseContractEvent | null {
  if (log.blockNumber === null || log.blockNumber === undefined || !log.blockHash || !log.transactionHash || log.logIndex === null || log.logIndex === undefined) return null;
  let decoded: { eventName?: string; args?: unknown };
  try {
    decoded = decodeEventLog({
      abi: BASE_BOND_EVENT_ABI,
      data: log.data,
      topics: log.topics as [Hex, ...Hex[]],
    }) as unknown as { eventName?: string; args?: unknown };
  } catch {
    return null;
  }
  if (!decoded.eventName || !['BundleFunded', 'MerkleRootUpdated', 'BondSlashed', 'BondReleased'].includes(decoded.eventName)) return null;
  const logIndex = typeof log.logIndex === 'bigint' ? Number(log.logIndex) : log.logIndex;
  if (!Number.isSafeInteger(logIndex) || logIndex < 0) return null;
  return {
    eventId: `${log.transactionHash}:${logIndex}`,
    contractAddress,
    blockNumber: log.blockNumber,
    blockHash: log.blockHash,
    transactionHash: log.transactionHash,
    logIndex,
    eventName: decoded.eventName as BaseContractEventName,
    args: stringifyArgs(decoded.args),
    observedAt,
  };
}

export function applyBaseContractEvent(state: BaseRootSnapshot, event: BaseContractEvent): BaseRootSnapshot {
  const next = cloneState(state);
  const root = normalizeRoot(event.args.root ?? '');
  if (root) {
    next.currentRoot = root;
    if (!next.knownRoots.includes(root)) next.knownRoots.push(root);
  }
  return next;
}

function replayEvents(base: BaseRootSnapshot, events: readonly BaseContractEvent[]): BaseRootSnapshot {
  return events
    .slice()
    .sort((left, right) => left.blockNumber < right.blockNumber ? -1 : left.blockNumber > right.blockNumber ? 1 : left.logIndex - right.logIndex)
    .reduce((state, event) => applyBaseContractEvent(state, event), cloneState(base));
}

/** In-memory store used by local development and deterministic tests. */
export class MemoryBaseEventStore implements BaseEventStore {
  private readonly states = new Map<string, BaseRootSnapshot>();
  private readonly events = new Map<string, BaseContractEvent>();
  private readonly initial: BaseRootSnapshot;

  constructor(initial?: Partial<BaseRootSnapshot> & { contractAddress?: string }) {
    this.initial = {
      ...initialState(initial?.contractAddress ?? '', initial?.deploymentBlock),
      ...initial,
      knownRoots: [...(initial?.knownRoots ?? [])].map(normalizeRoot).filter((root): root is string => root !== null),
    };
    if (this.initial.contractAddress) this.states.set(this.initial.contractAddress, cloneState(this.initial));
  }

  async getState(contractAddress: string): Promise<BaseRootSnapshot> {
    const current = this.states.get(contractAddress);
    if (current) return cloneState(current);
    return cloneState({ ...this.initial, contractAddress, knownRoots: [...this.initial.knownRoots] });
  }

  async saveState(state: BaseRootSnapshot): Promise<void> {
    this.states.set(state.contractAddress, cloneState(state));
  }

  async saveEvent(event: BaseContractEvent): Promise<boolean> {
    if (this.events.has(event.eventId)) return false;
    this.events.set(event.eventId, { ...event, args: { ...event.args } });
    return true;
  }

  async listEvents(contractAddress: string): Promise<BaseContractEvent[]> {
    return [...this.events.values()]
      .filter((event) => event.contractAddress === contractAddress)
      .map((event) => ({ ...event, args: { ...event.args } }));
  }

  async rewind(contractAddress: string, fromBlock: bigint): Promise<void> {
    for (const [eventId, event] of this.events) {
      if (event.contractAddress === contractAddress && event.blockNumber >= fromBlock) this.events.delete(eventId);
    }
    const base = { ...this.initial, contractAddress, knownRoots: [...this.initial.knownRoots] };
    await this.saveState(replayEvents(base, await this.listEvents(contractAddress)));
  }
}

/** PostgreSQL store for event idempotency and restart-safe root snapshots. */
export class PostgresBaseEventStore implements BaseEventStore {
  private readonly initial: BaseRootSnapshot;

  constructor(private readonly pool: Pool, initial?: Partial<BaseRootSnapshot> & { contractAddress?: string }) {
    this.initial = {
      ...initialState(initial?.contractAddress ?? '', initial?.deploymentBlock),
      ...initial,
      knownRoots: [...(initial?.knownRoots ?? [])].map(normalizeRoot).filter((root): root is string => root !== null),
    };
  }

  async getState(contractAddress: string): Promise<BaseRootSnapshot> {
    const result = await this.pool.query(
      `SELECT contract_address, last_scanned_block, last_scanned_block_hash, current_root, known_roots
         FROM billing.base_chain_state WHERE contract_address = $1`,
      [contractAddress],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return cloneState({ ...this.initial, contractAddress, knownRoots: [...this.initial.knownRoots] });
    return {
      contractAddress: String(row.contract_address),
      currentRoot: row.current_root === null ? undefined : String(row.current_root),
      knownRoots: Array.isArray(row.known_roots) ? row.known_roots.map(String) : [],
      lastScannedBlock: row.last_scanned_block === null ? undefined : BigInt(String(row.last_scanned_block)),
      lastScannedBlockHash: row.last_scanned_block_hash === null ? undefined : String(row.last_scanned_block_hash),
    };
  }

  async saveState(state: BaseRootSnapshot): Promise<void> {
    await this.pool.query(
      `INSERT INTO billing.base_chain_state
         (contract_address, last_scanned_block, last_scanned_block_hash, current_root, known_roots)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (contract_address) DO UPDATE SET
         last_scanned_block = EXCLUDED.last_scanned_block,
         last_scanned_block_hash = EXCLUDED.last_scanned_block_hash,
         current_root = EXCLUDED.current_root,
         known_roots = EXCLUDED.known_roots,
         updated_at = now()`,
      [state.contractAddress, state.lastScannedBlock?.toString() ?? null, state.lastScannedBlockHash ?? null, state.currentRoot ?? null, state.knownRoots],
    );
  }

  async saveEvent(event: BaseContractEvent): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO billing.base_contract_events
         (event_id, contract_address, block_number, block_hash, transaction_hash, log_index, event_name, args, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, to_timestamp($9 / 1000.0))
       ON CONFLICT (event_id) DO NOTHING`,
      [event.eventId, event.contractAddress, event.blockNumber.toString(), event.blockHash, event.transactionHash, event.logIndex, event.eventName, JSON.stringify(event.args), event.observedAt],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listEvents(contractAddress: string): Promise<BaseContractEvent[]> {
    const result = await this.pool.query(
      `SELECT event_id, contract_address, block_number, block_hash, transaction_hash, log_index, event_name, args, extract(epoch from observed_at) * 1000 AS observed_at
         FROM billing.base_contract_events WHERE contract_address = $1 ORDER BY block_number ASC, log_index ASC`,
      [contractAddress],
    );
    return result.rows.map((row) => ({
      eventId: String(row.event_id),
      contractAddress: String(row.contract_address),
      blockNumber: BigInt(String(row.block_number)),
      blockHash: String(row.block_hash),
      transactionHash: String(row.transaction_hash),
      logIndex: Number(row.log_index),
      eventName: String(row.event_name) as BaseContractEventName,
      args: (row.args && typeof row.args === 'object' ? row.args : {}) as Record<string, string>,
      observedAt: Number(row.observed_at),
    }));
  }

  async rewind(contractAddress: string, fromBlock: bigint): Promise<void> {
    await this.pool.query(
      `DELETE FROM billing.base_contract_events WHERE contract_address = $1 AND block_number >= $2`,
      [contractAddress, fromBlock.toString()],
    );
    const base = { ...this.initial, contractAddress, knownRoots: [...this.initial.knownRoots], lastScannedBlock: undefined, lastScannedBlockHash: undefined };
    await this.saveState(replayEvents(base, await this.listEvents(contractAddress)));
  }
}

/** Polls finalized Base logs and exposes a restart-safe root snapshot. */
export class BaseContractEventSynchronizer {
  private readonly options: Required<Pick<BaseEventSyncOptions, 'confirmations' | 'maxBlockRange'>>;

  constructor(private readonly input: BaseEventSyncOptions) {
    this.options = {
      confirmations: input.confirmations ?? 3n,
      maxBlockRange: input.maxBlockRange ?? 2_000n,
    };
  }

  async snapshot(): Promise<BaseRootSnapshot> {
    return this.input.store.getState(this.input.contractAddress);
  }

  async syncOnce(now = Date.now()): Promise<BaseRootSnapshot> {
    let state = await this.input.store.getState(this.input.contractAddress);
    const seededState = seedInitialRoot(state, this.input.initialRoot);
    if (seededState !== state) {
      state = seededState;
      await this.input.store.saveState(state);
    }
    const latest = await this.input.client.getBlockNumber();
    const target = latest > this.options.confirmations ? latest - this.options.confirmations : 0n;

    if (state.lastScannedBlock !== undefined && state.lastScannedBlockHash) {
      const scanned = await this.input.client.getBlock({ blockNumber: state.lastScannedBlock });
      if (scanned.hash && scanned.hash !== state.lastScannedBlockHash) {
        await this.input.store.rewind(this.input.contractAddress, this.input.deploymentBlock ?? 0n);
        state = await this.input.store.getState(this.input.contractAddress);
        const reorgSeededState = seedInitialRoot(state, this.input.initialRoot);
        if (reorgSeededState !== state) {
          state = reorgSeededState;
          await this.input.store.saveState(state);
        }
      }
    }

    let from = state.lastScannedBlock === undefined
      ? (state.deploymentBlock ?? this.input.deploymentBlock ?? 0n)
      : state.lastScannedBlock + 1n;
    while (from <= target) {
      const to = from + this.options.maxBlockRange - 1n < target ? from + this.options.maxBlockRange - 1n : target;
      const logs = await this.input.client.getLogs({
        address: this.input.contractAddress as Address,
        fromBlock: from,
        toBlock: to,
      });
      for (const log of logs) {
        const event = eventFromLog(log, this.input.contractAddress, now);
        if (!event) continue;
        await this.input.store.saveEvent(event);
        state = applyBaseContractEvent(state, event);
      }
      state.lastScannedBlock = to;
      const block = await this.input.client.getBlock({ blockNumber: to });
      state.lastScannedBlockHash = block.hash ?? undefined;
      await this.input.store.saveState(state);
      from = to + 1n;
    }
    return state;
  }
}
