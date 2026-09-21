import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatMonitorSummary,
  normalizeBaseUrl,
  resolveMonitorConfig,
  runMonitor,
} from './level4-synthetic.mjs';

const completeEnv = {
  LEVEL4_FRONTEND_URL: 'https://frontend.example.test/',
  LEVEL4_GATEWAY_URL: 'https://gateway.example.test/',
  LEVEL4_FEE_SPONSOR_URL: 'https://fee.example.test/',
};

test('normalizes public service URLs and rejects credentials or unsupported protocols', () => {
  assert.equal(normalizeBaseUrl('https://example.test/launch/'), 'https://example.test/launch');
  assert.throws(() => normalizeBaseUrl('ftp://example.test'), /http or https/);
  assert.throws(() => normalizeBaseUrl('https://user:password@example.test'), /credentials/);
});

test('requires all Level 4 service variables', () => {
  assert.throws(
    () => resolveMonitorConfig({ LEVEL4_FRONTEND_URL: completeEnv.LEVEL4_FRONTEND_URL }),
    /LEVEL4_GATEWAY_URL, LEVEL4_FEE_SPONSOR_URL/,
  );
});

test('runs one bounded retry and labels sequential passes cold then warm', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) return new Response('temporary', { status: 503 });
    return new Response('', { status: 200 });
  };

  const result = await runMonitor({
    env: completeEnv,
    passes: 3,
    retries: 1,
    retryDelayMs: 0,
    timeoutMs: 100,
    fetchImpl,
  });

  assert.deepEqual(result.passes.map((pass) => pass.kind), ['cold', 'warm', 'warm']);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 13);
  const summary = formatMonitorSummary(result);
  assert.match(summary, /cold/);
  assert.match(summary, /warm/);
  assert.doesNotMatch(summary, /frontend\.example\.test|gateway\.example\.test|fee\.example\.test/);
});
