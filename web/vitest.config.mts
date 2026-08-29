import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Web unit tests run pure, isomorphic helpers (re-exported from
// @zk-credits/shared) in Node — no browser needed. The circuit-backed
// commitment path (fetch `/circuits/*`) is exercised by the Playwright E2E.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
    },
  },
});