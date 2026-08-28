import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSidecarServer, type ProofGenerator } from './sidecar.js';
import { TicketLedger } from './ticket-ledger.js';

const temporaryDirectories: string[] = [];
const localToken = 'zk-local-test-token';

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

async function startTestSidecar() {
  const directory = await mkdtemp(join(tmpdir(), 'zk-credits-sidecar-'));
  temporaryDirectories.push(directory);
  const proofGenerator: ProofGenerator = vi.fn(async () => ({
    proof: { pi_a: ['0', '0', '1'] },
    pubSignals: ['1', '2', '3', '4'],
  }));
  const gatewayFetch = vi.fn(async () => new Response(JSON.stringify({
    id: 'response-test',
    object: 'response',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const sidecar = createSidecarServer({
    localToken,
    gatewayBaseUrl: 'https://gateway.example',
    compatibilityKey: 'shared-compatibility-key',
    ledger: new TicketLedger(join(directory, 'tickets.json')),
    proofGenerator,
    gatewayFetch,
  });
  const address = await sidecar.listen(0);
  return { address, directory, sidecar, proofGenerator, gatewayFetch };
}

describe('loopback sidecar', () => {
  it('reports loopback health without spending a ticket or requiring the bearer', async () => {
    const { address, sidecar, proofGenerator, gatewayFetch } = await startTestSidecar();
    try {
      const response = await fetch(`${address}/health`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        service: 'zk-credits-sidecar',
        status: 'ok',
      });
      expect(proofGenerator).not.toHaveBeenCalled();
      expect(gatewayFetch).not.toHaveBeenCalled();
    } finally {
      await sidecar.close();
    }
  });

  it('serves the Codex model probe locally without spending a ticket', async () => {
    const { address, sidecar, proofGenerator, gatewayFetch } = await startTestSidecar();
    try {
      const response = await fetch(`${address}/v1/models?client_version=0.147.0`, {
        headers: { Authorization: `Bearer ${localToken}` },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        models: [expect.objectContaining({
          slug: 'openai/gpt-4o-mini',
          display_name: 'GPT-4o Mini (ZK Credits)',
          visibility: 'list',
          supported_in_api: true,
          base_instructions: expect.any(String),
        })],
      });
      expect(proofGenerator).not.toHaveBeenCalled();
      expect(gatewayFetch).not.toHaveBeenCalled();
    } finally {
      await sidecar.close();
    }
  });

  it('rejects a request without the random local bearer before reserving a ticket', async () => {
    const { address, sidecar, proofGenerator, gatewayFetch } = await startTestSidecar();
    try {
      const response = await fetch(`${address}/v1/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'test', input: 'hello' }),
      });

      expect(response.status).toBe(401);
      expect(proofGenerator).not.toHaveBeenCalled();
      expect(gatewayFetch).not.toHaveBeenCalled();
    } finally {
      await sidecar.close();
    }
  });

  it('proves and forwards a Responses request with a gateway-only proof header', async () => {
    const { address, sidecar, proofGenerator, gatewayFetch } = await startTestSidecar();
    const rawBody = '{"model":"test","input":"hello"}';
    try {
      const response = await fetch(`${address}/v1/responses`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localToken}`,
          'Content-Type': 'application/json',
        },
        body: rawBody,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ object: 'response' });
      expect(proofGenerator).toHaveBeenCalledWith(
        expect.objectContaining({ ticketIndex: 0, request: { model: 'test', input: 'hello' } }),
      );
      expect(gatewayFetch).toHaveBeenCalledWith('https://gateway.example/v1/responses', expect.objectContaining({
        method: 'POST',
        body: rawBody,
        headers: expect.objectContaining({
          Authorization: 'Bearer shared-compatibility-key',
          'Content-Type': 'application/json',
          'X-ZK-Proof': expect.any(String),
        }),
      }));
    } finally {
      await sidecar.close();
    }
  });

  it('keeps a ticket reserved while the gateway response is still pending', async () => {
    const { address, directory, sidecar, gatewayFetch } = await startTestSidecar();
    gatewayFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      accepted: true,
      status: 'pending',
    }), { status: 202, headers: { 'Content-Type': 'application/json' } }));
    try {
      const response = await fetch(`${address}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'hello' }] }),
      });

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toMatchObject({ status: 'pending' });
      const ledger = JSON.parse(await readFile(join(directory, 'tickets.json'), 'utf8')) as {
        entries: Array<{ index: number; state: string }>;
      };
      expect(ledger.entries).toEqual([{ index: 0, requestDigest: expect.any(String), state: 'reserved' }]);
    } finally {
      await sidecar.close();
    }
  });

  it('translates /v1/messages to chat completions, attaches proof, returns Anthropic format, and consumes ticket', async () => {
    const { address, directory, sidecar, proofGenerator, gatewayFetch } = await startTestSidecar();
    gatewayFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      id: 'chatcmpl-test-claude',
      object: 'chat.completion',
      model: 'openai/gpt-4o-mini',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Hello from Claude Code adapter!' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 15, completion_tokens: 8 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    try {
      const response = await fetch(`${address}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': localToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          messages: [{ role: 'user', content: 'Hello Claude' }],
          max_tokens: 100,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json() as {
        type: string;
        role: string;
        content: Array<{ type: string; text: string }>;
        stop_reason: string;
      };
      expect(data.type).toBe('message');
      expect(data.role).toBe('assistant');
      expect(data.content).toEqual([{ type: 'text', text: 'Hello from Claude Code adapter!' }]);
      expect(data.stop_reason).toBe('end_turn');

      expect(proofGenerator).toHaveBeenCalledWith(expect.objectContaining({
        ticketIndex: 0,
        request: expect.objectContaining({
          model: 'openai/gpt-4o-mini',
          messages: [{ role: 'user', content: 'Hello Claude' }],
        }),
      }));
      expect(gatewayFetch).toHaveBeenCalledWith('https://gateway.example/v1/chat/completions', expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer shared-compatibility-key',
          'X-ZK-Proof': expect.any(String),
        }),
      }));

      const ledger = JSON.parse(await readFile(join(directory, 'tickets.json'), 'utf8')) as {
        entries: Array<{ index: number; state: string }>;
      };
      expect(ledger.entries).toEqual([{ index: 0, requestDigest: expect.any(String), state: 'consumed' }]);
    } finally {
      await sidecar.close();
    }
  });

  it('rejects /v1/messages with missing or invalid token with 401', async () => {
    const { address, sidecar } = await startTestSidecar();
    try {
      const response = await fetch(`${address}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': 'wrong-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });
      expect(response.status).toBe(401);
    } finally {
      await sidecar.close();
    }
  });

  it('relays gateway non-2xx errors as Anthropic error JSON without emitting SSE stream events', async () => {
    const { address, directory, sidecar, gatewayFetch } = await startTestSidecar();
    gatewayFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: 'Provider rate limit exceeded' } }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    try {
      const response = await fetch(`${address}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': localToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          messages: [{ role: 'user', content: 'Hello stream failure' }],
          stream: true,
        }),
      });

      expect(response.status).toBe(429);
      expect(response.headers.get('content-type')).toContain('application/json');
      const data = await response.json() as {
        type: string;
        error: { type: string; message: string };
      };
      expect(data.type).toBe('error');
      expect(data.error.type).toBe('rate_limit_error');
      expect(data.error.message).toContain('Provider rate limit exceeded');

      const ledger = JSON.parse(
        await readFile(join(directory, 'tickets.json'), 'utf8'),
      ) as {
        entries: Array<{ index: number; state: string }>;
      };
      // Ticket must NOT be marked consumed
      expect(ledger.entries).toEqual([
        { index: 0, requestDigest: expect.any(String), state: 'reserved' },
      ]);
    } finally {
      await sidecar.close();
    }
  });

  it('translates plain-text non-JSON gateway errors into structured Anthropic error JSON', async () => {
    const { address, sidecar, gatewayFetch } = await startTestSidecar();
    gatewayFetch.mockResolvedValueOnce(
      new Response('Bad Gateway (Render cold start timeout)', {
        status: 502,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );

    try {
      const response = await fetch(`${address}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': localToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          messages: [{ role: 'user', content: 'Hello plain text error' }],
        }),
      });

      expect(response.status).toBe(502);
      expect(response.headers.get('content-type')).toContain('application/json');
      const data = (await response.json()) as {
        type: string;
        error: { type: string; message: string };
      };
      expect(data.type).toBe('error');
      expect(data.error.type).toBe('api_error');
      expect(data.error.message).toContain('Bad Gateway (Render cold start timeout)');
    } finally {
      await sidecar.close();
    }
  });
});
