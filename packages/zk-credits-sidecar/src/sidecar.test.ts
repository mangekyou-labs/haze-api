import { describe, expect, it, vi } from 'vitest';
import { createZkPrepaidLifecycleMetrics, encodeHeader, PAYMENT_RESPONSE_HEADER } from '@zk-credits/x402-zk-prepaid';
import { createBaseProofMetrics } from './proof-metrics.js';
import { createSidecarServer, type SidecarMetricsSnapshot } from './sidecar.js';

const localToken = 'zk-local-test-token';

async function startTestSidecar(
  fetcher: (input: string, init?: RequestInit) => Promise<Response>,
  metrics?: () => SidecarMetricsSnapshot,
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

  it('bridges a supported Codex Responses request through chat settlement and returns Responses events', async () => {
    const paymentResponse = encodeHeader({ success: true, transaction: '', network: 'eip155:84532' });
    const codexRequest = {
      model: 'openai/gpt-4o-mini',
      instructions: 'synthetic developer instruction',
      input: [
        { type: 'message', id: 'private-message-id', role: 'user', content: [{ type: 'input_text', text: 'synthetic prompt' }] },
      ],
      stream: true,
      store: false,
      prompt_cache_key: 'private-cache-key',
      client_metadata: { session_id: 'private-session-id' },
      include: ['reasoning.encrypted_content'],
      reasoning: { effort: 'none', summary: 'none' },
      parallel_tool_calls: true,
      tool_choice: 'auto',
      tools: [
        { type: 'function', name: 'read_file', description: 'Read a file', parameters: { type: 'object' }, strict: true },
        {
          type: 'custom', name: 'apply_patch', description: 'Synthetic local Codex patch tool',
          format: { type: 'grammar', syntax: 'lark', definition: 'patch: "synthetic"' },
        },
        { type: 'namespace', name: 'mcp', description: 'not forwarded', tools: [{ type: 'function', name: 'tool' }] },
        { type: 'web_search', external_web_access: true },
      ],
    };
    let translated: Record<string, unknown> | undefined;
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      expect(input).toBe('https://gateway.example/v1/chat/completions');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
      translated = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: 'chatcmpl-synthetic',
        created: 1_790_000_000,
        model: 'deepseek/deepseek-v4-flash',
        choices: [{ index: 0, message: { role: 'assistant', content: 'synthetic answer', refusal: null }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 31, completion_tokens: 4, total_tokens: 35 },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json', [PAYMENT_RESPONSE_HEADER]: paymentResponse },
      });
    });
    const { address, sidecar } = await startTestSidecar(fetcher);
    try {
      const response = await fetch(`${address}/v1/responses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(codexRequest),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/^text\/event-stream/u);
      expect(response.headers.get(PAYMENT_RESPONSE_HEADER)).toBe(paymentResponse);
      const frames = (await response.text()).split('\n\n').filter(Boolean).map((frame) => {
        const [eventLine, dataLine] = frame.split('\n');
        return { event: eventLine?.slice('event: '.length), data: JSON.parse(dataLine!.slice('data: '.length)) as Record<string, unknown> };
      });
      expect(frames.map((frame) => frame.event)).toEqual([
        'response.created', 'response.in_progress', 'response.output_item.added',
        'response.content_part.added', 'response.output_text.delta', 'response.output_text.done',
        'response.content_part.done', 'response.output_item.done', 'response.completed',
      ]);
      expect(frames[0]?.data.response).toMatchObject({ status: 'in_progress', usage: null, completed_at: null });
      expect(frames[4]?.data.delta).toBe('synthetic answer');
      expect(frames.at(-1)?.data).toMatchObject({
        type: 'response.completed',
        response: {
          status: 'completed',
          usage: { input_tokens: 31, output_tokens: 4, total_tokens: 35 },
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'synthetic answer' }] }],
        },
      });
      expect(translated).toMatchObject({
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'developer', content: 'synthetic developer instruction' },
          { role: 'user', content: 'synthetic prompt' },
        ],
        tools: [{ type: 'function', function: { name: 'read_file', description: 'Read a file', strict: true } }],
      });
      expect(translated).not.toHaveProperty('parallel_tool_calls');
      expect(translated).not.toHaveProperty('stream');
      expect(JSON.stringify(translated)).not.toMatch(/private-message-id|private-cache-key|private-session-id|web_search|namespace|apply_patch/u);
    } finally {
      await sidecar.close();
    }
  });

  it('allows only one valid Responses request in internal trial mode', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      id: 'chatcmpl-internal-trial',
      choices: [{ index: 0, message: { role: 'assistant', content: 'synthetic answer' }, finish_reason: 'stop' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const sidecar = createSidecarServer({
      localToken,
      gatewayBaseUrl: 'https://gateway.example',
      prepaidClient: { fetch: fetcher },
      internalTrialOneProof: true,
    });
    const address = await sidecar.listen(0);
    const request = () => fetch(`${address}/v1/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai/gpt-4o-mini', input: 'synthetic prompt', stream: true, store: false }),
    });
    try {
      const unauthorized = await fetch(`${address}/v1/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'openai/gpt-4o-mini', input: 'synthetic prompt', stream: true, store: false }),
      });
      expect(unauthorized.status).toBe(401);
      const invalid = await fetch(`${address}/v1/responses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          input: [{ type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'data:synthetic' }] }],
          stream: true,
          store: false,
        }),
      });
      expect(invalid.status).toBe(400);

      const first = await request();
      expect(first.status).toBe(200);
      await first.text();

      const second = await request();
      expect(second.status).toBe(409);
      await expect(second.json()).resolves.toEqual({ error: 'internal_trial_limit_reached' });
      expect(fetcher).toHaveBeenCalledOnce();
    } finally {
      await sidecar.close();
    }
  });

  it('rejects unsupported Responses shapes before any prove', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    const { address, sidecar } = await startTestSidecar(fetcher);
    try {
      const valid = {
        model: 'openai/gpt-4o-mini', stream: true,
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
      };
      for (const body of [
        { ...valid, input: [{ type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'data:...' }] }] },
        { ...valid, reasoning: { effort: 'high' } },
        { ...valid, unknown_control: true },
        { ...valid, store: true },
        { ...valid, stream: false },
        { ...valid, tools: [{ type: 'custom', name: 'unknown', format: { type: 'grammar', syntax: 'lark', definition: 'synthetic' } }] },
        { ...valid, tools: [{ type: 'custom', name: 'apply_patch', format: { type: 'grammar', syntax: 'regex', definition: 'synthetic' } }] },
      ]) {
        const response = await fetch(`${address}/v1/responses`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${localToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        expect(response.status).toBe(400);
      }
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await sidecar.close();
    }
  });

  it('rejects Anthropic messages and unknown paths before any prove', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    const { address, sidecar } = await startTestSidecar(fetcher);
    try {
      for (const path of ['/v1/messages', '/v1/completions', '/v1/embeddings']) {
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
    const proofMetrics = createBaseProofMetrics({ now: () => 0 });
    proofMetrics.recordAttempt({ outcome: 'success', durationMs: 1200 });
    proofMetrics.recordAttempt({ outcome: 'failure', durationMs: 9000, category: 'timeout' });
    proofMetrics.recordRetry();
    const exchangeMetrics = createZkPrepaidLifecycleMetrics({ now: () => 0 });
    exchangeMetrics.observe({ type: 'stage', stage: 'challenge_received' });
    exchangeMetrics.observe({ type: 'stage', stage: 'payment_prepared' });
    exchangeMetrics.observe({ type: 'stage', stage: 'settlement_confirmed' });
    exchangeMetrics.observe({ type: 'stage', stage: 'exchange_succeeded' });
    exchangeMetrics.observe({ type: 'failure', failure: 'challenge_stale' });
    const fetcher = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
    const { address, sidecar } = await startTestSidecar(fetcher, () => ({
      ...proofMetrics.snapshot(),
      exchange: exchangeMetrics.snapshot(),
    }));
    try {
      expect((await fetch(`${address}/metrics`)).status).toBe(401);
      const response = await fetch(`${address}/metrics`, { headers: { Authorization: `Bearer ${localToken}` } });
      expect(response.status).toBe(200);
      const body = await response.json() as Record<string, unknown>;
      expect(body).toEqual({ ...proofMetrics.snapshot(), exchange: exchangeMetrics.snapshot() });
      expect(Object.keys(body).sort()).toEqual([
        'attempts',
        'exchange',
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
        exchange: {
          challengesReceived: 1,
          paymentsPrepared: 1,
          settlementsConfirmed: 1,
          exchangeSuccesses: 1,
          failures: 1,
          failuresByCategory: { challenge_stale: 1 },
        },
      });
      expect(JSON.stringify(body)).not.toMatch(/nullifier|nonce|responseKey|commitment|secret|wallet|account/i);
      expect(JSON.stringify(body)).not.toMatch(/\d{20,}/u);
    } finally {
      await sidecar.close();
    }
  });
});
