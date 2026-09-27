import { createHmac } from 'node:crypto';
import { auth } from '@/auth';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001';
const GATEWAY_SECRET = process.env.GATEWAY_SECRET || '';
export const EVALUATION_CONSENT_VERSION = 'level4-2026-09-11';
export const EVALUATION_REQUEST_TIMEOUT_MS = 90_000;

export class EvaluationApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, status = 500) {
    super(code);
    this.name = 'EvaluationApiError';
    this.code = code;
    this.status = status;
  }
}

export interface AuthenticatedEvaluationIdentity {
  fullId: string;
  publicCode: string;
}

/** Derive the opaque participant ID on the server; never expose the HMAC key. */
export async function getEvaluationIdentity(): Promise<AuthenticatedEvaluationIdentity> {
  const session = await auth();
  const subject = session?.user?.id;
  const secret = process.env.EVALUATION_HMAC_SECRET;
  if (!subject) throw new EvaluationApiError('unauthorized', 401);
  if (!secret) throw new EvaluationApiError('evaluation_not_configured', 503);
  const fullId = createHmac('sha256', secret).update(subject, 'utf8').digest('hex');
  return { fullId, publicCode: `L4-${fullId.slice(0, 12)}` };
}

function responsePayload(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({ error: 'gateway_invalid_response' }));
}

export async function evaluationGatewayRequest(
  path: string,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>,
): Promise<{ response: Response; identity: AuthenticatedEvaluationIdentity }> {
  if (!GATEWAY_SECRET) throw new EvaluationApiError('gateway_not_configured', 503);
  const identity = await getEvaluationIdentity();
  let response: Response;
  try {
    response = await fetch(`${GATEWAY_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${GATEWAY_SECRET}`,
        'x-evaluation-participant-id': identity.fullId,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(EVALUATION_REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    const code = error instanceof DOMException && error.name === 'TimeoutError'
      ? 'gateway_timeout'
      : 'gateway_unavailable';
    throw new EvaluationApiError(code, 503);
  }
  return { response, identity };
}

export async function proxyEvaluationRequest(
  path: string,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>,
): Promise<Response> {
  try {
    const { response } = await evaluationGatewayRequest(path, method, body);
    const payload = await responsePayload(response);
    return Response.json(payload, { status: response.status });
  } catch (error) {
    const typed = error instanceof EvaluationApiError ? error : new EvaluationApiError('evaluation_unavailable', 503);
    return Response.json({ error: typed.code }, { status: typed.status });
  }
}
