import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import Stripe from 'stripe';

const gateway = vi.hoisted(() => vi.fn(async () => ({ status: 200, data: { ok: true } })));
vi.mock('@/lib/gateway', () => ({ callGateway: gateway }));
import { POST } from './route';

const stripe = new Stripe('sk_test_fixture');
const secret = 'whsec_local_fixture';
function request(overrides: Record<string, unknown> = {}, signed = true) {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  const raw = JSON.stringify({ id: 'evt_fixture', type: 'checkout.session.completed', livemode: false,
    data: { object: { id: 'cs_test_fixture', metadata: { topupId: 'fixture' }, livemode: false, mode: 'payment', payment_status: 'paid', currency: 'usd', amount_total: 2000 } }, ...overrides });
  return new NextRequest('http://localhost/api/sandbox/webhook', { method: 'POST', body: raw,
    headers: { 'stripe-signature': signed ? stripe.webhooks.generateTestHeaderString({ payload: raw, secret }) : 'invalid' } });
}
afterEach(() => { vi.clearAllMocks(); delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_WEBHOOK_SECRET; });
describe('signed sandbox webhooks', () => {
  it('verifies the raw body before forwarding authoritative session values', async () => {
    expect((await POST(request())).status).toBe(200);
    expect(gateway).toHaveBeenCalledWith(expect.objectContaining({ body: {
      topupId: 'fixture', sessionId: 'cs_test_fixture', livemode: false, mode: 'payment', paymentStatus: 'paid', currency: 'usd', amountTotal: 2000,
    } }));
  });
  it('rejects invalid signatures and live events before relay', async () => {
    expect((await POST(request({}, false))).status).toBe(400);
    expect((await POST(request({ livemode: true }))).status).toBe(400);
    expect(gateway).not.toHaveBeenCalled();
  });
  it('ignores unrelated and unpaid sessions', async () => {
    expect((await POST(request({ type: 'payment_intent.created' }))).status).toBe(200);
    expect((await POST(request({ data: { object: { payment_status: 'unpaid' } } }))).status).toBe(200);
    expect(gateway).not.toHaveBeenCalled();
  });
});
