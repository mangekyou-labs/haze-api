import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock('@sentry/node', () => ({ init: mocks.init }));

import { initGatewaySentry } from './sentry.js';

describe('gateway Sentry initialization', () => {
  it('does not initialize without a DSN', () => {
    mocks.init.mockClear();
    initGatewaySentry({});
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it('initializes without PII and scrubs events before sending', () => {
    mocks.init.mockClear();
    initGatewaySentry({ SENTRY_DSN: 'https://public@example.invalid/1', NODE_ENV: 'test' });
    const options = mocks.init.mock.calls[0]?.[0] as {
      sendDefaultPii: boolean;
      beforeSend: (event: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(options.sendDefaultPii).toBe(false);
    expect(options.beforeSend({ request: { body: { walletAddress: 'GSECRET' } }, tags: { route: '/v1/evaluation/status' } })).toEqual({
      request: '[Filtered]',
      tags: { route: '/v1/evaluation/status' },
    });
  });
});
