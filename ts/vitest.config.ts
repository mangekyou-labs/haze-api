import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

const circuitsDir = resolve(process.cwd(), '..', 'circuits');

export default defineConfig({
  test: {
    env: {
      TEST_MODE: 'true',
      CIRCUITS_DIR: circuitsDir,
    },
  },
});
