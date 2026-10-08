import { type NextRequest, NextResponse } from 'next/server';
import { sandboxAccount, sandboxRelay } from '@/lib/sandbox-server';

export async function GET(req: NextRequest) {
  const accountId = await sandboxAccount(req);
  if (accountId instanceof NextResponse) return accountId;
  return sandboxRelay('/v1/sandbox/status', { accountId });
}
