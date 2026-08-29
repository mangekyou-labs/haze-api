// PostgreSQL connection configuration for the stellar-launch gateway.
// Fails closed: calling getDbConfig() with no DATABASE_URL and no PG* vars
// throws DbConfigError instead of silently defaulting to localhost.

import type { PoolConfig } from 'pg';

export const SCHEMAS = ['gateway', 'billing', 'fee-sponsor'] as const;
export type SchemaName = (typeof SCHEMAS)[number];

export class DbConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbConfigError';
  }
}

export interface DbConfig {
  poolConfig: PoolConfig;
  databaseUrl?: string;
}

const MISSING_MSG =
  'Database is not configured. Set DATABASE_URL (postgres://user:pass@host:port/db) ' +
  'or the PG* vars (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE).';

export function getDbConfig(env: NodeJS.ProcessEnv = process.env): DbConfig {
  const url = env.DATABASE_URL;
  const pgHost = env.PGHOST;
  const pgPort = env.PGPORT;
  const pgUser = env.PGUSER;
  const pgPass = env.PGPASSWORD;
  const pgDb = env.PGDATABASE;

  const hasComposite = !!(pgHost || pgPort || pgUser || pgPass || pgDb);

  if (!url && !hasComposite) {
    throw new DbConfigError(MISSING_MSG);
  }

  if (url) {
    return { databaseUrl: url, poolConfig: { connectionString: url } };
  }

  let port: number | undefined;
  if (pgPort !== undefined && pgPort !== '') {
    port = Number(pgPort);
    if (!Number.isInteger(port) || port <= 0) {
      throw new DbConfigError(`Invalid PGPORT: "${pgPort}" (expected a positive integer).`);
    }
  }

  return {
    poolConfig: {
      host: pgHost,
      port,
      user: pgUser,
      password: pgPass,
      database: pgDb,
    },
  };
}