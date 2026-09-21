import { getEvaluationIdentity, EvaluationApiError, evaluationGatewayRequest } from '@/lib/evaluation-api';
import { isOwnedEvaluationReceipt } from '@/lib/evaluation-receipt';
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new Stripe(key) : null;
}

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session_id');
  if (!sessionId || sessionId.length > 256) {
    return NextResponse.json({ error: 'missing_checkout_session' }, { status: 400 });
  }

  try {
    const identity = await getEvaluationIdentity();
    if (!identity) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const stripe = getStripe();
    if (!stripe) return NextResponse.json({ error: 'stripe_not_configured' }, { status: 500 });

    const checkout = await stripe.checkout.sessions.retrieve(sessionId);
    const metadata = checkout.metadata ?? {};
    if (metadata.tier !== 'evaluation'
      || !isOwnedEvaluationReceipt(metadata.participantId, identity.fullId)) {
      return NextResponse.json({ error: 'receipt_not_found' }, { status: 404 });
    }

    const response = await evaluationGatewayRequest(
      `/v1/evaluation/checkout?sessionId=${encodeURIComponent(sessionId)}`,
      'GET',
    );
    const text = await response.text();
    let payload: unknown = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { error: 'invalid_gateway_response' };
    }
    return NextResponse.json(payload, {
      status: response.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof EvaluationApiError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: 'receipt_unavailable' }, { status: 502 });
  }
}
