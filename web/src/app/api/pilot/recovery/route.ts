/**
 * Public recovery lookup by the commitment derived from the local capsule.
 * The browser sends no capsule, secret, password, or funding capability.
 */

import { NextRequest, NextResponse } from 'next/server';
import { findFundedBundleOnBase, type BaseRecoveryErrorCode } from '@/lib/base-recovery';
import { callGateway } from '@/lib/gateway';

const BN254_FIELD_ORDER = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export async function GET(req: NextRequest) {
  const commitment = req.nextUrl.searchParams.get('commitment');
  if (!commitment || !/^\d+$/u.test(commitment)) {
    return NextResponse.json({ error: 'invalid_commitment' }, { status: 400 });
  }
  try {
    const field = BigInt(commitment);
    if (field <= 0n || field >= BN254_FIELD_ORDER) {
      return NextResponse.json({ error: 'invalid_commitment' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'invalid_commitment' }, { status: 400 });
  }

  try {
    const { status, data } = await callGateway({
      method: 'GET',
      path: `/v1/pilot/bundles/${encodeURIComponent(commitment)}`,
    });
    if (status === 404 && data.error === 'bundle_not_found') {
      try {
        const activation = await findFundedBundleOnBase(commitment);
        if (!activation) {
          return NextResponse.json(
            { error: 'bundle_not_found' },
            { status: 404, headers: { 'Cache-Control': 'no-store' } },
          );
        }
        return NextResponse.json(activation, { headers: { 'Cache-Control': 'no-store' } });
      } catch (error) {
        const candidateCode = error && typeof error === 'object' && 'code' in error
          ? (error as { code?: unknown }).code
          : undefined;
        const knownCodes: BaseRecoveryErrorCode[] = [
          'chain_unavailable', 'metadata_invalid', 'bundle_expired', 'bundle_unusable', 'bundle_unconfirmed',
        ];
        const code = knownCodes.find((knownCode) => knownCode === candidateCode) ?? 'chain_unavailable';
        if (code === 'bundle_expired') {
          return NextResponse.json({ error: 'bundle_expired' }, { status: 410, headers: { 'Cache-Control': 'no-store' } });
        }
        if (code === 'bundle_unusable') {
          return NextResponse.json({ error: 'bundle_unusable' }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
        }
        if (code === 'bundle_unconfirmed') {
          return NextResponse.json({ error: 'bundle_unconfirmed' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
        }
        if (code === 'metadata_invalid') {
          return NextResponse.json({ error: 'recovery_metadata_invalid' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
        }
        return NextResponse.json({ error: 'recovery_chain_unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
      }
    }
    if (status !== 200) {
      return NextResponse.json(
        { error: typeof data.error === 'string' ? data.error : 'recovery_lookup_failed' },
        { status, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json({
      commitment: data.commitment,
      tierId: data.tierId,
      expiry: data.expiry,
      deploymentDomain: data.deploymentDomain,
      network: data.network,
      contractAddress: data.contractAddress,
      transactionHash: data.transactionHash,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'gateway_unreachable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
