/**
 * Adapter-enabled x402-native agent fixture.
 *
 * Drives the real gateway over real HTTP with the published `x402Client` and
 * `x402HTTPClient`, deliberately registering the project's `zk-prepaid`
 * scheme: 402 challenge -> scheme-based acceptance selection ->
 * PAYMENT-SIGNATURE -> reserve/commit settlement -> PAYMENT-RESPONSE.
 *
 * A generic unregistered x402 client must fail with an unsupported-scheme
 * error and must never fall back to another rail.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { generateKeyPair, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { x402Client } from '@x402/core/client';
import { x402HTTPClient } from '@x402/core/http';
import {
  buildPaymentPayload,
  CODING_DEEPSEEK_V4_FLASH_V1,
  decodeHeader,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  PUBLIC_SIGNAL_INDEX,
  registerZkPrepaidClient,
  type PaymentPayload,
  type PaymentRequirements,
  type SettlementResponse,
} from '@zk-credits/x402-zk-prepaid';
import { deriveRequestSignal } from '@zk-credits/shared';
import { createZkPrepaidGateway } from './zk-prepaid-gateway.js';
import { MockProviderAdapter } from './providerAdapter.js';

const runningServers: Server[] = [];

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  })));
});

async function listen(server: Server): Promise<string> {
  runningServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function gatewayOptions() {
  return {
    config: {
      contractAddress: '0x00000000000000000000000000000000000000a1',
      treasuryAddress: '0x00000000000000000000000000000000000000b2',
      deploymentDomain: '84532',
      circuitId: 'private-credit-spend-bn254-dev',
      verifyingKeyId: 'private-credit-spend-vk-dev',
    },
    provider: new MockProviderAdapter(),
    allowUnverifiedProofs: true,
    verifyProof: async () => ({ isValid: true }),
  };
}

/** The fixture agent knows its own request, so it can bind the request signal. */
function proofFactoryFor(url: string, body: string) {
  return async ({ requirements }: { requirements: PaymentRequirements }): Promise<PaymentPayload> => {
    const nonce = randomBytes(24).toString('base64url');
    const { publicKey } = await promisify(generateKeyPair)('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const responseKey = String(publicKey);
    const signal = (await deriveRequestSignal({
      method: 'POST',
      url,
      body: new TextEncoder().encode(body),
      requirements,
      nonce,
      responseKey,
    })).field;
    return buildPaymentPayload({
      requirements,
      proof: { pi_a: ['1', '2', '1'], pi_b: [['3', '4'], ['5', '6'], ['1', '0']], pi_c: ['7', '8', '1'] },
      publicSignals: [
        '11',
        String(requirements.extra.issuedAt),
        requirements.extra.deploymentDomain,
        signal,
        '44',
        '55',
      ],
      nonce,
      responseKey,
    });
  };
}

async function startGateway() {
  const gateway = await createZkPrepaidGateway(gatewayOptions());
  const baseUrl = await listen(createServer(gateway.app));
  return { gateway, baseUrl };
}

describe('x402-native agent fixture', () => {
  it('completes the real challenge, settlement, and response exchange', async () => {
    const { gateway, baseUrl } = await startGateway();
    const url = `${baseUrl}/v1/chat/completions`;
    const body = '{"model":"openai/gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}';
    const client = registerZkPrepaidClient(new x402Client().setSpendControls(false), proofFactoryFor(url, body));
    const http = new x402HTTPClient(client);

    const unpaid = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    expect(unpaid.status).toBe(402);
    const required = http.getPaymentRequiredResponse((name) => unpaid.headers.get(name));
    expect(required.accepts).toHaveLength(1);
    expect(required.accepts[0]).toMatchObject({
      scheme: 'zk-prepaid',
      network: 'eip155:84532',
      amount: '1',
      asset: CODING_DEEPSEEK_V4_FLASH_V1,
      extra: expect.objectContaining({ assetTransferMethod: 'prepaid-claim', paymentFlow: 'escrow' }),
    });

    const payload = await http.createPaymentPayload(required);
    expect(payload.x402Version).toBe(2);
    const paid = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...http.encodePaymentSignatureHeader(payload) },
      body,
    });
    expect(paid.status).toBe(200);
    await expect(paid.json()).resolves.toMatchObject({ object: 'chat.completion' });

    const settle = http.getPaymentSettleResponse((name) => paid.headers.get(name));
    expect(settle).toMatchObject({ success: true, transaction: '', network: 'eip155:84532' });
    expect(settle).not.toHaveProperty('payer');
    const rawSettle = decodeHeader<SettlementResponse>(paid.headers.get(PAYMENT_RESPONSE_HEADER)!);
    expect(rawSettle).toEqual(settle);

    const nullifier = payload.payload.publicSignals[PUBLIC_SIGNAL_INDEX.nullifier]!;
    const record = await gateway.claimStore.lookup(nullifier, undefined);
    expect(record?.state).toBe('committed');
  });

  it('selects zk-prepaid even when it is not the first acceptance', async () => {
    const { baseUrl } = await startGateway();
    const url = `${baseUrl}/v1/chat/completions`;
    const body = '{"model":"openai/gpt-4o-mini","messages":[]}';
    const unpaid = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    const required = new x402HTTPClient(new x402Client()).getPaymentRequiredResponse((name) => unpaid.headers.get(name));
    const [zkPrepaid] = required.accepts as PaymentRequirements[];
    const reordered = {
      ...required,
      accepts: [
        { ...structuredClone(zkPrepaid!), scheme: 'exact', asset: 'usdc', extra: { name: 'USD Coin', version: '2' } },
        structuredClone(zkPrepaid!),
      ],
    } as typeof required;

    const client = registerZkPrepaidClient(new x402Client().setSpendControls(false), proofFactoryFor(url, body));
    const payload = await client.createPaymentPayload(reordered);
    expect(payload.accepted.scheme).toBe('zk-prepaid');
    expect(payload.accepted).toEqual(zkPrepaid);
  });

  it('returns an unsupported-scheme result for a generic unregistered client with no fallback rail', async () => {
    const { baseUrl } = await startGateway();
    const url = `${baseUrl}/v1/chat/completions`;
    const body = '{"model":"openai/gpt-4o-mini","messages":[]}';
    const http = new x402HTTPClient(new x402Client());

    const unpaid = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    expect(unpaid.status).toBe(402);
    const required = http.getPaymentRequiredResponse((name) => unpaid.headers.get(name));
    await expect(http.createPaymentPayload(required)).rejects.toThrow(/No client registered for x402 version/);

    // No other rail, header, or paid retry can appear after the failure.
    const requests: string[] = [];
    const counted = new x402HTTPClient(new x402Client());
    const second = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    requests.push(`${second.status}`);
    const secondRequired = counted.getPaymentRequiredResponse((name) => second.headers.get(name));
    await expect(counted.createPaymentPayload(secondRequired)).rejects.toThrow();
    expect(requests).toEqual(['402']);
    expect(second.headers.get(PAYMENT_SIGNATURE_HEADER)).toBeNull();
  });

  it('advertises the sole supported capability and exposes no witness route', async () => {
    const { gateway, baseUrl } = await startGateway();
    const supported = await fetch(`${baseUrl}/x402/facilitator/supported`).then((response) => response.json()) as {
      kinds: unknown[];
      extensions: unknown[];
      signers: Record<string, unknown>;
    };
    expect(supported.kinds).toHaveLength(1);
    expect(supported.kinds[0]).toMatchObject({
      x402Version: 2,
      scheme: 'zk-prepaid',
      network: 'eip155:84532',
      extra: { assetTransferMethod: 'prepaid-claim', paymentFlow: 'escrow' },
    });
    expect(supported.extensions).toEqual([]);
    expect(supported.signers).toEqual({});
    expect(JSON.stringify(supported)).not.toMatch(/exact|authorization|bazaar|mcp|solana/i);

    const routes = routePaths(gateway.app);
    expect(routes.length).toBeGreaterThan(5);
    // No route serves a Merkle path or witness for a named leaf or commitment.
    for (const route of routes) {
      expect(route).not.toMatch(/witness|merkle|membership|leaf/i);
    }
    for (const path of ['/v1/membership/witness', '/v1/merkle/path', '/v1/tree/path', '/v1/leaves']) {
      const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: 'not_found' });
    }
  });
});

interface RouteLayer {
  route?: { path?: string; methods?: Record<string, boolean> };
}

function routePaths(app: unknown): string[] {
  const router = (app as { router?: { stack?: RouteLayer[] }; _router?: { stack?: RouteLayer[] } });
  const stack = router.router?.stack ?? router._router?.stack ?? [];
  return stack
    .filter((layer) => layer.route?.path)
    .map((layer) => `${Object.keys(layer.route?.methods ?? {}).join(',')} ${layer.route?.path}`);
}
