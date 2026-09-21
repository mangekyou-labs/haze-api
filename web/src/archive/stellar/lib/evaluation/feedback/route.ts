import { NextRequest } from 'next/server';
import { proxyEvaluationRequest } from '@/lib/evaluation-api';
import { invalidEvaluationFields, isRecord, pickFields } from '../evaluation-route';

const FEEDBACK_FIELDS = [
  'easeRating',
  'taskCompleted',
  'wouldUseAgain',
  'mostValuableAspect',
  'biggestFriction',
  'quoteConsent',
] as const;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return invalidEvaluationFields();
  }
  if (!isRecord(body)
    || typeof body.easeRating !== 'number'
    || !Number.isInteger(body.easeRating)
    || typeof body.taskCompleted !== 'boolean'
    || typeof body.wouldUseAgain !== 'boolean'
    || typeof body.mostValuableAspect !== 'string'
    || typeof body.biggestFriction !== 'string'
    || typeof body.quoteConsent !== 'boolean'
    || body.mostValuableAspect.length > 1_000
    || body.biggestFriction.length > 1_000) {
    return invalidEvaluationFields();
  }
  return proxyEvaluationRequest(
    '/v1/evaluation/feedback',
    'POST',
    pickFields(body, FEEDBACK_FIELDS),
  );
}
