/**
 * Sessionless funding relay.
 *
 * This route deliberately reads no session, no cookie, and no account data:
 * the detached funding capability in the request body is the only
 * authorization. It exists so the browser keeps a same-origin flow without
 * exposing the gateway origin or loosening its CORS posture.
 */

import { NextRequest, NextResponse } from 'next/server';
import { callGateway } from '@/lib/gateway';

export async function POST(req: NextRequest) {
  let fundingToken: string;
  let commitment: string;
  try {
    const body = await req.json() as Record<string, unknown>;
    fundingToken = typeof body?.fundingToken === 'string' ? body.fundingToken : '';
    commitment = typeof body?.commitment === 'string' ? body.commitment : '';
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  if (!fundingToken || !commitment) {
    return NextResponse.json({ error: 'invalid_funding_request' }, { status: 400 });
  }

  try {
    const { status, data } = await callGateway({
      method: 'POST',
      path: '/v1/pilot/funding',
      body: { fundingToken, commitment },
      authorize: false,
    });
    if (status !== 200) {
      return NextResponse.json({ error: typeof data.error === 'string' ? data.error : 'funding_failed' }, { status });
    }
    return NextResponse.json({
      network: data.network,
      chainId: data.chainId,
      contractAddress: data.contractAddress,
      deploymentDomain: data.deploymentDomain,
      tierId: data.tierId,
      expiry: data.expiry,
      transactionHash: data.transactionHash,
    });
  } catch {
    return NextResponse.json({ error: 'gateway_unreachable' }, { status: 502 });
  }
}
