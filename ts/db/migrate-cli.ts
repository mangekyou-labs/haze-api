import { resolve } from 'node:path';

import { createPool } from './client.js';
import { runMigrations } from './migrate.js';

async function main(): Promise<void> {
  const pool = createPool();
  try {
    const result = await runMigrations(pool, resolve(__dirname, 'migrations'));
    console.log(JSON.stringify(result));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Database migration failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});
