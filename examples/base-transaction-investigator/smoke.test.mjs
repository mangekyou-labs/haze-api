import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('prepaid smoke skips before reading configuration or loading a credential runtime', () => {
  const result = spawnSync(process.execPath, ['prepaid-smoke.mjs'], {
    cwd: new URL('.', import.meta.url), encoding: 'utf8',
    env: { ...process.env, INVESTIGATOR_SMOKE_CONFIG: '/does/not/exist', ZK_CREDITS_CREDENTIAL_PATH: '/must/not/read' },
  });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { status: 'SKIP', reason: 'explicit_prepaid_consumption_not_authorized' });
  assert.equal(result.stderr, '');
});
