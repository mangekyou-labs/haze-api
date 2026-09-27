import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { callGateway, findFundedBundleOnBase } = vi.hoisted(() => ({
  callGateway: vi.fn(),
  findFundedBundleOnBase: vi.fn(),
}));
vi.mock('@/lib/gateway', () => ({ callGateway }));
vi.mock('@/lib/base-recovery', () => ({ findFundedBundleOnBase }));

import { GET } from './route';

const COMMITMENT = '123456789';

function request(commitment: string): NextRequest {
  return new NextRequest(`http://localhost/api/pilot/recovery?commitment=${encodeURIComponent(commitment)}`);
}

describe('GET /api/pilot/recovery', () => {
  beforeEach(() => {
    callGateway.mockReset();
    findFundedBundleOnBase.mockReset();
  });

  it('looks up only the browser-derived commitment and returns activation metadata', async () => {
    callGateway.mockResolvedValue({
      status: 200,
      data: {
        commitment: COMMITMENT,
        tierId: 0,
        expiry: 1_900_000_000,
        deploymentDomain: '84532',
        network: 'eip155:84532',
        contractAddress: '0x0000000000000000000000000000000000000001',
        transactionHash: '0xfunded',
        fundedAt: 1_800_000_000,
      },
    });

    const response = await GET(request(COMMITMENT));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      commitment: COMMITMENT,
      tierId: 0,
      expiry: 1_900_000_000,
      deploymentDomain: '84532',
      network: 'eip155:84532',
      contractAddress: '0x0000000000000000000000000000000000000001',
      transactionHash: '0xfunded',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(callGateway).toHaveBeenCalledWith({
      method: 'GET',
      path: `/v1/pilot/bundles/${COMMITMENT}`,
    });
  });

  it.each(['', 'not-a-number', '0', '-1', '21888242871839275222246405745257275088548364400416034343698204186575808495617'])(
    'rejects invalid commitment %s without contacting the gateway',
    async (commitment) => {
      const response = await GET(request(commitment));
      expect(response.status).toBe(400);
      expect(callGateway).not.toHaveBeenCalled();
    },
  );

  it('uses the Base Sepolia read-only lookup when the gateway store has no bundle', async () => {
    callGateway.mockResolvedValue({ status: 404, data: { error: 'bundle_not_found' } });
    findFundedBundleOnBase.mockResolvedValue({
      commitment: COMMITMENT,
      tierId: 0,
      expiry: 1_900_000_000,
      deploymentDomain: '84532',
      network: 'eip155:84532',
      contractAddress: '0x0000000000000000000000000000000000000001',
      transactionHash: '0xfunded',
    });

    const response = await GET(request(COMMITMENT));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      commitment: COMMITMENT,
      tierId: 0,
      expiry: 1_900_000_000,
      deploymentDomain: '84532',
      network: 'eip155:84532',
      contractAddress: '0x0000000000000000000000000000000000000001',
      transactionHash: '0xfunded',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(callGateway).toHaveBeenCalledTimes(1);
    expect(callGateway).toHaveBeenCalledWith({
      method: 'GET',
      path: `/v1/pilot/bundles/${COMMITMENT}`,
    });
    expect(findFundedBundleOnBase).toHaveBeenCalledWith(COMMITMENT);
  });

  it('returns not found when neither the gateway nor Base has a funded bundle', async () => {
    callGateway.mockResolvedValue({ status: 404, data: { error: 'bundle_not_found' } });
    findFundedBundleOnBase.mockResolvedValue(null);

    const response = await GET(request(COMMITMENT));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'bundle_not_found' });
  });

  it('does not use Base for unrelated gateway 404 responses', async () => {
    callGateway.mockResolvedValue({ status: 404, data: { error: 'not_found' } });

    const response = await GET(request(COMMITMENT));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
    expect(findFundedBundleOnBase).not.toHaveBeenCalled();
  });

  it('surfaces Base RPC failures as a recovery error', async () => {
    callGateway.mockResolvedValue({ status: 404, data: { error: 'bundle_not_found' } });
    findFundedBundleOnBase.mockRejectedValue(new Error('private RPC details'));

    const response = await GET(request(COMMITMENT));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'recovery_chain_unavailable' });
  });

  it('surfaces expired Base bundles without returning activation metadata', async () => {
    callGateway.mockResolvedValue({ status: 404, data: { error: 'bundle_not_found' } });
    findFundedBundleOnBase.mockRejectedValue({ code: 'bundle_expired' });

    const response = await GET(request(COMMITMENT));
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: 'bundle_expired' });
  });

  it('does not use Base as a fallback for gateway errors other than bundle-not-found', async () => {
    callGateway.mockResolvedValue({ status: 503, data: { error: 'pilot_store_unavailable' } });

    const response = await GET(request(COMMITMENT));
    expect(response.status).toBe(503);
    expect(findFundedBundleOnBase).not.toHaveBeenCalled();
  });
});
