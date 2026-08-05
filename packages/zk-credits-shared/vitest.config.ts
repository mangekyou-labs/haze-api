import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const circuitsDir = resolve(import.meta.dirname, '..', '..', 'circuits');

export default defineConfig({
  test: {
    env: {
      CIRCUITS_DIR: circuitsDir,
    },
    testTimeout: 120_000,
  },
});
