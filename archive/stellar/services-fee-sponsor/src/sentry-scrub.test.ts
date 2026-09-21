import assert from 'node:assert/strict';
import test from 'node:test';
import { scrubSentryEvent } from './sentry-scrub.js';

test('fee sponsor scrubber removes nested wallet and request data', () => {
  assert.deepEqual(scrubSentryEvent({
    message: 'fee relay error',
    request: { body: { signature: 'private-signature' } },
    contexts: { relay: [{ walletAddress: 'GSECRET', status: 'failed' }] },
    tags: { route: '/v1/fee-relay' },
  }), {
    message: 'fee relay error',
    request: '[Filtered]',
    contexts: { relay: [{ walletAddress: '[Filtered]', status: 'failed' }] },
    tags: { route: '/v1/fee-relay' },
  });
});
