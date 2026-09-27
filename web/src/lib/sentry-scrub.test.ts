import { describe, expect, it } from 'vitest';
import { scrubSentryEvent } from './sentry-scrub';

describe('Sentry privacy boundary', () => {
  it('keeps coarse error context and removes private fields', () => {
    expect(scrubSentryEvent({
      message: 'safe error code',
      tags: { errorCode: 'gateway_timeout' },
      request: { body: 'prompt' },
      extra: { signature: 'raw', durationMs: 120 },
    })).toEqual({
      message: 'safe error code',
      tags: { errorCode: 'gateway_timeout' },
      extra: { durationMs: 120 },
    });
  });
});
