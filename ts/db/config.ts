// PostgreSQL configuration for the gateway's durable stores.
// No implicit localhost fallback is allowed in deployment.

export const SCHEMAS = ['gateway', 'billing', 'fee-sponsor', 'evaluation'] as const;
export type SchemaName = (typeof SCHEMAS)[number];

export class DbConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbConfigError';
  }
}

export interface DbConfig {
  poolConfig: {
    connectionString?: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
  };
  databaseUrl?: string;
}

const MISSING_MSG =
  'Database is not configured. Set DATABASE_URL or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE.';

export function getDbConfig(env: NodeJS.ProcessEnv = process.env): DbConfig {
  const url = env.DATABASE_URL;
  const pgHost = env.PGHOST;
  const pgPort = env.PGPORT;
  const pgUser = env.PGUSER;
  const pgPass = env.PGPASSWORD;
  const pgDb = env.PGDATABASE;
  const hasComposite = Boolean(pgHost || pgPort || pgUser || pgPass || pgDb);
  if (!url && !hasComposite) throw new DbConfigError(MISSING_MSG);
  if (url) return { databaseUrl: url, poolConfig: { connectionString: url } };

  let port: number | undefined;
  if (pgPort) {
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
