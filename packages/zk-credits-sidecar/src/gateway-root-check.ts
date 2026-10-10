function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export const DEFAULT_GATEWAY_URL = 'https://zk-credits-gateway.onrender.com';

/** Shared gateway origin validation for setup and the internal trial. */
export function resolveGatewayOrigin(environment: NodeJS.ProcessEnv): URL {
  const origin = new URL(environment.ZK_CREDITS_GATEWAY_URL || DEFAULT_GATEWAY_URL);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
    throw new Error('The internal trial requires a plain HTTPS gateway origin');
  }
  return origin;
}

/** Public setup check. It sends the public root only and never needs an admin credential. */
export async function requireGatewayKnownRoot(
  root: string,
  origin: URL,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  let response: Response;
  try {
    response = await fetcher(new URL('/v1/root-known', origin), {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ root }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error('The gateway could not confirm that the activated credential root is known');
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  if (response.status !== 200 || !isRecord(body) || body.known !== true) {
    throw new Error('The activated credential root is not in the gateway known-root set; stop setup and reconcile the V2 activation');
  }
}
