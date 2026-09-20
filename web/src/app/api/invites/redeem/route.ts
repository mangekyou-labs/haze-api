/**
 * Authenticated invite redemption.
 *
 * The GitHub account id comes exclusively from the server-side session. A
 * caller-supplied identity is ignored, and the response carries only the
 * one-time detached funding token.
 */

import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { callGateway } from '@/lib/gateway';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let code: string;
  try {
    const body = await req.json() as Record<string, unknown>;
    code = typeof body?.code === 'string' ? body.code : '';
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json({ error: 'invalid_invite_code' }, { status: 400 });
  }

  try {
    const { status, data } = await callGateway({
      method: 'POST',
      path: '/v1/pilot/invites/redeem',
      body: { code, githubAccountId: session.user.id },
    });
    if (status !== 200) {
      return NextResponse.json({ error: typeof data.error === 'string' ? data.error : 'invite_redemption_failed' }, { status });
    }
    return NextResponse.json({ fundingToken: data.fundingToken, expiresAt: data.expiresAt });
  } catch {
    return NextResponse.json({ error: 'gateway_unreachable' }, { status: 502 });
  }
}
