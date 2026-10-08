import { type NextRequest, NextResponse } from 'next/server';
import { sandboxAccount, sandboxRelay } from '@/lib/sandbox-server';

export async function POST(req: NextRequest) {
  const accountId = await sandboxAccount(req);
  if (accountId instanceof NextResponse) return accountId;
  let commitment: string;
  try { commitment = String((await req.json()).commitment ?? ''); }
  catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }); }
  return sandboxRelay('/v1/sandbox/funding', { accountId, commitment });
}
