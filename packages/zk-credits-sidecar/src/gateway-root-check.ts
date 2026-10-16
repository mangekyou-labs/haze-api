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
  const deadline = AbortSignal.timeout(60_000);
  for (let attempt = 0; attempt < 3 && !deadline.aborted; attempt += 1) {
    let response: Response | undefined;
    let body: unknown;
    try {
      response = await fetcher(new URL('/v1/root-known', origin), {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ root }),
        signal: AbortSignal.any([deadline, AbortSignal.timeout(30_000)]),
      });
      if (response.status === 200) body = await response.json();
    } catch { /* Reachability/body failures remain uncertain, never unknown. */ }
    if (response?.status === 200 && isRecord(body) && body.known === true) return;
    if (response?.status === 200 && isRecord(body) && body.known === false) {
      throw new Error('The activated credential root is not in the gateway known-root set; stop setup and reconcile the V2 activation');
    }
    if (response && ![429, 500, 502, 503, 504].includes(response.status)) break;
    if (attempt === 2) break;
    const retry = response?.headers.get('Retry-After');
    const providerDelay = retry ? (/^\d+$/u.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 0;
    const delay = Math.max(500 * 2 ** attempt, Number.isFinite(providerDelay) ? providerDelay : 0);
    await response?.body?.cancel().catch(() => {});
    try { await waitForGateway(delay, deadline); } catch { break; }
  }
  throw new Error('The gateway is temporarily unavailable and could not confirm the activated credential root. Retry zk-credits setup codex; changing the local RPC does not change the gateway connection.');
}

function waitForGateway(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
