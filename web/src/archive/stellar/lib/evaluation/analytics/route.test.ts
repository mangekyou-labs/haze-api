import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
}));

vi.mock('@/lib/evaluation-api', () => ({
  EvaluationApiError: class EvaluationApiError extends Error {
    constructor(readonly code: string, readonly status: number) {
      super(code);
    }
  },
  getEvaluationIdentity: mocks.identity,
}));

import { NextRequest } from 'next/server';
import { POST } from './route';

describe('analytics opt-in route', () => {
  it('returns only the public participant code after explicit opt-in', async () => {
    mocks.identity.mockResolvedValueOnce({
      fullId: 'a'.repeat(64),
      publicCode: 'L4-aaaaaaaaaaaa',
    });
    const response = await POST(new NextRequest('http://localhost/api/evaluation/analytics', {
      method: 'POST',
      body: JSON.stringify({ optIn: true, participantId: 'client-controlled' }),
      headers: { 'Content-Type': 'application/json' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ participantCode: 'L4-aaaaaaaaaaaa' });
  });

  it('rejects requests that do not explicitly opt in', async () => {
    mocks.identity.mockClear();
    const response = await POST(new NextRequest('http://localhost/api/evaluation/analytics', {
      method: 'POST',
      body: JSON.stringify({ optIn: false }),
      headers: { 'Content-Type': 'application/json' },
    }));

    expect(response.status).toBe(400);
    expect(mocks.identity).not.toHaveBeenCalled();
  });
});
