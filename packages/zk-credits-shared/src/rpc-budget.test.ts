import { describe, expect, it, vi } from 'vitest';
import { createRpcBudgetFetch } from './rpc-budget.js';

describe('RPC request budget', () => {
  it('shares a budget across clients, rejects before fetching, and refills over time', async () => {
    let now = 0;
    const fetch = vi.fn(async () => new Response('{}'));
    const request = createRpcBudgetFetch({ requestsPerMinute: 2, now: () => now, fetch });
    await request('https://rpc.invalid'); await request('https://rpc.invalid');
    expect((await request('https://rpc.invalid')).status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(2);
    now = 30_000;
    expect((await request('https://rpc.invalid')).status).toBe(200);
  });

  it('bounds concurrent requests and releases a slot after failure', async () => {
    let reject!: (error: Error) => void;
    const fetch = vi.fn(() => new Promise<Response>((_, fail) => { reject = fail; }));
    const request = createRpcBudgetFetch({ requestsPerMinute: 60, maxConcurrent: 1, fetch });
    const pending = request('https://rpc.invalid');
    expect((await request('https://rpc.invalid')).status).toBe(429);
    reject(new Error('network'));
    await expect(pending).rejects.toThrow('network');
    fetch.mockResolvedValueOnce(new Response('{}'));
    expect((await request('https://rpc.invalid')).status).toBe(200);
  });

  it('honors provider Retry-After without sending more traffic during cooldown', async () => {
    let now = 0;
    const fetch = vi.fn(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '20' } }));
    const request = createRpcBudgetFetch({ requestsPerMinute: 60, now: () => now, fetch });
    await request('https://rpc.invalid');
    now = 19_000;
    expect((await request('https://rpc.invalid')).headers.get('Retry-After')).toBe('1');
    expect(fetch).toHaveBeenCalledOnce();
    now = 20_000;
    await request('https://rpc.invalid');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
