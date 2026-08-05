// PostgreSQL Pool factory for the stellar-launch gateway. Fails closed via
// getDbConfig() — a missing database config throws at construction time.

import { Pool } from 'pg';
import { getDbConfig } from './config.js';

export function createPool(env: NodeJS.ProcessEnv = process.env): Pool {
  const { poolConfig } = getDbConfig(env);
  return new Pool(poolConfig);
}