// PostgreSQL connection configuration for the Base zk-prepaid gateway.
// Fails closed: calling getDbConfig() with no DATABASE_URL and no PG* vars
// throws DbConfigError instead of silently defaulting to localhost.

import type { PoolConfig } from 'pg';

// `evaluation` and the legacy fee-sponsor migration remain historical. They
// are intentionally not part of the active application schema registry.
// `control_plane` (GitHub-facing invites) and `pilot_provisioning` (detached
// funding capabilities) are separate schemas with no durable join.
export const SCHEMAS = ['gateway', 'billing', 'evaluation', 'spend_plane', 'control_plane', 'pilot_provisioning'] as const;
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
