import { describe, expect, it } from 'vitest';
import {
  createLoopbackToken,
  formatOpenAiEnvironment,
  sidecarStatePaths,
} from './sidecar-config.js';

describe('sidecar configuration', () => {
  it('formats a standard OpenAI configuration with a local-only random bearer', () => {
    const output = formatOpenAiEnvironment('http://127.0.0.1:3210', 'zk-local-token');

    expect(output).toBe([
      'export OPENAI_BASE_URL=http://127.0.0.1:3210/v1',
      'export OPENAI_API_KEY=zk-local-token',
    ].join('\n'));
  });

  it('creates URL-safe entropy and keeps ledger/token state under one private directory', () => {
    expect(createLoopbackToken()).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(sidecarStatePaths('/tmp/zk-credits-test')).toEqual({
      ledgerPath: '/tmp/zk-credits-test/tickets.json',
      tokenPath: '/tmp/zk-credits-test/loopback-token',
    });
  });
});
