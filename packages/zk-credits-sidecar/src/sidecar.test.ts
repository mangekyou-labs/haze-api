import { describe, expect, it, vi } from 'vitest';
import { encodeHeader, PAYMENT_RESPONSE_HEADER } from '@zk-credits/x402-zk-prepaid';
import { createBaseProofMetrics } from './proof-metrics.js';
import { createSidecarServer } from './sidecar.js';

const localToken = 'zk-local-test-token';

async function startTestSidecar(
  fetcher: (input: string, init?: RequestInit) => Promise<Response>,
  metrics?: () => ReturnType<ReturnType<typeof createBaseProofMetrics>['snapshot']>,
) {
  const sidecar = createSidecarServer({
    localToken,
    gatewayBaseUrl: 'https://gateway.example',
    prepaidClient: { fetch: fetcher },
    ...(metrics ? { metrics } : {}),
  });
  const address = await sidecar.listen(0);
  return { address, sidecar };
}

describe('loopback x402 sidecar', () => {
  it('keeps health and model discovery local', async () => {
    const fetcher = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
    const { address, sidecar } = await startTestSidecar(fetcher);
    try {
      await expect(fetch(`${address}/health`).then((response) => response.json())).resolves.toEqual({
        service: 'zk-credits-sidecar',
        status: 'ok',
      });
      const models = await fetch(`${address}/v1/models`, { headers: { Authorization: `Bearer ${localToken}` } });
      expect(models.status).toBe(200);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await sidecar.close();
    }
  });

  it('forwards the exact OpenAI request bytes and relays settlement headers', async () => {
    const paymentResponse = encodeHeader({ success: true, transaction: '', network: 'eip155:84532' });
    const rawBody = '{ "model" : "test" ,\n"messages" : [ ] }';
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      expect(input).toBe('https://gateway.example/v1/chat/completions');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe(rawBody);
      return new Response('{"id":"chatcmpl-test"}', {
        status: 200,
        headers: { 'content-type': 'application/json', [PAYMENT_RESPONSE_HEADER]: paymentResponse },
      });
    });
    const { address, sidecar } = await startTestSidecar(fetcher);
    try {
      const response = await fetch(`${address}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localToken}`, 'Content-Type': 'application/json' },
        body: rawBody,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get(PAYMENT_RESPONSE_HEADER)).toBe(paymentResponse);
      await expect(response.json()).resolves.toEqual({ id: 'chatcmpl-test' });
    } finally {
      await sidecar.close();
    }
  });

  it('preserves a final x402 challenge instead of translating it into a provider error', async () => {
    const challenge = encodeHeader({ x402Version: 2, accepts: [] });
    const fetcher = vi.fn(async () => new Response('{"error":"payment_required"}', {
      status: 402,
      headers: { 'content-type': 'application/json', 'PAYMENT-REQUIRED': challenge },
    }));
    const { address, sidecar } = await startTestSidecar(fetcher);
    try {
      const response = await fetch(`${address}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'x-api-key': localToken, 'Content-Type': 'application/json' },
        body: '{"model":"test","messages":[]}',
      });
      expect(response.status).toBe(402);
      expect(response.headers.get('PAYMENT-REQUIRED')).toBe(challenge);
      await expect(response.json()).resolves.toEqual({ error: 'payment_required' });
    } finally {
      await sidecar.close();
    }
  });

  it('rejects responses, Anthropic messages, and unknown paths before any prove', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    const { address, sidecar } = await startTestSidecar(fetcher);
    try {
      for (const path of ['/v1/responses', '/v1/messages', '/v1/completions', '/v1/embeddings']) {
        const response = await fetch(`${address}${path}`, {
          method: 'POST',
          headers: { 'x-api-key': localToken, 'Content-Type': 'application/json' },
          body: '{"model":"test","input":"hello"}',
        });
        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({ error: 'unsupported_openai_path' });
      }
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await sidecar.close();
    }
  });

  it('rejects streaming and model-free bodies before proving', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    const { address, sidecar } = await startTestSidecar(fetcher);
    try {
      for (const body of [
        '{"model":"test","stream":true,"messages":[]}',
        '{"model":"test","stream_options":{"include_usage":true},"messages":[]}',
        '{"messages":[]}',
        '{}',
      ]) {
        const response = await fetch(`${address}/v1/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${localToken}`, 'Content-Type': 'application/json' },
          body,
        });
        expect(response.status).toBe(400);
      }
      const streaming = await fetch(`${address}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localToken}`, 'Content-Type': 'application/json' },
        body: '{"model":"test","stream":false,"messages":[]}',
      });
      expect(streaming.status).toBe(400);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await sidecar.close();
    }
  });

  it('requires the local token for the aggregate metrics snapshot', async () => {
    const metrics = createBaseProofMetrics({ now: () => 0 });
    metrics.recordAttempt({ outcome: 'success', durationMs: 1200 });
    metrics.recordAttempt({ outcome: 'failure', durationMs: 9000, category: 'timeout' });
    metrics.recordRetry();
    const fetcher = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
    const { address, sidecar } = await startTestSidecar(fetcher, () => metrics.snapshot());
    try {
      expect((await fetch(`${address}/metrics`)).status).toBe(401);
      const response = await fetch(`${address}/metrics`, { headers: { Authorization: `Bearer ${localToken}` } });
      expect(response.status).toBe(200);
      const body = await response.json() as Record<string, unknown>;
      expect(body).toEqual(metrics.snapshot());
      expect(Object.keys(body).sort()).toEqual([
        'attempts',
        'failures',
        'failuresByCategory',
        'hotProve',
        'retries',
        'successes',
        'updatedAt',
      ]);
      expect(body).toMatchObject({
        attempts: 2,
        successes: 1,
        failures: 1,
        retries: 1,
        hotProve: { samples: 1, p50Ms: 9000, p95Ms: 9000 },
      });
      expect(JSON.stringify(body)).not.toMatch(/nullifier|nonce|responseKey|commitment|secret|wallet|account/i);
      expect(JSON.stringify(body)).not.toMatch(/\d{20,}/u);
    } finally {
      await sidecar.close();
    }
  });
});
