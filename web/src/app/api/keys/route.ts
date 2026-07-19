import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001';
const GATEWAY_SECRET = process.env.GATEWAY_SECRET || '';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!GATEWAY_SECRET) {
    console.error('GATEWAY_SECRET not configured');
    return NextResponse.json({ error: 'server_misconfigured' }, { status: 500 });
  }

  let commitment: string;
  try {
    const body = await req.json();
    commitment = body.commitment;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (!commitment || typeof commitment !== 'string') {
    return NextResponse.json({ error: 'missing_commitment' }, { status: 400 });
  }

  try {
    const res = await fetch(`${GATEWAY_URL}/v1/api-keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GATEWAY_SECRET}`,
      },
      body: JSON.stringify({
        commitment,
        label: session.user?.email ?? 'github-user',
      }),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json({ error: 'gateway_error' }, { status: 502 });
  }
}
