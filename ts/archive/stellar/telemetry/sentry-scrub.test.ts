import { describe, expect, it } from 'vitest';
import { scrubSentryEvent } from './sentry-scrub.js';

describe('gateway Sentry recursive scrubber', () => {
  it('filters sensitive request and nested wallet fields while preserving safe context', () => {
    expect(scrubSentryEvent({
      message: 'gateway error',
      request: { headers: { authorization: 'Bearer secret' }, body: { prompt: 'private' } },
      contexts: { evaluation: [{ walletAddress: 'GSECRET', status: 'failed' }] },
      tags: { route: '/v1/evaluation/status' },
    })).toEqual({
      message: 'gateway error',
      request: '[Filtered]',
      contexts: { evaluation: [{ walletAddress: '[Filtered]', status: 'failed' }] },
      tags: { route: '/v1/evaluation/status' },
    });
  });

  it('does not retain private payloads beyond the recursion limit', () => {
    const deep: Record<string, unknown> = { safe: true };
    let cursor = deep;
    for (let index = 0; index < 10; index += 1) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }
    cursor.signature = 'deep-secret';
    expect(JSON.stringify(scrubSentryEvent({ contexts: deep }))).not.toContain('deep-secret');
  });
});
