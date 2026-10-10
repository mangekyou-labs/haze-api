import { type NextRequest, NextResponse } from 'next/server';
import { sandboxAccount } from '@/lib/sandbox-server';
import { stripeSandbox } from '@/lib/stripe-sandbox';
import { callGateway } from '@/lib/gateway';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const accountId = await sandboxAccount(req);
  if (accountId instanceof NextResponse) return accountId;
  let requestId: string;
  try { requestId = String((await req.json()).requestId ?? ''); }
  catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }); }
  try {
    const stripe = stripeSandbox();
    const origin = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? (process.env.NODE_ENV !== 'production' ? req.nextUrl.origin : null);
    if (!origin) throw new Error('sandbox_return_url_not_configured');
    const { status, data } = await callGateway({ method: 'POST', path: '/v1/sandbox/topups', body: { accountId, requestId } });
    if (status !== 200) return NextResponse.json(data, { status });
    if (data.paid === true) return NextResponse.json({ completed: true });
    if (typeof data.id !== 'string' || data.amountCents !== 2000) throw new Error('invalid_topup');
    if (typeof data.sessionId === 'string') {
      const previous = await stripe.checkout.sessions.retrieve(data.sessionId);
      if (previous.livemode) throw new Error('invalid_test_session');
      if (previous.status === 'expired') return NextResponse.json({ error: 'checkout_expired' }, { status: 409 });
      if (previous.status === 'complete') return NextResponse.json({ completed: true });
      if (!previous.url) throw new Error('invalid_test_session');
      return NextResponse.json({ url: previous.url }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const dashboard = new URL('/dashboard', origin).toString();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', allowed_payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'usd', unit_amount: 2000, product_data: { name: '$20 simulated Haze balance (sandbox)' } }, quantity: 1 }],
      metadata: { topupId: data.id },
      success_url: `${dashboard}?checkout=success`, cancel_url: `${dashboard}?checkout=cancelled`,
    }, { idempotencyKey: data.id });
    if (session.livemode || !session.url) throw new Error('invalid_test_session');
    const bound = await callGateway({ method: 'POST', path: '/v1/sandbox/topups/session', body: { accountId, topupId: data.id, sessionId: session.id } });
    if (bound.status !== 200) return NextResponse.json(bound.data, { status: bound.status });
    return NextResponse.json({ url: session.url }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = error instanceof Error && ['stripe_sandbox_not_configured', 'sandbox_return_url_not_configured'].includes(error.message) ? error.message : 'checkout_unavailable';
    return NextResponse.json({ error: code }, { status: 503 });
  }
}
