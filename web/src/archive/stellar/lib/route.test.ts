import { describe, expect, beforeEach, afterEach, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  identity: vi.fn(),
  gateway: vi.fn(),
  create: vi.fn(),
  Stripe: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/evaluation-api', () => ({
  EVALUATION_CONSENT_VERSION: 'level4-2026-09-11',
  EvaluationApiError: class EvaluationApiError extends Error {
    constructor(readonly code: string, readonly status: number) {
      super(code);
    }
  },
  evaluationGatewayRequest: mocks.gateway,
  getEvaluationIdentity: mocks.identity,
  isEvaluationCommitment: (value: unknown) => typeof value === 'string' && /^\d+$/.test(value),
}));
vi.mock('stripe', () => ({ default: mocks.Stripe }));

import { NextRequest } from 'next/server';
import { POST } from './route';

describe('evaluation checkout route', () => {
  const originalSecret = process.env.STRIPE_SECRET_KEY;

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_checkout';
    mocks.auth.mockResolvedValue({ user: { id: 'github-subject' } });
    mocks.identity.mockResolvedValue({
      fullId: 'd'.repeat(64),
      publicCode: 'L4-dddddddddddd',
    });
    mocks.gateway.mockResolvedValue(
      new Response(JSON.stringify({ consentVersion: 'level4-2026-09-11' }), { status: 200 }),
    );
    mocks.create.mockResolvedValue({ url: 'https://checkout.test/session' });
    mocks.Stripe.mockImplementation(function () {
      return { checkout: { sessions: { create: mocks.create } } };
    });
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalSecret;
    vi.clearAllMocks();
  });

  it('requires enrollment and commitment before creating evaluation checkout', async () => {
    const response = await POST(new NextRequest('http://localhost/api/checkout', {
      method: 'POST',
      body: JSON.stringify({ tier: 'evaluation', commitment: '123456789' }),
      headers: { 'Content-Type': 'application/json' },
    }));

    expect(response.status).toBe(200);
    expect(mocks.gateway).toHaveBeenCalledWith('/v1/evaluation/status', 'GET');
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      line_items: [expect.objectContaining({
        price_data: expect.objectContaining({ unit_amount: 100 }),
      })],
      metadata: {
        tier: 'evaluation',
        participantId: 'd'.repeat(64),
        participantCode: 'L4-dddddddddddd',
        commitment: '123456789',
        usdcAmount: '10000000',
        amountCents: '100',
      },
    }));
    expect(mocks.create.mock.calls[0][0].metadata).not.toHaveProperty('userId');
  });

  it('leaves the launch starter contract on its existing one-dollar metadata path', async () => {
    const response = await POST(new NextRequest('http://localhost/api/checkout', {
      method: 'POST',
      body: JSON.stringify({ tier: 'starter', commitment: '987654321' }),
      headers: { 'Content-Type': 'application/json' },
    }));

    expect(response.status).toBe(200);
    expect(mocks.gateway).not.toHaveBeenCalled();
    expect(mocks.create.mock.calls[0][0].metadata).toEqual({
      userId: 'github-subject',
      tier: 'starter',
      usdcAmount: '1000000',
      commitment: '987654321',
    });
  });

  it('rejects an evaluation checkout without a decimal commitment', async () => {
    const response = await POST(new NextRequest('http://localhost/api/checkout', {
      method: 'POST',
      body: JSON.stringify({ tier: 'evaluation', commitment: 'not-a-field' }),
      headers: { 'Content-Type': 'application/json' },
    }));

    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('does not expose provider exception details to clients or logs', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.create.mockRejectedValue(new Error('provider failure participant_secret=do-not-log'));

    const response = await POST(new NextRequest('http://localhost/api/checkout', {
      method: 'POST',
      body: JSON.stringify({ tier: 'starter' }),
      headers: { 'Content-Type': 'application/json' },
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'stripe_error' });
    expect(consoleError).toHaveBeenCalledWith('Stripe checkout request failed');
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('participant_secret'));
  });
});
