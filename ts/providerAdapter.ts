// Provider Adapter interface — pluggable upstream layer
// Design doc: v1 ships OpenRouter, v2+ adds financial/data adapters

export interface ProviderAdapter {
  id: string;

  forwardRequest(
    userPayload: unknown,
    providerAuth: string,
  ): Promise<Response>;

  computeCost?(userPayload: unknown): bigint;
}

export interface ProviderResponse {
  status: number;
  body: unknown;
}

// ─── OpenRouter Adapter (v1) ──────────────────────────────────────

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const FLAT_COST_PER_CALL = 1000n;

export class OpenRouterAdapter implements ProviderAdapter {
  id = 'openrouter';

  async forwardRequest(
    userPayload: unknown,
    providerAuth: string,
  ): Promise<Response> {
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${providerAuth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(userPayload),
    });
    return response;
  }

  computeCost(_userPayload: unknown): bigint {
    return FLAT_COST_PER_CALL;
  }
}

// ─── Mock Adapter (for testing) ───────────────────────────────────

export class MockProviderAdapter implements ProviderAdapter {
  id = 'mock';

  async forwardRequest(
    userPayload: unknown,
    _providerAuth: string,
  ): Promise<Response> {
    const body = JSON.stringify({
      id: 'mock-response',
      object: 'chat.completion',
      choices: [{
        message: {
          role: 'assistant',
          content: `Mock response to: ${JSON.stringify(userPayload).slice(0, 100)}`,
        },
      }],
    });
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  computeCost(_userPayload: unknown): bigint {
    return 0n;
  }
}

// ─── Adapter registry ─────────────────────────────────────────────

const registry = new Map<string, ProviderAdapter>();

export function registerAdapter(adapter: ProviderAdapter): void {
  registry.set(adapter.id, adapter);
}

export function getAdapter(id: string): ProviderAdapter | undefined {
  return registry.get(id);
}

export function clearAdapters(): void {
  registry.clear();
}
