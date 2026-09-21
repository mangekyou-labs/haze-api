import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import {
  deriveParticipantIdentity,
  type EvaluationParticipantIdentity,
} from './evaluation-identity';
import {
  buildEvaluationGatewayRequest,
  type EvaluationGatewayMethod,
} from './evaluation-transport';

export { EVALUATION_CONSENT_VERSION } from './evaluation-contract';
export { deriveParticipantIdentity, isEvaluationCommitment } from './evaluation-identity';
export type { EvaluationParticipantIdentity } from './evaluation-identity';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001';
const GATEWAY_SECRET = process.env.GATEWAY_SECRET || '';
const EVALUATION_HMAC_SECRET = process.env.EVALUATION_HMAC_SECRET || '';
const REQUEST_TIMEOUT_MS = 90_000;

export class EvaluationApiError extends Error {
  constructor(
    readonly code: 'unauthorized' | 'server_misconfigured' | 'gateway_unreachable',
    readonly status: number,
    message: string = code,
  ) {
    super(message);
    this.name = 'EvaluationApiError';
  }
}

export async function getEvaluationIdentity(): Promise<EvaluationParticipantIdentity | null> {
  const session = await auth();
  const subject = session?.user?.id;
  if (!subject) return null;
  if (!EVALUATION_HMAC_SECRET) {
    throw new EvaluationApiError('server_misconfigured', 500, 'EVALUATION_HMAC_SECRET not configured');
  }
  return deriveParticipantIdentity(subject, EVALUATION_HMAC_SECRET);
}

export async function evaluationGatewayRequest(
  path: string,
  method: EvaluationGatewayMethod,
  body?: unknown,
): Promise<Response> {
  const identity = await getEvaluationIdentity();
  if (!identity) throw new EvaluationApiError('unauthorized', 401);
  if (!GATEWAY_SECRET) {
    throw new EvaluationApiError('server_misconfigured', 500, 'GATEWAY_SECRET not configured');
  }

  const request = buildEvaluationGatewayRequest({
    method,
    gatewaySecret: GATEWAY_SECRET,
    participantId: identity.fullId,
    body,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(`${GATEWAY_URL}${path}`, {
      method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch {
    throw new EvaluationApiError('gateway_unreachable', 502);
  } finally {
    clearTimeout(timeout);
  }
}

export async function proxyEvaluationRequest(
  path: string,
  method: EvaluationGatewayMethod,
  body?: unknown,
): Promise<NextResponse> {
  try {
    const response = await evaluationGatewayRequest(path, method, body);
    const text = await response.text();
    let payload: unknown = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: 'invalid_gateway_response' };
      }
    }
    return NextResponse.json(payload, {
      status: response.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof EvaluationApiError) {
      return NextResponse.json({ error: error.code }, {
        status: error.status,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    return NextResponse.json({ error: 'gateway_unreachable' }, {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

export function evaluationProxyError(error: unknown): NextResponse {
  if (error instanceof EvaluationApiError) {
    return NextResponse.json({ error: error.code }, { status: error.status });
  }
  return NextResponse.json({ error: 'gateway_unreachable' }, { status: 502 });
}
