import { describe, expect, it, vi } from 'vitest';
import { requireGatewayKnownRoot } from './gateway-root-check.js';

describe('public gateway root check', () => {
  it('uses the public endpoint without asking for or sending an admin token', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{"known":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(requireGatewayKnownRoot('123', new URL('https://gateway.example'), fetcher)).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://gateway.example/v1/root-known');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ accept: 'application/json', 'content-type': 'application/json' });
    expect(init?.body).toBe('{"root":"123"}');
    expect(JSON.stringify(init?.headers)).not.toContain('authorization');
  });

  it('fails closed for an unknown root and an unavailable gateway', async () => {
    const unknown = vi.fn<typeof fetch>(async () => new Response('{"known":false}', { status: 200 }));
    await expect(requireGatewayKnownRoot('123', new URL('https://gateway.example'), unknown))
      .rejects.toThrow('not in the gateway known-root set');

    const unavailable = vi.fn<typeof fetch>(async () => new Response('{"error":"root_index_unavailable"}', { status: 503 }));
    await expect(requireGatewayKnownRoot('123', new URL('https://gateway.example'), unavailable))
      .rejects.toThrow('not in the gateway known-root set');
  });
});
