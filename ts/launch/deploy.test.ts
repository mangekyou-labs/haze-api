/**
 * Chain deployment reconciliation.
 *
 * A broadcast is the one irreversible step in the launch, so the assertions
 * here are about what happens when the record of it is incomplete: a receipt
 * that never arrived, a hash that was never written down, a nonce that was
 * consumed anyway. The reconciliation must confirm a deployment that happened
 * and must never confirm one that did not, because the cost of the two mistakes
 * is asymmetric.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  EXISTING_B11_CONTRACTS,
  MAX_PILOT_APPROVAL_USDC,
  PILOT_CHAIN_ID,
  assertBoundedApproval,
  assertChainId,
  assertImmutables,
  broadcastIntent,
  predictDeploymentAddress,
  reconcileBroadcast,
  type ChainReader,
} from './deploy.js';

const SIGNER = '0x1111111111111111111111111111111111111111';
const BYTECODE = '0x6080604052600436106100';

function chain(options: {
  receipt?: { status: 'success' | 'reverted'; contractAddress: string | null; blockNumber: bigint };
  code?: string;
}): ChainReader {
  return {
    receipt: async () => options.receipt,
    code: async () => options.code ?? '0x',
  };
}

describe('the pilot chain', () => {
  it('is Base Sepolia only', () => {
    expect(PILOT_CHAIN_ID).toBe(84532);
    expect(() => assertChainId(84532)).not.toThrow();
    expect(() => assertChainId(8453)).toThrow(/the RPC reports chain 8453; the pilot is chain 84532 only/u);
  });

  it('builds on the B11 verifier and adapter rather than replacing them', () => {
    expect(EXISTING_B11_CONTRACTS.verifier).toMatch(/^0x[0-9a-fA-F]{40}$/u);
    expect(EXISTING_B11_CONTRACTS.adapter).toMatch(/^0x[0-9a-fA-F]{40}$/u);
  });
});

describe('broadcast intent', () => {
  it('predicts the address from the signer and nonce before anything is sent', () => {
    const intent = broadcastIntent('PrivateCreditBond', SIGNER, 7);
    expect(intent.predictedAddress).toBe(predictDeploymentAddress(SIGNER, 7));
    expect(intent.transactionHash).toBeNull();
    expect(intent.chainId).toBe(PILOT_CHAIN_ID);
  });

  it('predicts a different address for the next nonce, so a retry is visible', () => {
    expect(predictDeploymentAddress(SIGNER, 7)).not.toBe(predictDeploymentAddress(SIGNER, 8));
  });

  it('carries no 32-byte value, so an intent is safe to persist as state detail', () => {
    const intent = broadcastIntent('PoseidonT3', SIGNER, 3, '0xhash');
    expect(Object.values(intent).every((value) => typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/u.test(value))).toBe(true);
  });
});

describe('reconciliation on resume', () => {
  it('confirms a deployment whose receipt succeeded at the predicted address', async () => {
    const intent = broadcastIntent('PrivateCreditBond', SIGNER, 7, '0xhash');
    const result = await reconcileBroadcast(intent, chain({
      receipt: { status: 'success', contractAddress: intent.predictedAddress, blockNumber: 21_000_000n },
      code: BYTECODE,
    }));
    expect(result).toEqual({
      kind: 'confirmed',
      address: intent.predictedAddress,
      blockNumber: 21_000_000n,
      transactionHash: '0xhash',
    });
  });

  it('confirms a deployment whose hash was never recorded but whose nonce was consumed', async () => {
    const intent = broadcastIntent('PrivateCreditBond', SIGNER, 7);
    const result = await reconcileBroadcast(intent, chain({ code: BYTECODE }));
    expect(result).toMatchObject({ kind: 'confirmed', address: intent.predictedAddress });
  });

  it('reports an absent deployment so a retry is safe', async () => {
    const intent = broadcastIntent('PrivateCreditBond', SIGNER, 7, '0xhash');
    const result = await reconcileBroadcast(intent, chain({ code: '0x' }));
    expect(result.kind).toBe('absent');
    expect(result).toMatchObject({ reason: expect.stringContaining('has no bytecode at') });
  });

  it('stops on a reverted receipt instead of retrying', async () => {
    const intent = broadcastIntent('PrivateCreditBond', SIGNER, 7, '0xhash');
    const result = await reconcileBroadcast(intent, chain({
      receipt: { status: 'reverted', contractAddress: null, blockNumber: 21_000_000n },
      code: '0x',
    }));
    expect(result.kind).toBe('mismatch');
    expect(result).toMatchObject({ reason: expect.stringContaining('reverted') });
  });

  it('stops when the receipt deployed a different address than the nonce predicted', async () => {
    const intent = broadcastIntent('PrivateCreditBond', SIGNER, 7, '0xhash');
    const result = await reconcileBroadcast(intent, chain({
      receipt: { status: 'success', contractAddress: '0x9999999999999999999999999999999999999999', blockNumber: 1n },
      code: BYTECODE,
    }));
    expect(result.kind).toBe('mismatch');
    expect(result).toMatchObject({ reason: expect.stringContaining('was predicted from nonce 7') });
  });

  it('stops when a successful receipt left no bytecode behind', async () => {
    const intent = broadcastIntent('PrivateCreditBond', SIGNER, 7, '0xhash');
    const result = await reconcileBroadcast(intent, chain({
      receipt: { status: 'success', contractAddress: intent.predictedAddress, blockNumber: 1n },
      code: '0x',
    }));
    expect(result.kind).toBe('mismatch');
    expect(result).toMatchObject({ reason: expect.stringContaining('has no bytecode') });
  });
});

describe('deployed immutables', () => {
  const expected = {
    usdc: '0x3333333333333333333333333333333333333333',
    treasury: '0x4444444444444444444444444444444444444444',
    refundVault: '0x5555555555555555555555555555555555555555',
    verifier: EXISTING_B11_CONTRACTS.verifier,
    adapter: EXISTING_B11_CONTRACTS.adapter,
    deploymentDomain: '84532',
  };

  it('accepts a bond that read back as intended, whatever the case', () => {
    expect(() => assertImmutables({ ...expected, usdc: expected.usdc.toUpperCase().replace('0X', '0x') }, expected)).not.toThrow();
  });

  it('names every immutable that drifted', () => {
    expect(() => assertImmutables({
      ...expected,
      treasury: '0x6666666666666666666666666666666666666666',
      deploymentDomain: '8453',
    }, expected)).toThrow(/treasury is .*expected .*; deploymentDomain is 8453, expected 84532/u);
  });
});

describe('the bounded USDC approval', () => {
  it('caps the approval at the pilot bound', () => {
    expect(MAX_PILOT_APPROVAL_USDC).toBe(80n);
    expect(() => assertBoundedApproval(1n)).not.toThrow();
    expect(() => assertBoundedApproval(80n)).not.toThrow();
  });

  it('refuses an approval above the bound, which would let the bond draw the balance', () => {
    expect(() => assertBoundedApproval(81n)).toThrow(/the approval is 81 USDC; the pilot is bounded to 80 USDC/u);
  });

  it('refuses an empty approval', () => {
    expect(() => assertBoundedApproval(0n)).toThrow(/must be greater than zero/u);
  });
});
