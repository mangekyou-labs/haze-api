import { describe, expect, it, vi } from 'vitest';
import {
  BaseRecoveryError,
  createBaseRecoveryLookup,
  type BaseRecoveryReader,
} from './base-recovery';

const COMMITMENT = '123456789';
const COMMITMENT_HEX = `0x${BigInt(COMMITMENT).toString(16).padStart(64, '0')}` as const;
const CONTRACT = '0x0000000000000000000000000000000000000001' as const;
const ROOT = `0x${'ab'.repeat(32)}` as const;
const TX_HASH = `0x${'cd'.repeat(32)}` as const;
const NOW = 1_800_000_000;

function fundedReader(overrides: Partial<BaseRecoveryReader> = {}): BaseRecoveryReader {
  return {
    getChainId: vi.fn(async () => 84532),
    getHead: vi.fn(async () => 105n),
    getDeploymentDomain: vi.fn(async () => 84532n),
    getBundle: vi.fn(async () => ({
      state: 1n,
      tierId: 0n,
      expiry: 1_900_000_000n,
      leafIndex: 2n,
      bondAmount: 20_000_000n,
    })),
    getFundedEvents: vi.fn(async () => [{
      commitment: COMMITMENT_HEX,
      tierId: 0n,
      expiry: 1_900_000_000n,
      leafIndex: 2n,
      bondAmount: 20_000_000n,
      root: ROOT,
      transactionHash: TX_HASH,
      blockNumber: 100n,
    }]),
    getRootAt: vi.fn(async () => ROOT),
    ...overrides,
  };
}

const config = {
  contractAddress: CONTRACT,
  deploymentBlock: 90n,
  deploymentDomain: '84532',
  confirmations: 3n,
  nowSeconds: () => NOW,
};

describe('Base Sepolia recovery lookup', () => {
  it('returns metadata only for a confirmed event matching active contract state and its root', async () => {
    const reader = fundedReader();
    const lookup = createBaseRecoveryLookup(reader, config);

    await expect(lookup(COMMITMENT)).resolves.toEqual({
      commitment: COMMITMENT,
      tierId: 0,
      expiry: 1_900_000_000,
      deploymentDomain: '84532',
      network: 'eip155:84532',
      contractAddress: CONTRACT,
      transactionHash: TX_HASH,
    });
    expect(reader.getFundedEvents).toHaveBeenCalledWith(CONTRACT, COMMITMENT_HEX, 90n, 105n);
    expect(reader.getRootAt).toHaveBeenCalledWith(CONTRACT, 3n, 105n);
  });

  it('returns null when the contract has no bundle for the commitment', async () => {
    const reader = fundedReader({
      getBundle: vi.fn(async () => ({ state: 0n, tierId: 0n, expiry: 0n, leafIndex: 0n, bondAmount: 0n })),
    });
    const lookup = createBaseRecoveryLookup(reader, config);

    await expect(lookup(COMMITMENT)).resolves.toBeNull();
    expect(reader.getFundedEvents).not.toHaveBeenCalled();
  });

  it('surfaces RPC failures with a sanitized recovery error', async () => {
    const reader = fundedReader({ getHead: vi.fn(async () => { throw new Error('private endpoint URL'); }) });
    const lookup = createBaseRecoveryLookup(reader, config);

    await expect(lookup(COMMITMENT)).rejects.toMatchObject({
      name: 'BaseRecoveryError',
      code: 'chain_unavailable',
      message: 'Base recovery lookup is unavailable',
    });
  });

  it('rejects active but expired bundles', async () => {
    const reader = fundedReader({
      getBundle: vi.fn(async () => ({
        state: 1n,
        tierId: 0n,
        expiry: BigInt(NOW),
        leafIndex: 2n,
        bondAmount: 20_000_000n,
      })),
    });
    const lookup = createBaseRecoveryLookup(reader, config);

    await expect(lookup(COMMITMENT)).rejects.toMatchObject({
      name: 'BaseRecoveryError',
      code: 'bundle_expired',
    });
  });

  it('rejects state and event metadata that disagree', async () => {
    const reader = fundedReader({
      getFundedEvents: vi.fn(async () => [{
        commitment: COMMITMENT_HEX,
        tierId: 0n,
        expiry: 1_899_999_999n,
        leafIndex: 2n,
        bondAmount: 20_000_000n,
        root: ROOT,
        transactionHash: TX_HASH,
        blockNumber: 100n,
      }]),
    });
    const lookup = createBaseRecoveryLookup(reader, config);

    await expect(lookup(COMMITMENT)).rejects.toMatchObject({
      name: 'BaseRecoveryError',
      code: 'metadata_invalid',
    });
  });

  it('requires the configured number of confirmations', async () => {
    const reader = fundedReader({ getHead: vi.fn(async () => 101n) });
    const lookup = createBaseRecoveryLookup(reader, config);

    await expect(lookup(COMMITMENT)).rejects.toMatchObject({
      name: 'BaseRecoveryError',
      code: 'bundle_unconfirmed',
    });
  });

  it('rejects non-active bundle states', async () => {
    const reader = fundedReader({
      getBundle: vi.fn(async () => ({
        state: 2n,
        tierId: 0n,
        expiry: 1_900_000_000n,
        leafIndex: 2n,
        bondAmount: 20_000_000n,
      })),
    });
    const lookup = createBaseRecoveryLookup(reader, config);

    await expect(lookup(COMMITMENT)).rejects.toBeInstanceOf(BaseRecoveryError);
    await expect(lookup(COMMITMENT)).rejects.toMatchObject({ code: 'bundle_unusable' });
  });
});
