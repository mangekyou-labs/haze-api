import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResilientRpcFetch } from './rpc-resilience.js';

const read = (method = 'eth_call') => ({ method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }) });
afterEach(() => vi.useRealTimers());

describe('RPC recovery transport', () => {
  it('cancels oversized log responses without retrying the same query', async () => {
    const cancel = vi.fn();
    const fetch = vi.fn(async () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel,
    })));
    const request = createResilientRpcFetch({ requestsPerMinute: 300, fetch });
    await expect(request('https://rpc.invalid', read('eth_getLogs'))).rejects.toThrow('rpc_response_too_large');
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(['cancel', 'deadline'])('aborts a stalled response body after headers on %s without another request', async reason => {
    vi.useFakeTimers();
    const cancelled = vi.fn();
    let signal: AbortSignal | undefined;
    const fetch = vi.fn(async (_input, init) => {
      signal = init!.signal as AbortSignal;
      return new Response(new ReadableStream({ cancel: cancelled }));
    });
    const request = createResilientRpcFetch({ requestsPerMinute: 300, timeoutMs: 1000, fetch });
    const controller = new AbortController();
    const pending = request('https://rpc.invalid', { ...read(), signal: controller.signal });
    const assertion = expect(pending).rejects.toThrow(reason === 'cancel' ? 'cancelled' : 'rpc_timeout');
    await vi.advanceTimersByTimeAsync(0);
    if (reason === 'cancel') controller.abort(new Error('cancelled'));
    else await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(signal?.aborted).toBe(true);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('waits for provider cooldown and completes the same read after throttling', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockImplementation(async () => new Response('{"result":"0x1"}'));
    const request = createResilientRpcFetch({ requestsPerMinute: 300, fetch });
    const result = request('https://rpc.invalid', read());
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1001);
    expect((await result).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['eth_sendRawTransaction', 'eth_sendTransaction', 'personal_sign', 'unknown_method'])('never retries %s after a write timeout', async method => {
    const fetch = vi.fn().mockRejectedValue(new Error('network timeout'));
    const request = createResilientRpcFetch({ requestsPerMinute: 300, fetch });
    await expect(request('https://rpc.invalid', read(method))).rejects.toThrow('network timeout');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([402, 403, 400])('does not retry permanent HTTP %s failures', async status => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status }));
    const request = createResilientRpcFetch({ requestsPerMinute: 300, fetch });
    expect((await request('https://rpc.invalid', read())).status).toBe(status);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('paces expensive calls below the weighted one-second limit', async () => {
    vi.useFakeTimers();
    const times: number[] = [];
    const fetch = vi.fn(async () => { times.push(Date.now()); return new Response('{}'); });
    const request = createResilientRpcFetch({ requestsPerMinute: 300, fetch });
    const pending = Promise.all([request('https://rpc.invalid', read('eth_estimateGas')), request('https://rpc.invalid', read('eth_estimateGas'))]);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(times[1]! - times[0]!).toBe(1000);
  });

  it('prioritizes foreground funding reads ahead of queued background sync', async () => {
    vi.useFakeTimers();
    const bodies: string[] = [];
    const fetch = vi.fn(async (_, init) => { bodies.push(JSON.parse(init!.body as string).method); return new Response('{}'); });
    const request = createResilientRpcFetch({ requestsPerMinute: 300, fetch });
    const pending = Promise.all([request.background('https://rpc.invalid', read('eth_getLogs')),
      request.background('https://rpc.invalid', read('eth_getLogs')), request('https://rpc.invalid', read('eth_getBalance'))]);
    await vi.runAllTimersAsync();
    await pending;
    expect(bodies).toEqual(['eth_getLogs', 'eth_getBalance', 'eth_getLogs']);
  });

  it('bounds retries of unavailable reads and never retries a mixed write batch', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => new Response('{}', { status: 503 }));
    const request = createResilientRpcFetch({ requestsPerMinute: 300, fetch });
    const pending = request('https://rpc.invalid', read());
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(3);
    fetch.mockClear();
    const batch = request('https://rpc.invalid', { method: 'POST', body: JSON.stringify([{ method: 'eth_call' }, { method: 'eth_sendRawTransaction' }]) });
    await vi.runAllTimersAsync();
    expect((await batch).status).toBe(503);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('cancels queued requests without sending them to the provider', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => new Response('{}'));
    const request = createResilientRpcFetch({ requestsPerMinute: 300, fetch });
    await request('https://rpc.invalid', read());
    const controller = new AbortController();
    const pending = request('https://rpc.invalid', { ...read(), signal: controller.signal });
    const assertion = expect(pending).rejects.toThrow('cancelled');
    controller.abort(new Error('cancelled'));
    await assertion;
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledOnce();
  });
});
