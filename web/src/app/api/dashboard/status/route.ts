import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const commitment = req.nextUrl.searchParams.get('commitment');
  if (!commitment) {
    return NextResponse.json({ error: 'missing_commitment' }, { status: 400 });
  }

  try {
    const res = await fetch(`${GATEWAY_URL}/v1/status/${encodeURIComponent(commitment)}`);
    if (!res.ok) {
      return NextResponse.json({ error: 'gateway_error' }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: 'gateway_unreachable' }, { status: 502 });
  }
}
