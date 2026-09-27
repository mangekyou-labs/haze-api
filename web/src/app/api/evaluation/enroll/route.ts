import { NextRequest } from 'next/server';
import { EVALUATION_CONSENT_VERSION, proxyEvaluationRequest } from '@/lib/evaluation-api';

export async function POST(request: NextRequest) {
  let body: { consentVersion?: unknown };
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return Response.json({ error: 'invalid_body' }, { status: 400 });
    }
    body = parsed as { consentVersion?: unknown };
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 });
  }
  if (body.consentVersion !== EVALUATION_CONSENT_VERSION) {
    return Response.json({ error: 'invalid_consent_version' }, { status: 400 });
  }
  return proxyEvaluationRequest('/v1/evaluation/enroll', 'POST', {
    consentVersion: body.consentVersion,
  });
}
