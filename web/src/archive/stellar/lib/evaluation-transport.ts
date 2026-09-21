export type EvaluationGatewayMethod = 'GET' | 'POST';

export interface EvaluationGatewayRequestInit {
  method: EvaluationGatewayMethod;
  gatewaySecret: string;
  participantId: string;
  body?: unknown;
}

export function buildEvaluationGatewayRequest(
  input: EvaluationGatewayRequestInit,
): { headers: Record<string, string>; body?: string } {
  const headers: Record<string, string> = {
    ...(input.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    'Authorization': `Bearer ${input.gatewaySecret}`,
    'x-evaluation-participant-id': input.participantId,
    'Cache-Control': 'no-store',
  };

  return {
    headers,
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  };
}
