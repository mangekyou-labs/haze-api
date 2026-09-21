// Gateway durable state (M2.2).
//
// Two implementations share one contract so the full gateway flow can be
// tested offline (MemoryGatewayStore) while production persists to the
// `gateway` PostgreSQL schema (PostgresGatewayStore). The contract preserves
// the v1 privacy boundary: a call is recorded with its nullifier only — never
// with the commitment/deposit it belongs to (ZK unlinkability).

export type SettlementStatus = 'pending' | 'settled' | 'quarantined';

export interface AcceptedCall {
  proofHash: string;
  nullifier: string;
  signalX?: string;
  signalY?: string;
  requestDigest?: string;
  epoch: number;
  slot: number;
  nonceHash: string;
  acceptedAt: Date;
  onChainSpendTx?: string | null;
  spentOnChain?: boolean;
  /** Durable settlement lifecycle; legacy rows can be quarantined safely. */
  settlementStatus?: SettlementStatus;
  settlementError?: string | null;
  /** Full RLN Groth16 proof (durable — needed by the async spend worker). */
  proof?: object | null;
  /** Indexed-ticket public signals [root, nullifier, share_x, share_y]. */
  pubSignals?: string[] | null;
  responseStatus?: number | null;
  responseBody?: unknown | null;
  providerGenerationId?: string | null;
}

export interface NullifierRecord {
  nullifier: string;
  signalX?: string;
  signalY?: string;
  requestDigest?: string;
  firstProofHash?: string;
  epoch: number;
  slot: number;
  firstSeenAt: Date;
  spentOnChain: boolean;
  spentAt: Date | null;
}

export interface ApiKeyRecord {
  keyHash: string;
  commitment: string;
  label: string;
  issuedAt: Date;
  revokedAt: Date | null;
}

export type MembershipLeafStatus = 'pending' | 'active' | 'removed';

/**
 * Membership state belongs to the deposit/tree boundary, never to an
 * accepted call. A pending record closes the crash window between a Soroban
 * deposit and the local root activation.
 */
export interface MembershipLeaf {
  leafIndex: number;
  commitment: string;
  status: MembershipLeafStatus;
  candidateRoot: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MembershipTreeState {
  root: string;
  version: number;
  /** Full node layers preserve zero-branch hashes after a membership removal. */
  layers: string[][];
  updatedAt: Date;
}

export interface ReconstructedState {
  /** Every nullifier ever seen (off-chain accepted and/or on-chain spent). */
  nullifiers: Set<string>;
  /** Lifetime call totals per commitment (all epochs summed). */
  callCounts: Map<string, number>;
}

export interface GatewayStore {
  // ── Accepted calls ────────────────────────────────────────────
  /**
   * Durable accept: writes the accepted call + marks the nullifier seen +
   * increments the commitment's call count atomically (PostgreSQL: one
   * transaction). Must complete BEFORE the request is forwarded upstream so
   * no accepted call is lost on a crash/restart.
   */
  recordAcceptedCall(call: AcceptedCall, commitment: string): Promise<void>;
  findAcceptedCall(criteria: {
    nullifier: string;
    signalX: string;
    signalY: string;
    requestDigest: string;
  }): Promise<AcceptedCall | null>;
  recordProviderResponse(
    proofHash: string,
    responseStatus: number,
    responseBody: unknown,
    providerGenerationId?: string,
  ): Promise<void>;
  listAcceptedCalls(opts?: { onlyPendingSpend?: boolean }): Promise<AcceptedCall[]>;
  countAcceptedCallsEpoch(epoch: number): Promise<number>;
  /** Mark an accepted call as settled on-chain (called by the spend worker). */
  markSpendResult(proofHash: string, onChainSpendTx: string): Promise<void>;
  /** Remove a malformed/legacy call from the retry queue with an audit reason. */
  quarantineSpend(proofHash: string, reason: string): Promise<void>;

  // ── Nullifier records ─────────────────────────────────────────
  getNullifier(nullifier: string): Promise<NullifierRecord | null>;
  markNullifierSeen(
    nullifier: string,
    epoch: number,
    slot: number,
    metadata?: { signalX?: string; signalY?: string; requestDigest?: string; proofHash?: string },
  ): Promise<void>;
  markNullifierSpentOnChain(nullifier: string): Promise<void>;
  listNullifiers(): Promise<NullifierRecord[]>;

  // ── API keys ──────────────────────────────────────────────────
  createApiKey(keyHash: string, commitment: string, label: string): Promise<void>;
  getApiKey(keyHash: string): Promise<ApiKeyRecord | null>;
  listApiKeys(commitment: string): Promise<ApiKeyRecord[]>;

  // ── Call counts ───────────────────────────────────────────────
  incrementCallCount(commitment: string, epoch: number): Promise<number>;
  getCallCount(commitment: string): Promise<number>;
  /** All lifetime call totals for restart reconstruction. */
  getAllCallCounts(): Promise<Map<string, number>>;

  // ── Membership tree ───────────────────────────────────────────
  /** Stage a leaf before its matching on-chain deposit is submitted. */
  reserveMembershipLeaf(leaf: {
    leafIndex: number;
    commitment: string;
    candidateRoot: string;
  }): Promise<void>;
  /** Commit a staged leaf only after its root is active on-chain. */
  activateMembershipLeaf(leafIndex: number, root: string, layers: string[][]): Promise<void>;
  /** Remove a staged leaf when the matching on-chain deposit is rejected. */
  discardPendingMembershipLeaf(leafIndex: number): Promise<void>;
  /** Commit a verified slash/withdraw membership removal and its next root. */
  removeMembershipLeaf(leafIndex: number, root: string, layers: string[][]): Promise<void>;
  /** One-time import of a complete public tree snapshot for a legacy deployment. */
  bootstrapMembershipTree(
    leaves: Array<{ leafIndex: number; commitment: string }>,
    state: { root: string; layers: string[][] },
  ): Promise<void>;
  /** One-time CAS repair replacing stale membership tree state with a validated snapshot. */
  repairMembershipTree(
    leaves: Array<{ leafIndex: number; commitment: string }>,
    state: { root: string; layers: string[][] },
    expectedStaleRoot: string,
  ): Promise<void>;
  listMembershipLeaves(): Promise<MembershipLeaf[]>;
  getMembershipTreeState(): Promise<MembershipTreeState | null>;
}
// ─── In-memory implementation (offline tests / local dev) ─────────

export class MemoryGatewayStore implements GatewayStore {
  private calls = new Map<string, AcceptedCall>();
  private nullifiers = new Map<string, NullifierRecord>();
  private keys = new Map<string, ApiKeyRecord>();
  private counts = new Map<string, Map<number, number>>();
  private membershipLeaves = new Map<number, MembershipLeaf>();
  private membershipTreeState: MembershipTreeState | null = null;

  async recordAcceptedCall(call: AcceptedCall, commitment: string): Promise<void> {
    if (this.calls.has(call.proofHash)) {
      throw new Error(`duplicate accepted call: proofHash ${call.proofHash} already exists`);
    }
    // Atomic in-process: the call row, the nullifier, and the call-count
    // increment are applied together so a crash between steps is impossible.
    this.calls.set(call.proofHash, {
      ...call,
      onChainSpendTx: call.onChainSpendTx ?? null,
      spentOnChain: call.spentOnChain ?? false,
      settlementStatus: call.settlementStatus ?? (call.spentOnChain ? 'settled' : 'pending'),
      settlementError: call.settlementError ?? null,
    });
    await this.markNullifierSeen(call.nullifier, call.epoch, call.slot, {
      signalX: call.signalX,
      signalY: call.signalY,
      requestDigest: call.requestDigest,
      proofHash: call.proofHash,
    });
    if (commitment) await this.incrementCallCount(commitment, call.epoch);
  }

  async findAcceptedCall(criteria: {
    nullifier: string;
    signalX: string;
    signalY: string;
    requestDigest: string;
  }): Promise<AcceptedCall | null> {
    return [...this.calls.values()].find((call) =>
      call.nullifier === criteria.nullifier &&
      call.signalX === criteria.signalX &&
      call.signalY === criteria.signalY &&
      call.requestDigest === criteria.requestDigest,
    ) ?? null;
  }

  async recordProviderResponse(
    proofHash: string,
    responseStatus: number,
    responseBody: unknown,
    providerGenerationId?: string,
  ): Promise<void> {
    const call = this.calls.get(proofHash);
    if (!call) throw new Error(`unknown accepted call: ${proofHash}`);
    call.responseStatus = responseStatus;
    call.responseBody = responseBody;
    call.providerGenerationId = providerGenerationId ?? null;
  }

  async listAcceptedCalls(opts: { onlyPendingSpend?: boolean } = {}): Promise<AcceptedCall[]> {
    let rows = [...this.calls.values()];
    if (opts.onlyPendingSpend) {
      rows = rows.filter((c) => !c.spentOnChain && c.settlementStatus !== 'quarantined');
    }
    return rows;
  }

  async countAcceptedCallsEpoch(epoch: number): Promise<number> {
    return [...this.calls.values()].filter((c) => c.epoch === epoch).length;
  }

  async markSpendResult(proofHash: string, onChainSpendTx: string): Promise<void> {
    const call = this.calls.get(proofHash);
    if (!call) throw new Error(`unknown accepted call: ${proofHash}`);
    call.onChainSpendTx = onChainSpendTx;
    call.spentOnChain = true;
    call.settlementStatus = 'settled';
    call.settlementError = null;
    await this.markNullifierSpentOnChain(call.nullifier);
  }

  async quarantineSpend(proofHash: string, reason: string): Promise<void> {
    const call = this.calls.get(proofHash);
    if (!call) throw new Error(`unknown accepted call: ${proofHash}`);
    if (call.spentOnChain || call.settlementStatus === 'settled') return;
    call.settlementStatus = 'quarantined';
    call.settlementError = reason;
  }

  async getNullifier(nullifier: string): Promise<NullifierRecord | null> {
    return this.nullifiers.get(nullifier) ?? null;
  }

  async markNullifierSeen(
    nullifier: string,
    epoch: number,
    slot: number,
    metadata: { signalX?: string; signalY?: string; requestDigest?: string; proofHash?: string } = {},
  ): Promise<void> {
    const existing = this.nullifiers.get(nullifier);
    if (existing) return;
    this.nullifiers.set(nullifier, {
      nullifier,
      signalX: metadata.signalX,
      signalY: metadata.signalY,
      requestDigest: metadata.requestDigest,
      firstProofHash: metadata.proofHash,
      epoch,
      slot,
      firstSeenAt: new Date(),
      spentOnChain: false,
      spentAt: null,
    });
  }

  async markNullifierSpentOnChain(nullifier: string): Promise<void> {
    const existing = this.nullifiers.get(nullifier);
    if (existing) {
      existing.spentOnChain = true;
      existing.spentAt = new Date();
      return;
    }
    this.nullifiers.set(nullifier, {
      nullifier,
      epoch: 0,
      slot: 0,
      firstSeenAt: new Date(),
      spentOnChain: true,
      spentAt: new Date(),
    });
  }

  async listNullifiers(): Promise<NullifierRecord[]> {
    return [...this.nullifiers.values()];
  }

  async createApiKey(keyHash: string, commitment: string, label: string): Promise<void> {
    if (this.keys.has(keyHash)) {
      throw new Error(`duplicate api key record: ${keyHash}`);
    }
    this.keys.set(keyHash, { keyHash, commitment, label, issuedAt: new Date(), revokedAt: null });
  }

  async getApiKey(keyHash: string): Promise<ApiKeyRecord | null> {
    return this.keys.get(keyHash) ?? null;
  }

  async listApiKeys(commitment: string): Promise<ApiKeyRecord[]> {
    return [...this.keys.values()].filter((k) => k.commitment === commitment);
  }

  async incrementCallCount(commitment: string, epoch: number): Promise<number> {
    let epochs = this.counts.get(commitment) ?? new Map<number, number>();
    epochs.set(epoch, (epochs.get(epoch) ?? 0) + 1);
    this.counts.set(commitment, epochs);
    return this.getCallCount(commitment);
  }

  async getCallCount(commitment: string): Promise<number> {
    const epochs = this.counts.get(commitment);
    if (!epochs) return 0;
    return [...epochs.values()].reduce((a, b) => a + b, 0);
  }

  async getAllCallCounts(): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const [commitment, epochs] of this.counts) {
      out.set(commitment, [...epochs.values()].reduce((a, b) => a + b, 0));
    }
    return out;
  }

  async reserveMembershipLeaf(leaf: {
    leafIndex: number;
    commitment: string;
    candidateRoot: string;
  }): Promise<void> {
    if (this.membershipLeaves.has(leaf.leafIndex)) {
      throw new Error(`membership leaf index already exists: ${leaf.leafIndex}`);
    }
    if ([...this.membershipLeaves.values()].some((existing) => existing.status === 'pending')) {
      throw new Error('a membership leaf is already pending reconciliation');
    }
    for (const existing of this.membershipLeaves.values()) {
      if (existing.commitment === leaf.commitment) {
        throw new Error(`membership commitment already exists: ${leaf.commitment}`);
      }
    }
    const now = new Date();
    this.membershipLeaves.set(leaf.leafIndex, {
      ...leaf,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
  }

  async activateMembershipLeaf(leafIndex: number, root: string, layers: string[][]): Promise<void> {
    const leaf = this.membershipLeaves.get(leafIndex);
    if (!leaf || leaf.status !== 'pending') {
      throw new Error(`pending membership leaf not found: ${leafIndex}`);
    }
    if (leaf.candidateRoot !== root) {
      throw new Error(`membership root mismatch for leaf ${leafIndex}`);
    }
    const updatedAt = new Date();
    this.membershipLeaves.set(leafIndex, { ...leaf, status: 'active', updatedAt });
    this.membershipTreeState = {
      root,
      version: (this.membershipTreeState?.version ?? 0) + 1,
      layers: layers.map((layer) => [...layer]),
      updatedAt,
    };
  }

  async discardPendingMembershipLeaf(leafIndex: number): Promise<void> {
    const leaf = this.membershipLeaves.get(leafIndex);
    if (!leaf || leaf.status !== 'pending') {
      throw new Error(`pending membership leaf not found: ${leafIndex}`);
    }
    this.membershipLeaves.delete(leafIndex);
  }

  async removeMembershipLeaf(leafIndex: number, root: string, layers: string[][]): Promise<void> {
    const leaf = this.membershipLeaves.get(leafIndex);
    if (!leaf || leaf.status !== 'active') {
      throw new Error(`active membership leaf not found: ${leafIndex}`);
    }
    const updatedAt = new Date();
    this.membershipLeaves.set(leafIndex, { ...leaf, status: 'removed', updatedAt });
    this.membershipTreeState = {
      root,
      version: (this.membershipTreeState?.version ?? 0) + 1,
      layers: layers.map((layer) => [...layer]),
      updatedAt,
    };
  }

  async bootstrapMembershipTree(
    leaves: Array<{ leafIndex: number; commitment: string }>,
    state: { root: string; layers: string[][] },
  ): Promise<void> {
    if (this.membershipLeaves.size > 0 || this.membershipTreeState) {
      throw new Error('membership tree bootstrap requires an empty durable store');
    }
    const indices = new Set<number>();
    const commitments = new Set<string>();
    for (const leaf of leaves) {
      if (!Number.isInteger(leaf.leafIndex) || leaf.leafIndex < 0 || leaf.leafIndex >= 8
        || indices.has(leaf.leafIndex) || commitments.has(leaf.commitment)) {
        throw new Error('membership tree bootstrap is malformed');
      }
      indices.add(leaf.leafIndex);
      commitments.add(leaf.commitment);
    }
    const now = new Date();
    for (const leaf of leaves) {
      this.membershipLeaves.set(leaf.leafIndex, {
        ...leaf,
        status: 'active',
        candidateRoot: state.root,
        createdAt: now,
        updatedAt: now,
      });
    }
    this.membershipTreeState = {
      root: state.root,
      version: 1,
      layers: state.layers.map((layer) => [...layer]),
      updatedAt: now,
    };
  }

  async repairMembershipTree(
    leaves: Array<{ leafIndex: number; commitment: string }>,
    state: { root: string; layers: string[][] },
    expectedStaleRoot: string,
  ): Promise<void> {
    const currentRoot = this.membershipTreeState?.root ?? null;
    if (currentRoot !== expectedStaleRoot) {
      throw new Error(
        `CAS repair expected stale DB root "${expectedStaleRoot}", but found "${currentRoot ?? 'none'}"`,
      );
    }
    const indices = new Set<number>();
    const commitments = new Set<string>();
    for (const leaf of leaves) {
      if (!Number.isInteger(leaf.leafIndex) || leaf.leafIndex < 0 || leaf.leafIndex >= 8
        || indices.has(leaf.leafIndex) || commitments.has(leaf.commitment)) {
        throw new Error('membership tree repair is malformed');
      }
      indices.add(leaf.leafIndex);
      commitments.add(leaf.commitment);
    }
    this.membershipLeaves.clear();
    const now = new Date();
    for (const leaf of leaves) {
      this.membershipLeaves.set(leaf.leafIndex, {
        ...leaf,
        status: 'active',
        candidateRoot: state.root,
        createdAt: now,
        updatedAt: now,
      });
    }
    this.membershipTreeState = {
      root: state.root,
      version: 1,
      layers: state.layers.map((layer) => [...layer]),
      updatedAt: now,
    };
  }

  async listMembershipLeaves(): Promise<MembershipLeaf[]> {
    return [...this.membershipLeaves.values()]
      .sort((a, b) => a.leafIndex - b.leafIndex)
      .map((leaf) => ({ ...leaf }));
  }

  async getMembershipTreeState(): Promise<MembershipTreeState | null> {
    return this.membershipTreeState
      ? { ...this.membershipTreeState, layers: this.membershipTreeState.layers.map((layer) => [...layer]) }
      : null;
  }

  /** Test/dev helper: reset all durable rows. */
  reset(): void {
    this.calls.clear();
    this.nullifiers.clear();
    this.keys.clear();
    this.counts.clear();
    this.membershipLeaves.clear();
    this.membershipTreeState = null;
  }
}

// ─── PostgreSQL implementation ────────────────────────────────────

import type { Pool } from 'pg';

const C = {
  calls: 'gateway.accepted_calls',
  nullifiers: 'gateway.nullifier_records',
  keys: 'gateway.api_key_records',
  counts: 'gateway.call_counts',
  membershipLeaves: 'gateway.membership_tree_leaves',
  membershipTreeState: 'gateway.membership_tree_state',
} as const;

function rowToAcceptedCall(r: Record<string, unknown>): AcceptedCall {
  const spentOnChain = r.spent_on_chain as boolean;
  return {
    proofHash: r.proof_hash as string,
    nullifier: r.nullifier as string,
    epoch: Number(r.epoch),
    slot: Number(r.slot),
    nonceHash: r.nonce_hash as string,
    acceptedAt: r.accepted_at as Date,
    onChainSpendTx: (r.on_chain_spend_tx as string) ?? null,
    spentOnChain,
    settlementStatus: (r.settlement_status as SettlementStatus) ?? (spentOnChain ? 'settled' : 'pending'),
    settlementError: (r.settlement_error as string) ?? null,
    proof: r.proof_json ? (JSON.parse(r.proof_json as string) as object) : null,
    pubSignals: r.pub_signals ? (r.pub_signals as string[]) : null,
    signalX: (r.signal_x as string) ?? undefined,
    signalY: (r.signal_y as string) ?? undefined,
    requestDigest: (r.request_digest as string) ?? undefined,
    responseStatus: r.response_status === null || r.response_status === undefined ? null : Number(r.response_status),
    responseBody: r.response_json ? JSON.parse(r.response_json as string) : null,
    providerGenerationId: (r.provider_generation_id as string) ?? null,
  };
}

function rowToNullifier(r: Record<string, unknown>): NullifierRecord {
  return {
    nullifier: r.nullifier as string,
    signalX: (r.signal_x as string) ?? undefined,
    signalY: (r.signal_y as string) ?? undefined,
    requestDigest: (r.request_digest as string) ?? undefined,
    firstProofHash: (r.first_proof_hash as string) ?? undefined,
    epoch: Number(r.epoch),
    slot: Number(r.slot),
    firstSeenAt: r.first_seen_at as Date,
    spentOnChain: r.spent_on_chain as boolean,
    spentAt: (r.spent_at as Date) ?? null,
  };
}

function rowToApiKey(r: Record<string, unknown>): ApiKeyRecord {
  return {
    keyHash: r.key_hash as string,
    commitment: r.commitment as string,
    label: r.label as string,
    issuedAt: r.issued_at as Date,
    revokedAt: (r.revoked_at as Date) ?? null,
  };
}

function rowToMembershipLeaf(r: Record<string, unknown>): MembershipLeaf {
  return {
    leafIndex: Number(r.leaf_index),
    commitment: r.commitment as string,
    status: r.status as MembershipLeafStatus,
    candidateRoot: r.candidate_root as string,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

function rowToMembershipTreeState(r: Record<string, unknown>): MembershipTreeState {
  return {
    root: r.root as string,
    version: Number(r.version),
    layers: r.layers as string[][],
    updatedAt: r.updated_at as Date,
  };
}

export class PostgresGatewayStore implements GatewayStore {
  constructor(private readonly pool: Pool) {}

  async recordAcceptedCall(call: AcceptedCall, commitment: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO ${C.calls}
           (proof_hash, nullifier, signal_x, signal_y, request_digest, epoch, slot, nonce_hash, accepted_at, on_chain_spend_tx, spent_on_chain, proof_json, pub_signals, response_status, response_json, provider_generation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          call.proofHash,
          call.nullifier,
          call.signalX ?? null,
          call.signalY ?? null,
          call.requestDigest ?? null,
          call.epoch,
          call.slot,
          call.nonceHash,
          call.acceptedAt,
          call.onChainSpendTx ?? null,
          call.spentOnChain ?? false,
          call.proof ? JSON.stringify(call.proof) : null,
          call.pubSignals ? (JSON.stringify(call.pubSignals) as string) : null,
          call.responseStatus ?? null,
          call.responseBody === undefined || call.responseBody === null ? null : JSON.stringify(call.responseBody),
          call.providerGenerationId ?? null,
        ],
      );
      await client.query(
        `INSERT INTO ${C.nullifiers} (nullifier, signal_x, signal_y, request_digest, first_proof_hash, epoch, slot)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (nullifier) DO NOTHING`,
        [call.nullifier, call.signalX ?? null, call.signalY ?? null, call.requestDigest ?? null, call.proofHash, call.epoch, call.slot],
      );
      if (commitment) await client.query(
        `INSERT INTO ${C.counts} (commitment, epoch, call_count)
         VALUES ($1, $2, 1)
         ON CONFLICT (commitment, epoch) DO UPDATE
           SET call_count = ${C.counts}.call_count + 1`,
        [commitment, call.epoch],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async findAcceptedCall(criteria: {
    nullifier: string;
    signalX: string;
    signalY: string;
    requestDigest: string;
  }): Promise<AcceptedCall | null> {
    const result = await this.pool.query(
      `SELECT * FROM ${C.calls}
       WHERE nullifier = $1 AND signal_x = $2 AND signal_y = $3 AND request_digest = $4
       ORDER BY accepted_at ASC LIMIT 1`,
      [criteria.nullifier, criteria.signalX, criteria.signalY, criteria.requestDigest],
    );
    return result.rows.length > 0 ? rowToAcceptedCall(result.rows[0] as Record<string, unknown>) : null;
  }

  async recordProviderResponse(
    proofHash: string,
    responseStatus: number,
    responseBody: unknown,
    providerGenerationId?: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ${C.calls}
       SET response_status = $2, response_json = $3, provider_generation_id = $4
       WHERE proof_hash = $1`,
      [proofHash, responseStatus, JSON.stringify(responseBody), providerGenerationId ?? null],
    );
  }

  async listAcceptedCalls(opts: { onlyPendingSpend?: boolean } = {}): Promise<AcceptedCall[]> {
    const where = opts.onlyPendingSpend
      ? "WHERE spent_on_chain = false AND on_chain_spend_tx IS NULL AND settlement_status <> 'quarantined'"
      : '';
    const res = await this.pool.query(
      `SELECT proof_hash, nullifier, signal_x, signal_y, request_digest, epoch, slot, nonce_hash, accepted_at, on_chain_spend_tx, spent_on_chain, settlement_status, settlement_error, proof_json, pub_signals, response_status, response_json, provider_generation_id
       FROM ${C.calls} ${where} ORDER BY accepted_at ASC`,
    );
    return res.rows.map((r) => rowToAcceptedCall(r as Record<string, unknown>));
  }

  async countAcceptedCallsEpoch(epoch: number): Promise<number> {
    const res = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM ${C.calls} WHERE epoch = $1`,
      [epoch],
    );
    return Number(res.rows[0].n);
  }

  async markSpendResult(proofHash: string, onChainSpendTx: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(
        `UPDATE ${C.calls}
         SET on_chain_spend_tx = $2, spent_on_chain = true, settlement_status = 'settled', settlement_error = NULL
         WHERE proof_hash = $1
         RETURNING nullifier`,
        [proofHash, onChainSpendTx],
      );
      if (res.rows.length === 0) {
        throw new Error(`unknown accepted call: ${proofHash}`);
      }
      const nullifier = res.rows[0].nullifier as string;
      await client.query(
        `INSERT INTO ${C.nullifiers} (nullifier, epoch, slot, spent_on_chain, spent_at)
         VALUES ($1, 0, 0, true, now())
         ON CONFLICT (nullifier) DO UPDATE SET spent_on_chain = true, spent_at = now()`,
        [nullifier],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async quarantineSpend(proofHash: string, reason: string): Promise<void> {
    const res = await this.pool.query(
      `UPDATE ${C.calls}
       SET settlement_status = 'quarantined', settlement_error = $2, quarantined_at = now()
       WHERE proof_hash = $1 AND spent_on_chain = false AND on_chain_spend_tx IS NULL
       RETURNING proof_hash`,
      [proofHash, reason],
    );
    if (res.rows.length === 0) {
      const existing = await this.pool.query(
        `SELECT proof_hash FROM ${C.calls} WHERE proof_hash = $1`,
        [proofHash],
      );
      if (existing.rows.length === 0) throw new Error(`unknown accepted call: ${proofHash}`);
    }
  }

  async getNullifier(nullifier: string): Promise<NullifierRecord | null> {
    const res = await this.pool.query(
      `SELECT nullifier, signal_x, signal_y, request_digest, first_proof_hash, epoch, slot, first_seen_at, spent_on_chain, spent_at
       FROM ${C.nullifiers} WHERE nullifier = $1`,
      [nullifier],
    );
    if (res.rows.length === 0) return null;
    return rowToNullifier(res.rows[0] as Record<string, unknown>);
  }

  async markNullifierSeen(
    nullifier: string,
    epoch: number,
    slot: number,
    metadata: { signalX?: string; signalY?: string; requestDigest?: string; proofHash?: string } = {},
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${C.nullifiers} (nullifier, signal_x, signal_y, request_digest, first_proof_hash, epoch, slot)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (nullifier) DO NOTHING`,
      [nullifier, metadata.signalX ?? null, metadata.signalY ?? null, metadata.requestDigest ?? null, metadata.proofHash ?? null, epoch, slot],
    );
  }

  async markNullifierSpentOnChain(nullifier: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${C.nullifiers} (nullifier, epoch, slot, spent_on_chain, spent_at)
       VALUES ($1, 0, 0, true, now())
       ON CONFLICT (nullifier) DO UPDATE SET spent_on_chain = true, spent_at = now()`,
      [nullifier],
    );
  }

  async listNullifiers(): Promise<NullifierRecord[]> {
    const res = await this.pool.query(
      `SELECT nullifier, signal_x, signal_y, request_digest, first_proof_hash, epoch, slot, first_seen_at, spent_on_chain, spent_at
       FROM ${C.nullifiers}`,
    );
    return res.rows.map((r) => rowToNullifier(r as Record<string, unknown>));
  }

  async createApiKey(keyHash: string, commitment: string, label: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${C.keys} (key_hash, commitment, label)
       VALUES ($1, $2, $3)`,
      [keyHash, commitment, label],
    );
  }

  async getApiKey(keyHash: string): Promise<ApiKeyRecord | null> {
    const res = await this.pool.query(
      `SELECT key_hash, commitment, label, issued_at, revoked_at
       FROM ${C.keys} WHERE key_hash = $1 AND revoked_at IS NULL`,
      [keyHash],
    );
    if (res.rows.length === 0) return null;
    return rowToApiKey(res.rows[0] as Record<string, unknown>);
  }

  async listApiKeys(commitment: string): Promise<ApiKeyRecord[]> {
    const res = await this.pool.query(
      `SELECT key_hash, commitment, label, issued_at, revoked_at
       FROM ${C.keys} WHERE commitment = $1 AND revoked_at IS NULL`,
      [commitment],
    );
    return res.rows.map((r) => rowToApiKey(r as Record<string, unknown>));
  }

  async incrementCallCount(commitment: string, epoch: number): Promise<number> {
    await this.pool.query(
      `INSERT INTO ${C.counts} (commitment, epoch, call_count)
       VALUES ($1, $2, 1)
       ON CONFLICT (commitment, epoch) DO UPDATE
         SET call_count = ${C.counts}.call_count + 1`,
      [commitment, epoch],
    );
    return this.getCallCount(commitment);
  }

  async getCallCount(commitment: string): Promise<number> {
    const res = await this.pool.query(
      `SELECT COALESCE(SUM(call_count), 0)::bigint AS total
       FROM ${C.counts} WHERE commitment = $1`,
      [commitment],
    );
    return Number(res.rows[0].total);
  }

  async getAllCallCounts(): Promise<Map<string, number>> {
    const res = await this.pool.query(
      `SELECT commitment, COALESCE(SUM(call_count), 0)::bigint AS total
       FROM ${C.counts} GROUP BY commitment`,
    );
    const out = new Map<string, number>();
    for (const r of res.rows as Array<{ commitment: string; total: string }>) {
      out.set(r.commitment, Number(r.total));
    }
    return out;
  }

  async reserveMembershipLeaf(leaf: {
    leafIndex: number;
    commitment: string;
    candidateRoot: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${C.membershipLeaves} (leaf_index, commitment, status, candidate_root)
       VALUES ($1, $2, 'pending', $3)`,
      [leaf.leafIndex, leaf.commitment, leaf.candidateRoot],
    );
  }

  async activateMembershipLeaf(leafIndex: number, root: string, layers: string[][]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE ${C.membershipLeaves}
         SET status = 'active', updated_at = now()
         WHERE leaf_index = $1 AND status = 'pending' AND candidate_root = $2
         RETURNING leaf_index`,
        [leafIndex, root],
      );
      if (updated.rows.length !== 1) {
        throw new Error(`pending membership leaf/root mismatch: ${leafIndex}`);
      }
      await client.query(
        `INSERT INTO ${C.membershipTreeState} AS state (tree_name, root, version, layers)
         VALUES ('active_membership', $1, 1, $2)
         ON CONFLICT (tree_name) DO UPDATE
           SET root = EXCLUDED.root, version = state.version + 1,
             layers = EXCLUDED.layers, updated_at = now()`,
        [root, JSON.stringify(layers)],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async discardPendingMembershipLeaf(leafIndex: number): Promise<void> {
    const result = await this.pool.query(
      `DELETE FROM ${C.membershipLeaves}
       WHERE leaf_index = $1 AND status = 'pending'
       RETURNING leaf_index`,
      [leafIndex],
    );
    if (result.rows.length !== 1) {
      throw new Error(`pending membership leaf not found: ${leafIndex}`);
    }
  }

  async removeMembershipLeaf(leafIndex: number, root: string, layers: string[][]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE ${C.membershipLeaves}
         SET status = 'removed', updated_at = now()
         WHERE leaf_index = $1 AND status = 'active'
         RETURNING leaf_index`,
        [leafIndex],
      );
      if (updated.rows.length !== 1) {
        throw new Error(`active membership leaf not found: ${leafIndex}`);
      }
      await client.query(
        `INSERT INTO ${C.membershipTreeState} AS state (tree_name, root, version, layers)
         VALUES ('active_membership', $1, 1, $2)
         ON CONFLICT (tree_name) DO UPDATE
           SET root = EXCLUDED.root, version = state.version + 1,
             layers = EXCLUDED.layers, updated_at = now()`,
        [root, JSON.stringify(layers)],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async bootstrapMembershipTree(
    leaves: Array<{ leafIndex: number; commitment: string }>,
    state: { root: string; layers: string[][] },
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT EXISTS (SELECT 1 FROM ${C.membershipLeaves}) AS has_leaves,
                EXISTS (SELECT 1 FROM ${C.membershipTreeState}) AS has_state`,
      );
      if (existing.rows[0]?.has_leaves || existing.rows[0]?.has_state) {
        throw new Error('membership tree bootstrap requires an empty durable store');
      }
      const indices = new Set<number>();
      const commitments = new Set<string>();
      for (const leaf of leaves) {
        if (!Number.isInteger(leaf.leafIndex) || leaf.leafIndex < 0 || leaf.leafIndex >= 8
          || indices.has(leaf.leafIndex) || commitments.has(leaf.commitment)) {
          throw new Error('membership tree bootstrap is malformed');
        }
        indices.add(leaf.leafIndex);
        commitments.add(leaf.commitment);
        await client.query(
          `INSERT INTO ${C.membershipLeaves} (leaf_index, commitment, status, candidate_root)
           VALUES ($1, $2, 'active', $3)`,
          [leaf.leafIndex, leaf.commitment, state.root],
        );
      }
      await client.query(
        `INSERT INTO ${C.membershipTreeState} (tree_name, root, version, layers)
         VALUES ('active_membership', $1, 1, $2)`,
        [state.root, JSON.stringify(state.layers)],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async repairMembershipTree(
    leaves: Array<{ leafIndex: number; commitment: string }>,
    state: { root: string; layers: string[][] },
    expectedStaleRoot: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const currentState = await client.query(
        `SELECT root FROM ${C.membershipTreeState} WHERE tree_name = 'active_membership' FOR UPDATE`,
      );
      const currentRoot = (currentState.rows[0]?.root as string | undefined) ?? null;
      if (currentRoot !== expectedStaleRoot) {
        throw new Error(
          `CAS repair expected stale DB root "${expectedStaleRoot}", but found "${currentRoot ?? 'none'}"`,
        );
      }
      await client.query(`DELETE FROM ${C.membershipLeaves}`);
      await client.query(`DELETE FROM ${C.membershipTreeState}`);
      const indices = new Set<number>();
      const commitments = new Set<string>();
      for (const leaf of leaves) {
        if (!Number.isInteger(leaf.leafIndex) || leaf.leafIndex < 0 || leaf.leafIndex >= 8
          || indices.has(leaf.leafIndex) || commitments.has(leaf.commitment)) {
          throw new Error('membership tree repair is malformed');
        }
        indices.add(leaf.leafIndex);
        commitments.add(leaf.commitment);
        await client.query(
          `INSERT INTO ${C.membershipLeaves} (leaf_index, commitment, status, candidate_root)
           VALUES ($1, $2, 'active', $3)`,
          [leaf.leafIndex, leaf.commitment, state.root],
        );
      }
      await client.query(
        `INSERT INTO ${C.membershipTreeState} (tree_name, root, version, layers)
         VALUES ('active_membership', $1, 1, $2)`,
        [state.root, JSON.stringify(state.layers)],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async listMembershipLeaves(): Promise<MembershipLeaf[]> {
    const result = await this.pool.query(
      `SELECT leaf_index, commitment, status, candidate_root, created_at, updated_at
       FROM ${C.membershipLeaves} ORDER BY leaf_index ASC`,
    );
    return result.rows.map((row) => rowToMembershipLeaf(row as Record<string, unknown>));
  }

  async getMembershipTreeState(): Promise<MembershipTreeState | null> {
    const result = await this.pool.query(
      `SELECT root, version, layers, updated_at FROM ${C.membershipTreeState}
       WHERE tree_name = 'active_membership'`,
    );
    return result.rows.length > 0
      ? rowToMembershipTreeState(result.rows[0] as Record<string, unknown>)
      : null;
  }
}

// ─── Store factory + restart reconstruction ───────────────────────

export type GatewayStoreKind = 'memory' | 'postgres';

export function createGatewayStore(kind: GatewayStoreKind, pool?: Pool): GatewayStore {
  if (kind === 'memory') return new MemoryGatewayStore();
  if (!pool) throw new Error('PostgresGatewayStore requires a Pool');
  return new PostgresGatewayStore(pool);
}

/**
 * Restart durability: rebuild the fast-path in-memory caches from durable
 * rows so a gateway restart never re-accepts a seen nullifier or resets a
 * user's call counts (v1 reset these on restart — the defect M2.2 fixes).
 */
export async function reconstructGatewayState(store: GatewayStore): Promise<ReconstructedState> {
  const nullifiers = new Set<string>();
  for (const rec of await store.listNullifiers()) {
    nullifiers.add(rec.nullifier);
  }
  return { nullifiers, callCounts: await store.getAllCallCounts() };
}
