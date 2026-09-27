import { auth } from '@/auth';
import { EVALUATION_CONSENT_VERSION, evaluationGatewayRequest, getEvaluationIdentity } from '@/lib/evaluation-api';
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

const PRICE_MAP: Record<string, { usdc: number; label: string }> = {
  evaluation: { usdc: 1_0000000, label: '$1 Test Credits (Stripe test mode)' },
  starter: { usdc: 5_0000000, label: '$5 Credits' },
  pro: { usdc: 20_0000000, label: '$20 Credits' },
  enterprise: { usdc: 50_0000000, label: '$50 Credits' },
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
    return NextResponse.json({ error: 'stripe_not_configured' }, { status: 500 });
  }

  const stripe = getStripe()!;

  let tier: string;
  let commitment: string | undefined;
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    tier = typeof body.tier === 'string' ? body.tier : '';
    commitment = typeof body.commitment === 'string' ? body.commitment : undefined;
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

  let participantMetadata: { participantId: string; participantCode: string } | undefined;
  if (tier === 'evaluation') {
    if (typeof commitment !== 'string' || !/^\d+$/.test(commitment)) {
      return NextResponse.json({ error: 'commitment_required' }, { status: 400 });
    }
    try {
      const identity = await getEvaluationIdentity();
      const statusResponse = await evaluationGatewayRequest('/v1/evaluation/status', 'GET');
      if (!statusResponse.response.ok) {
        return NextResponse.json({ error: 'enrollment_required' }, { status: 409 });
      }
      const status = await statusResponse.response.json() as { consentVersion?: string };
      if (status.consentVersion !== EVALUATION_CONSENT_VERSION) {
        return NextResponse.json({ error: 'enrollment_required' }, { status: 409 });
      }
      participantMetadata = {
        participantId: identity.fullId,
        participantCode: identity.publicCode,
      };
    } catch (error) {
      const code = error instanceof Error ? error.message : 'evaluation_unavailable';
      return NextResponse.json({ error: code }, { status: 503 });
    }
  }

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
          unit_amount: tier === 'evaluation'
            ? 100
            : parseInt(tier === 'starter' ? '500' : tier === 'pro' ? '2000' : '5000'),
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/dashboard?checkout=cancelled`,
      metadata: {
        tier,
        usdcAmount: priceInfo.usdc.toString(),
        ...(commitment ? { commitment } : {}),
        ...(participantMetadata ?? {}),
      },
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (err: unknown) {
    console.error('Stripe checkout creation failed');
    return NextResponse.json({ error: 'stripe_error' }, { status: 500 });
  }
}
