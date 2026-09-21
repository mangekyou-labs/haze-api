import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  OpenRouterAdapter,
  MockProviderAdapter,
  registerAdapter,
  getAdapter,
  clearAdapters,
  ProviderAdapter,
} from './providerAdapter.js';

describe('ProviderAdapter interface', () => {
  beforeEach(() => {
    clearAdapters();
  });

  describe('MockProviderAdapter', () => {
    it('implements the interface', () => {
      const adapter: ProviderAdapter = new MockProviderAdapter();
      expect(adapter.id).toBe('mock');
    });

    it('returns a valid chat completion response', async () => {
      const adapter = new MockProviderAdapter();
      const response = await adapter.forwardRequest(
        { model: 'test', messages: [{ role: 'user', content: 'hello' }] },
        'sk-test',
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.choices[0].message.content).toContain('Mock response');
    });

    it('computeCost returns 0', () => {
      const adapter = new MockProviderAdapter();
      expect(adapter.computeCost!({})).toBe(0n);
    });
  });

  describe('OpenRouterAdapter', () => {
    it('has correct id', () => {
      const adapter = new OpenRouterAdapter();
      expect(adapter.id).toBe('openrouter');
    });

    it('computeCost returns flat rate', () => {
      const adapter = new OpenRouterAdapter();
      expect(adapter.computeCost!({})).toBe(1000n);
    });

    it.each([
      ['chat.completions', 'https://openrouter.ai/api/v1/chat/completions'],
      ['responses', 'https://openrouter.ai/api/v1/responses'],
    ] as const)('maps %s to the OpenRouter HTTP path', async (endpoint, expectedUrl) => {
      const fetchMock = vi.fn(async () => new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
      vi.stubGlobal('fetch', fetchMock);
      try {
        const adapter = new OpenRouterAdapter();
        await adapter.forwardRequest({ model: 'test' }, 'sk-test', endpoint);

        expect(fetchMock).toHaveBeenCalledWith(expectedUrl, expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
        }));
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it.skip('forwardRequest returns 401 without API key (manual integration test)', async () => {
      const adapter = new OpenRouterAdapter();
      const response = await adapter.forwardRequest(
        { model: 'test', messages: [] },
        '',
      );
      expect(response.status).toBe(401);
    });
  });

  describe('registry', () => {
    it('registers and retrieves adapters', () => {
      const mock = new MockProviderAdapter();
      registerAdapter(mock);
      expect(getAdapter('mock')).toBe(mock);
    });

    it('returns undefined for unknown adapter', () => {
      expect(getAdapter('nonexistent')).toBeUndefined();
    });

    it('clear removes all adapters', () => {
      registerAdapter(new MockProviderAdapter());
      clearAdapters();
      expect(getAdapter('mock')).toBeUndefined();
    });
  });
});
