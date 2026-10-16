import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireGatewayKnownRoot } from './gateway-root-check.js';
afterEach(() => vi.useRealTimers());

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
    vi.useFakeTimers();
    const unknown = vi.fn<typeof fetch>(async () => new Response('{"known":false}', { status: 200 }));
    await expect(requireGatewayKnownRoot('123', new URL('https://gateway.example'), unknown))
      .rejects.toThrow('not in the gateway known-root set');

    const unavailable = vi.fn<typeof fetch>(async () => new Response('{"error":"root_index_unavailable"}', { status: 503 }));
    const assertion = expect(requireGatewayKnownRoot('123', new URL('https://gateway.example'), unavailable))
      .rejects.toThrow('temporarily unavailable');
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    expect(unknown).toHaveBeenCalledOnce();
    expect(unavailable).toHaveBeenCalledTimes(3);
  });

  it.each(['network', 'index'])('recovers a transient %s failure without changing the checked root', async reason => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>();
    if (reason === 'network') fetcher.mockRejectedValueOnce(new Error('https://private.example/key'));
    else fetcher.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    fetcher.mockResolvedValueOnce(Response.json({ known: true }));
    const pending = requireGatewayKnownRoot('123', new URL('https://gateway.example'), fetcher);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(([, init]) => init?.body === '{"root":"123"}')).toBe(true);
  });

  it('honors the gateway throttle cooldown before another read-only root check', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(Response.json({ known: true }));
    const pending = requireGatewayKnownRoot('123', new URL('https://gateway.example'), fetcher);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
