// Idempotent SQL migration runner for the stellar-launch gateway.
// Applies `.sql` files in `migrations/` in filename order, each inside a
// transaction, and records applied files in `public.schema_migrations`.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(
  pool: Pool,
  migrationsDir: string,
): Promise<MigrationResult> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        filename    text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      );`);

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const applied = new Set<string>(
      (await client.query('SELECT filename FROM public.schema_migrations')).rows.map(
        (r) => r.filename as string,
      ),
    );

    const newlyApplied: string[] = [];
    const skipped: string[] = [];

    for (const file of files) {
      if (applied.has(file)) {
        skipped.push(file);
        continue;
      }
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO public.schema_migrations (filename) VALUES ($1)', [
          file,
        ]);
        await client.query('COMMIT');
        newlyApplied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(
          `Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { applied: newlyApplied, skipped };
  } finally {
    client.release();
  }
}