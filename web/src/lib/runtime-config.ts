export interface RuntimeConfigEnv {
  GATEWAY_SECRET?: string;
  STRIPE_SECRET_KEY?: string;
}

export function isGatewayConfigured(env: RuntimeConfigEnv): boolean {
  return Boolean(env.GATEWAY_SECRET);
}

export function isStripeConfigured(env: RuntimeConfigEnv): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}
