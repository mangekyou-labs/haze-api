import { NextRequest } from 'next/server';
import { proxyEvaluationRequest } from '@/lib/evaluation-api';

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return Response.json({ error: 'invalid_body' }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 });
  }
  // Keep the browser-to-gateway contract closed over the six fixed feedback
  // fields; unexpected fields must never cross the evaluation boundary.
  return proxyEvaluationRequest('/v1/evaluation/feedback', 'POST', {
    easeRating: body.easeRating,
    taskCompleted: body.taskCompleted,
    wouldUseAgain: body.wouldUseAgain,
    mostValuableAspect: body.mostValuableAspect,
    biggestFriction: body.biggestFriction,
    quoteConsent: body.quoteConsent,
  });
}
