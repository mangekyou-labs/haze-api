import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const circuitsDir = resolve(import.meta.dirname, '..', '..', 'circuits');

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/archive/**', '**/dist/**'],
    env: {
      CIRCUITS_DIR: circuitsDir,
    },
    testTimeout: 120_000,
  },
});
