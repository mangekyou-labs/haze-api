import { type NextRequest, NextResponse } from 'next/server';
import { stripeSandbox } from '@/lib/stripe-sandbox';
import { callGateway } from '@/lib/gateway';
import type Stripe from 'stripe';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'webhook_not_configured' }, { status: 503 });
  let event: Stripe.Event;
  try { event = stripeSandbox().webhooks.constructEvent(await req.text(), req.headers.get('stripe-signature') ?? '', secret); }
  catch { return NextResponse.json({ error: 'invalid_webhook_signature' }, { status: 400 }); }
  if (event.livemode) return NextResponse.json({ error: 'live_payments_disabled' }, { status: 400 });
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') return NextResponse.json({ received: true });
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status !== 'paid') return NextResponse.json({ received: true });
  try {
    const { status, data } = await callGateway({ method: 'POST', path: '/v1/sandbox/stripe-event', body: {
      topupId: session.metadata?.topupId, sessionId: session.id, livemode: session.livemode,
      mode: session.mode, paymentStatus: session.payment_status, currency: session.currency, amountTotal: session.amount_total,
    } });
    return NextResponse.json(data, { status });
  } catch { return NextResponse.json({ error: 'gateway_unavailable' }, { status: 503 }); }
}
