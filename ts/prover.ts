// Browser Groth16 Prover — wraps snarkjs for browser proof generation
// with per-session proof caching

import { createRequire } from 'module';
import { resolve } from 'path';

const require = createRequire(import.meta.url);
const snarkjs = require('snarkjs');

const CIRCUITS_DIR = process.env.CIRCUITS_DIR || resolve(import.meta.dirname!, '..', '..', 'circuits');

export interface ZkInput {
  secret_k: string;
  signal_value: string;
  epoch: string;
  merkle_path_elements: string[];
  merkle_path_indices: string[];
}

export interface ProofResult {
  proof: object;
  publicSignals: string[];
}

// ─── Proof Cache ──────────────────────────────────────────────────

export class ProofCache {
  private cache = new Map<string, Promise<ProofResult>>();
  hits = 0;
  misses = 0;

  stableKey(input: unknown): string {
    const sorted = this.sortKeys(input);
    return JSON.stringify(sorted);
  }

  private sortKeys(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      return obj.map((v) => this.sortKeys(v));
    }
    if (obj !== null && typeof obj === 'object') {
      const keys = Object.keys(obj as Record<string, unknown>).sort();
      const sorted: Record<string, unknown> = {};
      for (const k of keys) {
        sorted[k] = this.sortKeys((obj as Record<string, unknown>)[k]);
      }
      return sorted;
    }
    return obj;
  }

  async getOrCompute(
    key: string,
    generator: () => Promise<ProofResult>,
  ): Promise<ProofResult> {
    const existing = this.cache.get(key);
    if (existing) {
      this.hits++;
      return existing;
    }
    this.misses++;
    const promise = generator();
    this.cache.set(key, promise);
    return promise;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  get size(): number {
    return this.cache.size;
  }
}

// ─── Global cache instance ───────────────────────────────────────

const rlnCache = new ProofCache();

export function getRlnCache(): ProofCache {
  return rlnCache;
}

// ─── Prover stats ─────────────────────────────────────────────────

let provingTime = 0;
let provingCount = 0;

export function getProverStats(): { avgMs: number; count: number; cacheHits: number; cacheMisses: number } {
  return {
    avgMs: provingCount > 0 ? Math.round(provingTime / provingCount) : 0,
    count: provingCount,
    cacheHits: rlnCache.hits,
    cacheMisses: rlnCache.misses,
  };
}

export function clearProverCache(): void {
  rlnCache.clear();
}

// ─── Proof generation ─────────────────────────────────────────────

export async function generateRlnProof(input: ZkInput): Promise<ProofResult> {
  const start = Date.now();

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    resolve(CIRCUITS_DIR, 'rln_nullifier.wasm'),
    resolve(CIRCUITS_DIR, 'rln_nullifier_final.zkey'),
  );

  provingTime += Date.now() - start;
  provingCount += 1;

  return { proof, publicSignals };
}

export async function generateRlnProofCached(input: ZkInput): Promise<ProofResult> {
  const key = rlnCache.stableKey(input);
  return rlnCache.getOrCompute(key, () => generateRlnProof(input));
}

export async function generateDepositProof(input: {
  secret_k: string;
  merkle_path_elements: string[];
  merkle_path_indices: string[];
}): Promise<ProofResult> {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    resolve(CIRCUITS_DIR, 'deposit_membership.wasm'),
    resolve(CIRCUITS_DIR, 'deposit_membership_final.zkey'),
  );
  return { proof, publicSignals };
}
