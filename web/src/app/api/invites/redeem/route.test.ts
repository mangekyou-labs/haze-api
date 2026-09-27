import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { auth, callGateway } = vi.hoisted(() => ({
  auth: vi.fn(),
  callGateway: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth }));
vi.mock('@/lib/gateway', () => ({ callGateway }));

import { POST } from './route';

function request(): NextRequest {
  return new NextRequest('http://localhost/api/invites/redeem', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'single-use-invite', githubAccountId: 'attacker-selected-id' }),
  });
}

describe('POST /api/invites/redeem', () => {
  beforeEach(() => {
    auth.mockReset();
    callGateway.mockReset();
  });

  it('redeems for the authenticated GitHub account, not the application session id', async () => {
    auth.mockResolvedValue({
      user: {
        id: 'b73848f4-32e1-49c4-b8d4-fb840b1a81b9',
        githubAccountId: '107874128',
      },
    });
    callGateway.mockResolvedValue({ status: 200, data: { fundingToken: 'funding-token', expiresAt: 1_900_000_000_000 } });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(callGateway).toHaveBeenCalledWith({
      method: 'POST',
      path: '/v1/pilot/invites/redeem',
      body: { code: 'single-use-invite', githubAccountId: '107874128' },
    });
  });

  it('rejects an authenticated session without a GitHub provider account id', async () => {
    auth.mockResolvedValue({
      user: { id: 'b73848f4-32e1-49c4-b8d4-fb840b1a81b9' },
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'github_account_unavailable' });
    expect(callGateway).not.toHaveBeenCalled();
  });
});
