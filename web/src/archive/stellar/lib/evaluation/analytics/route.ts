import { getEvaluationIdentity, EvaluationApiError } from '@/lib/evaluation-api';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_fields' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || (body as Record<string, unknown>).optIn !== true) {
    return NextResponse.json({ error: 'analytics_opt_in_required' }, { status: 400 });
  }

  try {
    const identity = await getEvaluationIdentity();
    if (!identity) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    return NextResponse.json(
      { participantCode: identity.publicCode },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof EvaluationApiError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: 'analytics_unavailable' }, { status: 503 });
  }
}
