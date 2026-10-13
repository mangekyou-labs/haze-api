import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ account: vi.fn(async () => 'account'), gateway: vi.fn(), create: vi.fn(), retrieve: vi.fn() }));
vi.mock('@/lib/sandbox-server', () => ({ sandboxAccount: mocks.account }));
vi.mock('@/lib/gateway', () => ({ callGateway: mocks.gateway }));
vi.mock('@/lib/stripe-sandbox', () => ({ stripeSandbox: () => ({ checkout: { sessions: { create: mocks.create, retrieve: mocks.retrieve } } }) }));
import { POST } from './route';
const id = 'a51c4cce-2c75-4dbf-953c-4d0b59fa52a2';
const request = (amountCents?: unknown) => new NextRequest('http://localhost/api/sandbox/checkout', { method: 'POST', body: JSON.stringify({ requestId: id, amountCents }) });
afterEach(() => { vi.resetAllMocks(); mocks.account.mockResolvedValue('account'); delete process.env.AUTH_URL; });
describe('sandbox Checkout retries', () => {
  it.each([500, 10000])('opens a test Checkout for %s cents with the persisted price', async amountCents => {
    process.env.AUTH_URL = 'http://localhost';
    mocks.gateway.mockResolvedValueOnce({ status: 200, data: { id, amountCents } }).mockResolvedValueOnce({ status: 200, data: {} });
    mocks.create.mockResolvedValue({ id: 'cs_test_package', livemode: false, url: 'https://checkout.stripe.com/package' });
    const response = await POST(request(amountCents));
    expect(await response.json()).toEqual({ url: 'https://checkout.stripe.com/package' });
    expect(mocks.create.mock.calls[0][0].line_items[0].price_data).toMatchObject({ currency: 'usd', unit_amount: amountCents });
  });
  it.each([0, 1999, '500', null, 500.5, 200000])('rejects unapproved amount %s before payment', async amount => {
    expect((await POST(request(amount))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rejects a persisted amount that differs from the selected package', async () => {
    process.env.AUTH_URL = 'http://localhost';
    mocks.gateway.mockResolvedValue({ status: 200, data: { id, amountCents: 2000 } });
    expect((await POST(request(500))).status).toBe(503);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('binds a card-only test session before returning its URL', async () => {
    process.env.AUTH_URL = 'http://localhost';
    mocks.gateway.mockResolvedValueOnce({ status: 200, data: { id, amountCents: 2000 } }).mockResolvedValueOnce({ status: 200, data: {} });
    mocks.create.mockResolvedValue({ id: 'cs_test_demo', livemode: false, url: 'https://checkout.stripe.com/demo' });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ mode: 'payment', allowed_payment_method_types: ['card'], metadata: { topupId: id } }), { idempotencyKey: id });
    expect(mocks.gateway).toHaveBeenLastCalledWith(expect.objectContaining({ body: { accountId: 'account', topupId: id, sessionId: 'cs_test_demo' } }));
  });
  it.each(['open', 'complete', 'expired'])('reuses a bound %s session without creating a second Checkout', async status => {
    process.env.AUTH_URL = 'http://localhost';
    mocks.gateway.mockResolvedValue({ status: 200, data: { id, amountCents: 2000, sessionId: 'cs_test_demo' } });
    mocks.retrieve.mockResolvedValue({ status, livemode: false, url: 'https://checkout.stripe.com/demo' });
    const response = await POST(request());
    expect(response.status).toBe(status === 'expired' ? 409 : 200);
    expect(await response.json()).toEqual(status === 'expired' ? { error: 'checkout_expired' } : status === 'complete' ? { completed: true } : { url: 'https://checkout.stripe.com/demo' });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('withholds a session whose binding failed and rejects live sessions', async () => {
    process.env.AUTH_URL = 'http://localhost';
    mocks.gateway.mockResolvedValueOnce({ status: 200, data: { id, amountCents: 2000 } }).mockResolvedValueOnce({ status: 409, data: { error: 'topup_session_conflict' } });
    mocks.create.mockResolvedValue({ id: 'cs_test_demo', livemode: false, url: 'https://checkout.stripe.com/demo' });
    expect((await POST(request())).status).toBe(409);
    mocks.gateway.mockResolvedValue({ status: 200, data: { id, amountCents: 2000, sessionId: 'cs_test_demo' } });
    mocks.retrieve.mockResolvedValue({ livemode: true, status: 'open', url: 'https://checkout.stripe.com/demo' });
    expect((await POST(request())).status).toBe(503);
  });
});
