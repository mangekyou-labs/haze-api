import { NextRequest } from 'next/server';
import {
  EVALUATION_CONSENT_VERSION,
  proxyEvaluationRequest,
} from '@/lib/evaluation-api';
import { invalidEvaluationFields, isRecord } from '../evaluation-route';

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return invalidEvaluationFields();
  }
  if (!isRecord(body) || body.consentVersion !== EVALUATION_CONSENT_VERSION) {
    return invalidEvaluationFields();
  }
  return proxyEvaluationRequest('/v1/evaluation/enroll', 'POST', {
    consentVersion: EVALUATION_CONSENT_VERSION,
  });
}
