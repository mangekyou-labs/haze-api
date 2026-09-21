import { proxyEvaluationRequest } from '@/lib/evaluation-api';

export async function POST() {
  return proxyEvaluationRequest('/v1/evaluation/challenge', 'POST');
}
