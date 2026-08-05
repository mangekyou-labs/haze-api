// Fee-relay request store (M2.4). Idempotency on the inner tx hash so a given
// slash/withdraw inner transaction is fee-bumped at most once, even across
// gateway/service restarts and client retries.

export interface FeeRelayRequest {
  innerTxHash: string;
  method: 'slash' | 'withdraw';
  contractId: string;
  innerTxXdr: string;
  status: 'received' | 'submitted' | 'failed';
  feeBumpHash: string | null;
  submittedAt: Date | null;
  createdAt: Date;
}

export interface FeeSponsorStore {
  /** Record a first-time relay; returns the existing request on a duplicate. */
  recordRelayRequestOnce(
    req: Omit<FeeRelayRequest, 'status' | 'feeBumpHash' | 'submittedAt' | 'createdAt'>,
  ): Promise<{ inserted: boolean; request: FeeRelayRequest }>;
  markSubmitted(innerTxHash: string, feeBumpHash: string): Promise<void>;
  markFailed(innerTxHash: string): Promise<void>;
  getRequest(innerTxHash: string): Promise<FeeRelayRequest | null>;
  listRequests(): Promise<FeeRelayRequest[]>;
}

// ─── In-memory implementation (offline tests / dev) ─────────────

export class MemoryFeeSponsorStore implements FeeSponsorStore {
  private requests = new Map<string, FeeRelayRequest>();

  async recordRelayRequestOnce(
    req: Omit<FeeRelayRequest, 'status' | 'feeBumpHash' | 'submittedAt' | 'createdAt'>,
  ): Promise<{ inserted: boolean; request: FeeRelayRequest }> {
    const existing = this.requests.get(req.innerTxHash);
    if (existing) return { inserted: false, request: existing };
    const request: FeeRelayRequest = {
      ...req,
      status: 'received',
      feeBumpHash: null,
      submittedAt: null,
      createdAt: new Date(),
    };
    this.requests.set(req.innerTxHash, request);
    return { inserted: true, request };
  }

  async markSubmitted(innerTxHash: string, feeBumpHash: string): Promise<void> {
    const existing = this.requests.get(innerTxHash);
    if (!existing) return;
    existing.status = 'submitted';
    existing.feeBumpHash = feeBumpHash;
    existing.submittedAt = new Date();
  }

  async markFailed(innerTxHash: string): Promise<void> {
    const existing = this.requests.get(innerTxHash);
    if (!existing) return;
    existing.status = 'failed';
  }

  async getRequest(innerTxHash: string): Promise<FeeRelayRequest | null> {
    return this.requests.get(innerTxHash) ?? null;
  }

  async listRequests(): Promise<FeeRelayRequest[]> {
    return [...this.requests.values()];
  }

  /** Test/dev helper. */
  reset(): void {
    this.requests.clear();
  }
}

// ─── PostgreSQL implementation ────────────────────────────────────

import type { Pool } from 'pg';

function rowToRequest(r: Record<string, unknown>): FeeRelayRequest {
  return {
    innerTxHash: r.inner_tx_hash as string,
    method: r.method as FeeRelayRequest['method'],
    contractId: r.contract_id as string,
    innerTxXdr: r.inner_tx_xdr as string,
    status: r.status as FeeRelayRequest['status'],
    feeBumpHash: (r.fee_bump_hash as string) ?? null,
    submittedAt: (r.submitted_at as Date) ?? null,
    createdAt: r.created_at as Date,
  };
}

export class PostgresFeeSponsorStore implements FeeSponsorStore {
  constructor(private readonly pool: Pool) {}

  async recordRelayRequestOnce(
    req: Omit<FeeRelayRequest, 'status' | 'feeBumpHash' | 'submittedAt' | 'createdAt'>,
  ): Promise<{ inserted: boolean; request: FeeRelayRequest }> {
    let insert: { rows: Array<Record<string, unknown>> };
    try {
      insert = await this.pool.query(
        `INSERT INTO "fee-sponsor".fee_relay_requests (inner_tx_hash, method, contract_id, inner_tx_xdr)
         VALUES ($1, $2, $3, $4)
         RETURNING inner_tx_hash, method, contract_id, inner_tx_xdr, status, fee_bump_hash, submitted_at, created_at`,
        [req.innerTxHash, req.method, req.contractId, req.innerTxXdr],
      );
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === '23505') {
        const existing = await this.getRequest(req.innerTxHash);
        if (!existing) throw err;
        return { inserted: false, request: existing };
      }
      throw err;
    }
    return { inserted: true, request: rowToRequest(insert.rows[0]) };
  }

  async markSubmitted(innerTxHash: string, feeBumpHash: string): Promise<void> {
    await this.pool.query(
      `UPDATE "fee-sponsor".fee_relay_requests
       SET status = 'submitted', fee_bump_hash = $2, submitted_at = now()
       WHERE inner_tx_hash = $1`,
      [innerTxHash, feeBumpHash],
    );
  }

  async markFailed(innerTxHash: string): Promise<void> {
    await this.pool.query(
      `UPDATE "fee-sponsor".fee_relay_requests SET status = 'failed' WHERE inner_tx_hash = $1`,
      [innerTxHash],
    );
  }

  async getRequest(innerTxHash: string): Promise<FeeRelayRequest | null> {
    const res = await this.pool.query(
      `SELECT inner_tx_hash, method, contract_id, inner_tx_xdr, status, fee_bump_hash, submitted_at, created_at
       FROM "fee-sponsor".fee_relay_requests WHERE inner_tx_hash = $1`,
      [innerTxHash],
    );
    if (res.rows.length === 0) return null;
    return rowToRequest(res.rows[0] as Record<string, unknown>);
  }

  async listRequests(): Promise<FeeRelayRequest[]> {
    const res = await this.pool.query(
      `SELECT inner_tx_hash, method, contract_id, inner_tx_xdr, status, fee_bump_hash, submitted_at, created_at
       FROM "fee-sponsor".fee_relay_requests ORDER BY created_at ASC`,
    );
    return res.rows.map((r) => rowToRequest(r as Record<string, unknown>));
  }
}
