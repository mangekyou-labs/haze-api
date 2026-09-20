export interface RuntimeConfigEnv {
  GATEWAY_URL?: string;
  BILLING_INTERNAL_TOKEN?: string;
}

export function isGatewayConfigured(env: RuntimeConfigEnv): boolean {
  return Boolean(env.GATEWAY_URL);
}

/** Internal service headers for server-only gateway calls. */
export function gatewayInternalHeaders(env: RuntimeConfigEnv): Record<string, string> {
  return env.BILLING_INTERNAL_TOKEN ? { Authorization: `Bearer ${env.BILLING_INTERNAL_TOKEN}` } : {};
}
