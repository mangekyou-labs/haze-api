/**
 * Server-only gateway client for the web control plane.
 *
 * The browser never talks to the gateway directly: every call carries the
 * internal service token from this process, and none of them add a session,
 * account identifier, or credential material beyond what the endpoint needs.
 */

import { gatewayInternalHeaders } from '@/lib/runtime-config';

export const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://localhost:3001';

interface GatewayCall {
  path: string;
  method: 'GET' | 'POST';
  body?: unknown;
  /** Control-plane calls authenticate; the sessionless funding call does not. */
  authorize?: boolean;
}

export interface GatewayResponse {
  status: number;
  data: Record<string, unknown>;
}

export async function callGateway(call: GatewayCall): Promise<GatewayResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (call.authorize !== false) {
    Object.assign(headers, gatewayInternalHeaders({
      GATEWAY_URL: process.env.GATEWAY_URL,
      BILLING_INTERNAL_TOKEN: process.env.BILLING_INTERNAL_TOKEN,
    }));
  }
  const response = await fetch(`${GATEWAY_URL}${call.path}`, {
    method: call.method,
    headers,
    body: call.body === undefined ? undefined : JSON.stringify(call.body),
    cache: 'no-store',
  });
  let data: Record<string, unknown> = {};
  try {
    const parsed = await response.json() as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
  } catch {
    data = {};
  }
  return { status: response.status, data };
}
