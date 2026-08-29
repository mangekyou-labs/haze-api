import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

const circuitsDir = resolve(process.cwd(), '..', 'circuits');

export default defineConfig({
  test: {
    env: {
      TEST_MODE: 'true',
      CIRCUITS_DIR: circuitsDir,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Node built-ins + entry-point-only modules are exercised through the
      // server/supertest suites; exclude generated/onboarding code paths that
      // need a browser (IndexedDB) to keep the gateway report meaningful.
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        'storage.ts',
        'db/migrations/**',
        '**/*.d.ts',
      ],
    },
  },
});
