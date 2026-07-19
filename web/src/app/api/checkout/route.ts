import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

const PRICE_MAP: Record<string, { usdc: number; label: string }> = {
  starter: { usdc: 5_0000000, label: '$5 Credits' },
  pro: { usdc: 20_0000000, label: '$20 Credits' },
  enterprise: { usdc: 50_0000000, label: '$50 Credits' },
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'stripe_not_configured' }, { status: 500 });
  }

  const stripe = getStripe()!;

  let tier: string;
  let commitment: string | undefined;
  try {
    const body = await req.json();
    tier = body.tier;
    commitment = body.commitment;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const priceInfo = PRICE_MAP[tier];
  if (!priceInfo) {
    return NextResponse.json(
      { error: 'invalid_tier', valid: Object.keys(PRICE_MAP) },
      { status: 400 },
    );
  }

  const origin = req.nextUrl.origin || process.env.NEXTAUTH_URL || 'http://localhost:3000';

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: priceInfo.label,
              description: `ZK-API Credits — ${priceInfo.label}`,
            },
            unit_amount: parseInt(tier === 'starter' ? '500' : tier === 'pro' ? '2000' : '5000'),
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/dashboard?checkout=success`,
      cancel_url: `${origin}/dashboard?checkout=cancelled`,
      metadata: {
        userId: session.user.id,
        tier,
        usdcAmount: priceInfo.usdc.toString(),
        ...(commitment ? { commitment } : {}),
      },
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'stripe_error';
    console.error('Stripe checkout error:', message);
    return NextResponse.json({ error: 'stripe_error', message }, { status: 500 });
  }
}
