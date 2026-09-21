import { NextRequest } from 'next/server';
import { proxyEvaluationRequest } from '@/lib/evaluation-api';
import { evaluationMethodNotAllowed, invalidEvaluationFields } from '../evaluation-route';

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!sessionId || sessionId.length > 256) return invalidEvaluationFields();
  return proxyEvaluationRequest(
    `/v1/evaluation/checkout?sessionId=${encodeURIComponent(sessionId)}`,
    'GET',
  );
}

export async function POST(_req: NextRequest) {
  return evaluationMethodNotAllowed(['GET']);
}
