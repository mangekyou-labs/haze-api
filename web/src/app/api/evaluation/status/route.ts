import { proxyEvaluationRequest } from '@/lib/evaluation-api';

export async function GET() {
  return proxyEvaluationRequest('/v1/evaluation/status', 'GET');
}
