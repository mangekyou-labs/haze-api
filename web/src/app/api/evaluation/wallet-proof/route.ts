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
  const allowed = ['challengeId', 'address', 'signature', 'network'];
  if (allowed.some((field) => typeof body[field] !== 'string' || !body[field])) {
    return Response.json({ error: 'missing_fields' }, { status: 400 });
  }
  return proxyEvaluationRequest('/v1/evaluation/wallet-proof', 'POST', {
    challengeId: body.challengeId,
    address: body.address,
    signature: body.signature,
    network: body.network,
  });
}
