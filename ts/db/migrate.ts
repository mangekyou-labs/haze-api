import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface MigrationClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface MigrationPool {
  connect(): Promise<MigrationClient & { release(): void }>;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(
  pool: MigrationPool,
  migrationsDir: string,
): Promise<MigrationResult> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const files = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
    const appliedRows = await client.query('SELECT filename FROM public.schema_migrations');
    const applied = new Set(appliedRows.rows.map((row) => String(row.filename)));
    const result: MigrationResult = { applied: [], skipped: [] };

    for (const file of files) {
      if (applied.has(file)) {
        result.skipped.push(file);
        continue;
      }
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO public.schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        result.applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return result;
  } finally {
    client.release();
  }
}
