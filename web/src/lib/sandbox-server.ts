import { auth } from '@/auth';
import { callGateway } from '@/lib/gateway';
import { NextResponse, type NextRequest } from 'next/server';

/** Identity comes only from the signed-in session, never the request body. */
export async function sandboxAccount(req: NextRequest): Promise<string | NextResponse> {
  const origin = req.headers.get('origin');
  if ((origin && origin !== req.nextUrl.origin) || req.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ error: 'invalid_origin' }, { status: 403 });
  }
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'sign_in_required' }, { status: 401 });
  return session.user.githubAccountId ? `github:${session.user.githubAccountId}` : `session:${session.user.id}`;
}

export async function sandboxRelay(path: string, body: unknown) {
  try {
    const { status, data } = await callGateway({ method: 'POST', path, body });
    return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'gateway_unavailable' }, { status: 503 }); }
}
