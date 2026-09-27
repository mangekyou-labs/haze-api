import { describe, expect, it } from 'vitest';
import { scrubSentryEvent } from './observability.js';

describe('Sentry privacy boundary', () => {
  it('removes request, identity, wallet, proof, and secret fields', () => {
    const scrubbed = scrubSentryEvent({
      message: 'safe error code',
      tags: { errorCode: 'gateway_timeout' },
      request: { body: 'private prompt', headers: { authorization: 'secret' } },
      contexts: { wallet: 'GABC', request: { url: '/private' } },
      extra: { proof: 'raw proof', commitment: '123', durationMs: 120 },
    });

    expect(scrubbed).toEqual({
      message: 'safe error code',
      tags: { errorCode: 'gateway_timeout' },
      contexts: {},
      extra: { durationMs: 120 },
    });
  });
});
