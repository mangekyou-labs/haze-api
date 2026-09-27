import { createPool } from './db/client.js';
import { DbConfigError } from './db/config.js';
import { PostgresEvaluationStore, type EvaluationStoreLike } from './evaluation-postgres.js';
import { MemoryEvaluationStore } from './evaluation.js';

export interface EvaluationStoreSelection {
  store: EvaluationStoreLike;
  persistence: 'memory' | 'postgres';
  close?: () => Promise<void>;
}

/**
 * Production uses Postgres whenever DATABASE_URL/PG* is configured. Tests and
 * local demos can stay deterministic with the explicit memory fallback.
 */
export function createEvaluationStore(env: NodeJS.ProcessEnv = process.env): EvaluationStoreSelection {
  const hasDatabase = Boolean(env.DATABASE_URL || env.PGHOST || env.PGPORT || env.PGUSER || env.PGPASSWORD || env.PGDATABASE);
  if (env.EVALUATION_STORE === 'memory') {
    return { store: new MemoryEvaluationStore(), persistence: 'memory' };
  }
  if (!hasDatabase) {
    if (env.NODE_ENV === 'production') {
      throw new DbConfigError(
        'Evaluation persistence is required in production. Set DATABASE_URL or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE.',
      );
    }
    return { store: new MemoryEvaluationStore(), persistence: 'memory' };
  }
  const pool = createPool(env);
  return {
    store: new PostgresEvaluationStore(pool),
    persistence: 'postgres',
    close: async () => pool.end(),
  };
}
