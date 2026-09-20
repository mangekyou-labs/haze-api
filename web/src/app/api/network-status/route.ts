/**
 * Sanitized Base Sepolia network status.
 *
 * Only public chain health is exposed: network, contract address, generated
 * time, and explorer links. Roots, accounts, commitments, nullifiers, proofs,
 * usage, and remaining-credit data never leave the gateway through this route.
 */

import { NextResponse } from 'next/server';
import { callGateway } from '@/lib/gateway';
import { BASE_SEPOLIA_EXPLORER, PILOT_CHAIN_ID, PILOT_NETWORK } from '@/lib/credits';

const CONTRACT_PATTERN = /^0x[0-9a-fA-F]{40}$/u;

export async function GET() {
  try {
    const { status, data } = await callGateway({ method: 'GET', path: '/v1/contract-status' });
    const contractAddress = typeof data.contract === 'string' && CONTRACT_PATTERN.test(data.contract) ? data.contract : null;
    return NextResponse.json({
      network: typeof data.network === 'string' ? data.network : PILOT_NETWORK,
      chainId: PILOT_CHAIN_ID,
      contractAddress,
      healthy: status === 200 && contractAddress !== null,
      generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : new Date().toISOString(),
      explorer: contractAddress
        ? { address: `${BASE_SEPOLIA_EXPLORER}/address/${contractAddress}` }
        : null,
    });
  } catch {
    return NextResponse.json({
      network: PILOT_NETWORK,
      chainId: PILOT_CHAIN_ID,
      contractAddress: null,
      healthy: false,
      generatedAt: new Date().toISOString(),
      explorer: null,
    }, { status: 200 });
  }
}
