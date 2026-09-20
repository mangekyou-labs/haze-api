import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['archive/**', 'node_modules/**'],
  },
});
