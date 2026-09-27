import { describe, expect, it } from 'vitest';
import { runMigrations, type MigrationPool } from './migrate.js';

describe('runMigrations', () => {
  it('applies files in order and skips already-recorded files', async () => {
    const queries: string[] = [];
    const applied = new Set<string>();
    const pool: MigrationPool = {
      async connect() {
        return {
          async query(text: string, values?: readonly unknown[]) {
            queries.push(text);
            if (text.startsWith('SELECT filename')) {
              return { rows: Array.from(applied, (filename) => ({ filename })) };
            }
            if (text.startsWith('INSERT INTO public.schema_migrations')) {
              applied.add(String(values?.[0]));
            }
            return { rows: [] };
          },
          release() {},
        };
      },
    };
    const first = await runMigrations(pool, new URL('./migrations', import.meta.url).pathname);
    expect(first.applied).toContain('0009_evaluation.sql');
    const second = await runMigrations(pool, new URL('./migrations', import.meta.url).pathname);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toContain('0009_evaluation.sql');
    expect(queries.filter((query) => query === 'COMMIT').length).toBe(1);
  });
});
