import { createPool } from './db/client.js';
import { PostgresEvaluationStore } from './evaluation-postgres.js';

/** Purge restricted wallet material whose 90-day retention deadline has passed. */
async function main(): Promise<void> {
  const pool = createPool();
  try {
    const purged = await new PostgresEvaluationStore(pool).purgeExpired();
    console.log(JSON.stringify({ purged }));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Evaluation retention purge failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});
