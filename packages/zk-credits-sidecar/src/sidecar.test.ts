import { mkdtemp, rm } from 'node:fs/promises';
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
  return { address, sidecar, proofGenerator, gatewayFetch };
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
});
