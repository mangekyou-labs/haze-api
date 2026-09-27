import { NextRequest, NextResponse } from 'next/server';
import { getEvaluationIdentity } from '@/lib/evaluation-api';

export async function POST(request: NextRequest) {
  let body: { optIn?: unknown };
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    body = parsed as { optIn?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  if (body.optIn !== true) return NextResponse.json({ ok: true });
  try {
    const identity = await getEvaluationIdentity();
    // This endpoint is only reached after the user explicitly opts in. The
    // opaque HMAC is used solely as the PostHog distinct ID in the browser.
    return NextResponse.json({ analyticsId: identity.fullId });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'analytics_unavailable';
    return NextResponse.json({ error: code }, { status: code === 'unauthorized' ? 401 : 503 });
  }
}
