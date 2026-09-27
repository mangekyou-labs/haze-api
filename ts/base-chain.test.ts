import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Attribution } from 'ox/erc8021';

const mocks = vi.hoisted(() => ({
  createWalletClient: vi.fn(),
  createPublicClient: vi.fn(),
  writeContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createWalletClient: mocks.createWalletClient,
    createPublicClient: mocks.createPublicClient,
  };
});

import { createBaseBondSponsor } from './base-chain.js';

const TRANSACTION = `0x${'ab'.repeat(32)}` as const;
const BUILDER_CODE = 'bc_testcode';

describe('Base bond sponsor attribution', () => {
  beforeEach(() => {
    process.env.BASE_SPONSOR_PRIVATE_KEY = `0x${'11'.repeat(32)}`;
    process.env.BASE_RPC_URL = 'https://base-sepolia.example/rpc';
    process.env.BASE_PRIVATE_CREDIT_BOND_ADDRESS = '0x1111111111111111111111111111111111111111';
    process.env.BASE_BUILDER_CODE = BUILDER_CODE;
    mocks.createWalletClient.mockReturnValue({ writeContract: mocks.writeContract });
    mocks.createPublicClient.mockReturnValue({ waitForTransactionReceipt: mocks.waitForTransactionReceipt });
    mocks.writeContract.mockResolvedValue(TRANSACTION);
    mocks.waitForTransactionReceipt.mockResolvedValue({ status: 'success', logs: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.BASE_SPONSOR_PRIVATE_KEY;
    delete process.env.BASE_RPC_URL;
    delete process.env.BASE_PRIVATE_CREDIT_BOND_ADDRESS;
    delete process.env.BASE_BUILDER_CODE;
  });

  it('attaches the configured Builder Code to funding and release writes', async () => {
    const sponsor = createBaseBondSponsor();

    await expect(sponsor.fundBundle('1', 2)).rejects.toThrow('base_funding_event_missing');
    await expect(sponsor.releaseBond('1')).resolves.toEqual({ transaction: TRANSACTION });

    expect(mocks.createWalletClient).toHaveBeenCalledWith(expect.objectContaining({
      dataSuffix: Attribution.toDataSuffix({ codes: [BUILDER_CODE] }),
    }));
    expect(mocks.writeContract.mock.calls.map(([request]) => request.functionName)).toEqual([
      'fundBundle',
      'releaseBond',
    ]);
  });

  it('fails closed when no Builder Code is configured', () => {
    delete process.env.BASE_BUILDER_CODE;

    expect(() => createBaseBondSponsor()).toThrow('BASE_BUILDER_CODE is not configured');
    expect(mocks.createWalletClient).not.toHaveBeenCalled();
  });
});
