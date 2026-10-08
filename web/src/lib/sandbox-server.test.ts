import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const auth = vi.hoisted(() => vi.fn());
vi.mock('@/auth', () => ({ auth }));
vi.mock('@/lib/gateway', () => ({ callGateway: vi.fn() }));
import { sandboxAccount } from './sandbox-server';

describe('sandbox session boundary', () => {
  it('rejects cross-origin operations and missing sessions', async () => {
    const result = await sandboxAccount(new NextRequest('https://haze.test/api/sandbox', { headers: { origin: 'https://evil.test' } }));
    expect(typeof result === 'string' ? 0 : result.status).toBe(403);
    auth.mockResolvedValue(null);
    const anonymous = await sandboxAccount(new NextRequest('https://haze.test/api/sandbox'));
    expect(typeof anonymous === 'string' ? 0 : anonymous.status).toBe(401);
  });
  it('derives identity from auth even when the body supplies another account', async () => {
    auth.mockResolvedValue({ user: { id: 'session', githubAccountId: '123' } });
    expect(await sandboxAccount(new NextRequest('https://haze.test/api/sandbox', { method: 'POST', headers: { origin: 'https://haze.test' }, body: JSON.stringify({ accountId: 'victim' }) }))).toBe('github:123');
  });
});
