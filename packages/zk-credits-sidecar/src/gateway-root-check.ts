function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
