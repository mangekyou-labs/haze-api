import { Pool } from 'pg';
import { getDbConfig } from './config.js';

export function createPool(env: NodeJS.ProcessEnv = process.env): Pool {
  return new Pool(getDbConfig(env).poolConfig);
}
