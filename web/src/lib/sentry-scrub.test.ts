import { describe, expect, it } from 'vitest';
import { scrubSentryEvent } from './sentry-scrub';

describe('web Sentry recursive scrubber', () => {
  it('removes sensitive keys at every nested level and inside arrays', () => {
    const scrubbed = scrubSentryEvent({
      message: 'safe operational error',
      request: {
        headers: { Authorization: 'Bearer secret', cookie: 'session' },
        body: { prompt: 'private prompt', ok: true },
      },
      contexts: {
        nested: [{ walletAddress: 'GSECRET', status: 'failed' }],
      },
      tags: { route: '/v1/chat/completions' },
    });

    expect(scrubbed).toEqual({
      message: 'safe operational error',
      request: '[Filtered]',
      contexts: {
        nested: [{ walletAddress: '[Filtered]', status: 'failed' }],
      },
      tags: { route: '/v1/chat/completions' },
    });
  });

  it('bounds recursion without retaining deep private payloads', () => {
    const deep: Record<string, unknown> = { safe: true };
    let cursor = deep;
    for (let index = 0; index < 10; index += 1) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }
    cursor.signature = 'deep-secret';

    const scrubbed = scrubSentryEvent({ contexts: deep }) as { contexts: Record<string, unknown> };
    expect(JSON.stringify(scrubbed)).not.toContain('deep-secret');
  });
});
