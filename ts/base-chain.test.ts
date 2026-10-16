import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Attribution } from 'ox/erc8021';
import { encodeAbiParameters, encodeEventTopics, toHex, TransactionReceiptNotFoundError } from 'viem';

const mocks = vi.hoisted(() => ({
  createWalletClient: vi.fn(),
  createPublicClient: vi.fn(),
  writeContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  getBlockNumber: vi.fn(),
  getContractEvents: vi.fn(),
}));

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createWalletClient: mocks.createWalletClient,
    createPublicClient: mocks.createPublicClient,
  };
});

import { FundingPreBroadcastError } from './pilot-funding.js';
import { createBaseBondSponsor, PRIVATE_CREDIT_BOND_ABI, readConfirmedBaseRootKnown } from './base-chain.js';

const TRANSACTION = `0x${'ab'.repeat(32)}` as const;
const BUILDER_CODE = 'bc_testcode';

describe('Base bond sponsor attribution', () => {
  beforeEach(() => {
    process.env.BASE_SPONSOR_PRIVATE_KEY = `0x${'11'.repeat(32)}`;
    process.env.BASE_RPC_URL = 'https://base-sepolia.example/rpc';
    process.env.BASE_PRIVATE_CREDIT_BOND_ADDRESS = '0x1111111111111111111111111111111111111111';
    process.env.BASE_BUILDER_CODE = BUILDER_CODE;
    mocks.createWalletClient.mockReturnValue({ writeContract: mocks.writeContract });
    mocks.createPublicClient.mockReturnValue({
      waitForTransactionReceipt: mocks.waitForTransactionReceipt,
      getBlockNumber: mocks.getBlockNumber,
      getContractEvents: mocks.getContractEvents,
      simulateContract: vi.fn().mockResolvedValue({}),
      estimateContractGas: vi.fn().mockResolvedValue(100000n),
      estimateFeesPerGas: vi.fn().mockResolvedValue({ maxFeePerGas: 1000000000n }),
      getBalance: vi.fn().mockResolvedValue(1000000000000000000n),
      getTransactionCount: vi.fn().mockResolvedValue(0),
    });
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

  it('checks root membership at the same confirmation depth as the indexer', async () => {
    const readContract = vi.fn().mockResolvedValue(true);
    mocks.getBlockNumber.mockResolvedValue(100n);
    mocks.createPublicClient.mockReturnValue({ getBlockNumber: mocks.getBlockNumber, readContract });
    await expect(readConfirmedBaseRootKnown('2')).resolves.toBe(true);
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: 'knownRoot', args: [toHex(2n, { size: 32 })], blockNumber: 97n,
    }));
    readContract.mockRejectedValue(new Error('RPC unavailable'));
    await expect(readConfirmedBaseRootKnown('2')).rejects.toThrow('RPC unavailable');
    expect(mocks.writeContract).not.toHaveBeenCalled();
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
    expect(mocks.waitForTransactionReceipt).toHaveBeenCalledWith(expect.objectContaining({ hash: TRANSACTION, confirmations: 3 }));
  });

  it('recovers confirmed funding from its matching receipt without historical scans', async () => {
    const sponsor = createBaseBondSponsor();
    const rpc = mocks.createPublicClient.mock.results.at(-1)!.value;
    rpc.getTransactionReceipt = vi.fn().mockResolvedValue({ status: 'success', transactionHash: TRANSACTION, blockNumber: 7n,
      logs: [{ address: process.env.BASE_PRIVATE_CREDIT_BOND_ADDRESS,
        topics: encodeEventTopics({ abi: PRIVATE_CREDIT_BOND_ABI, eventName: 'BundleFunded', args: { commitment: toHex(123n, { size: 32 }), tierId: 0n } }),
        data: encodeAbiParameters([{ type: 'uint64' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }], [1800000000n, 0n, 20000000n, toHex(1n, { size: 32 })]),
      }],
    });
    mocks.getBlockNumber.mockResolvedValue(10n);
    mocks.getContractEvents.mockResolvedValue([]);
    await expect(sponsor.reconcileBundle('123', TRANSACTION)).resolves.toEqual({ transaction: TRANSACTION, expiryAt: 1800000000000 });
    expect(rpc.getTransactionReceipt).toHaveBeenCalledWith({ hash: TRANSACTION });
    expect(mocks.getContractEvents).not.toHaveBeenCalled();
    expect(mocks.writeContract).not.toHaveBeenCalled();
  });

  it.each(['pending', 'missing', 'wrong-contract', 'wrong-commitment'])('keeps commitment recovery when the receipt is %s', async (reason) => {
    const sponsor = createBaseBondSponsor();
    const rpc = mocks.createPublicClient.mock.results.at(-1)!.value;
    const receipt = { status: 'success', transactionHash: TRANSACTION, blockNumber: reason === 'pending' ? 8n : 7n,
      logs: [{ address: reason === 'wrong-contract' ? '0x0000000000000000000000000000000000000001' : process.env.BASE_PRIVATE_CREDIT_BOND_ADDRESS,
        topics: encodeEventTopics({ abi: PRIVATE_CREDIT_BOND_ABI, eventName: 'BundleFunded', args: { commitment: toHex(reason === 'wrong-commitment' ? 456n : 123n, { size: 32 }), tierId: 0n } }),
        data: encodeAbiParameters([{ type: 'uint64' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }], [1800000000n, 0n, 20000000n, toHex(1n, { size: 32 })]),
      }],
    };
    rpc.getTransactionReceipt = reason === 'missing'
      ? vi.fn().mockRejectedValue(new TransactionReceiptNotFoundError({ hash: TRANSACTION }))
      : vi.fn().mockResolvedValue(receipt);
    mocks.getBlockNumber.mockResolvedValue(10n);
    const replacement = `0x${'cd'.repeat(32)}`;
    mocks.getContractEvents.mockResolvedValue([{ args: { commitment: toHex(123n, { size: 32 }), expiry: 1800000000n }, transactionHash: replacement }]);
    await expect(sponsor.reconcileBundle('123', TRANSACTION)).resolves.toEqual({ transaction: replacement, expiryAt: 1800000000000 });
    expect(mocks.getContractEvents).toHaveBeenCalledWith(expect.objectContaining({ toBlock: 7n }));
    expect(mocks.writeContract).not.toHaveBeenCalled();
  });

  it('preserves uncertainty after a receipt provider failure', async () => {
    const sponsor = createBaseBondSponsor();
    const rpc = mocks.createPublicClient.mock.results.at(-1)!.value;
    rpc.getTransactionReceipt = vi.fn().mockRejectedValue(new Error('RPC unavailable'));
    await expect(sponsor.reconcileBundle('123', TRANSACTION)).rejects.toThrow('RPC unavailable');
    expect(mocks.getContractEvents).not.toHaveBeenCalled();
    expect(mocks.writeContract).not.toHaveBeenCalled();
  });

  it('releases definitively before a write when gas or pending-nonce reads fail', async () => {
    // Construction creates the client; manipulate its local RPC stubs.
    const sponsor = createBaseBondSponsor();
    const rpc = mocks.createPublicClient.mock.results.at(-1)!.value;
    rpc.getBalance.mockResolvedValue(1n);
    await expect(sponsor.fundBundle('1', 0)).rejects.toThrow('insufficient_gas');
    expect(mocks.writeContract).not.toHaveBeenCalled();
    rpc.getBalance.mockResolvedValue(1000000000000000000n);
    rpc.getTransactionCount.mockRejectedValue(new Error('RPC unavailable'));
    await expect(sponsor.fundBundle('1', 0)).rejects.toBeInstanceOf(FundingPreBroadcastError);
    expect(mocks.writeContract).not.toHaveBeenCalled();
  });

  it('persists original and replacement hashes while waiting for confirmation', async () => {
    const replacementHash = `0x${'cd'.repeat(32)}`;
    mocks.waitForTransactionReceipt.mockImplementation(async ({ onReplaced }) => {
      await onReplaced({ transaction: { hash: replacementHash } });
      return { status: 'success', transactionHash: replacementHash, logs: [] };
    });
    const persisted = vi.fn(async (_hash: string) => {});
    await expect(createBaseBondSponsor().fundBundle('1', 0, persisted)).rejects.toThrow('base_funding_event_missing');
    expect(persisted.mock.calls).toEqual([[TRANSACTION], [replacementHash]]);
  });

  it('reports exhausted allowance when it changes before funding simulation', async () => {
    const sponsor = createBaseBondSponsor();
    const rpc = mocks.createPublicClient.mock.results.at(-1)!.value;
    let allowance = 20_000_000n;
    rpc.getChainId = vi.fn().mockResolvedValue(84532);
    rpc.readContract = vi.fn().mockImplementation(async ({ functionName }) => {
      switch (functionName) {
        case 'sponsor': return '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A';
        case 'usdc': return '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
        case 'tierConfig': return [250n, 20_000_000n];
        case 'balanceOf': return 20_000_000n;
        case 'allowance': return allowance;
        default: throw new Error('unexpected read');
      }
    });
    await expect(sponsor.fundingStatus()).resolves.toMatchObject({ ready: true, reason: null });
    allowance = 0n;
    rpc.simulateContract.mockRejectedValue(new Error('transfer allowance exhausted'));

    await expect(sponsor.fundBundle('1', 0)).rejects.toThrow('insufficient_allowance');
    expect(mocks.writeContract).not.toHaveBeenCalled();
  });

  it('fails closed when no Builder Code is configured', () => {
    delete process.env.BASE_BUILDER_CODE;

    expect(() => createBaseBondSponsor()).toThrow('BASE_BUILDER_CODE is not configured');
    expect(mocks.createWalletClient).not.toHaveBeenCalled();
  });

  it('reconciles within the configured RPC log range without gaps', async () => {
    vi.stubEnv('BASE_SYNC_MAX_BLOCK_RANGE', '10');
    vi.stubEnv('BASE_DEPLOYMENT_BLOCK', '100');
    mocks.getBlockNumber.mockResolvedValue(128n);
    mocks.getContractEvents.mockImplementation(async ({ fromBlock, toBlock }) => {
      if (toBlock - fromBlock + 1n > 10n) throw new Error('RPC log range exceeds ten blocks');
      return fromBlock === 120n ? [{
        args: { commitment: `0x${'0'.repeat(63)}1`, expiry: 1_800_000_000n },
        transactionHash: TRANSACTION,
      }] : [];
    });
    try {
      await expect(createBaseBondSponsor().reconcileBundle('1')).resolves.toEqual({
        transaction: TRANSACTION, expiryAt: 1_800_000_000_000,
      });
      expect(mocks.getContractEvents.mock.calls.map(([range]) => [range.fromBlock, range.toBlock])).toEqual([
        [100n, 109n], [110n, 119n], [120n, 125n],
      ]);
      expect(mocks.writeContract).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it('reconciles only events inside the three-confirmation window', async () => {
    mocks.getBlockNumber.mockResolvedValue(10n);
    mocks.getContractEvents.mockResolvedValue([{
      args: { commitment: `0x${'0'.repeat(63)}1`, expiry: 1_800_000_000n },
      transactionHash: TRANSACTION,
    }]);
    const result = await createBaseBondSponsor().reconcileBundle('1');
    expect(result).toEqual({ transaction: TRANSACTION, expiryAt: 1_800_000_000_000 });
    expect(mocks.getContractEvents).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: 0n, toBlock: 7n }));
  });
});

describe('bounded sandbox USDC approval', () => {
  const TOKEN = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
  beforeEach(() => {
    vi.stubEnv('BASE_SPONSOR_PRIVATE_KEY', `0x${'11'.repeat(32)}`);
    vi.stubEnv('BASE_PRIVATE_CREDIT_BOND_ADDRESS', '0x1111111111111111111111111111111111111111');
    vi.stubEnv('BASE_BUILDER_CODE', BUILDER_CODE);
    let allowance = 0n;
    mocks.createWalletClient.mockReturnValue({ writeContract: mocks.writeContract });
    mocks.createPublicClient.mockReturnValue({
      getChainId: vi.fn().mockResolvedValue(84532),
      readContract: vi.fn().mockImplementation(async ({ functionName }) => ({
        sponsor: '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A', usdc: TOKEN,
        tierConfig: [250n, 20_000_000n], balanceOf: 20_000_000n, allowance,
      })[functionName as string]),
      getBalance: vi.fn().mockResolvedValue(10n ** 18n),
      getTransactionCount: vi.fn().mockResolvedValue(0),
      simulateContract: vi.fn().mockResolvedValue({}),
      estimateContractGas: vi.fn().mockResolvedValue(100000n),
      estimateFeesPerGas: vi.fn().mockResolvedValue({ maxFeePerGas: 1000000000n }),
      waitForTransactionReceipt: mocks.waitForTransactionReceipt,
    });
    mocks.writeContract.mockResolvedValue(TRANSACTION);
    mocks.waitForTransactionReceipt.mockImplementation(async () => {
      allowance = 20_000_000n;
      return { status: 'success', logs: [] };
    });
  });
  afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

  it('approves exactly one bundle and confirms approval before broadcasting funding', async () => {
    const sponsor = createBaseBondSponsor({ autoApproveUsdc: true });
    await expect(sponsor.fundingStatus()).resolves.toMatchObject({ ready: true, allowance: '0' });
    const broadcast = vi.fn();
    await expect(sponsor.fundBundle('1', 0, broadcast)).rejects.toThrow('base_funding_event_missing');
    expect(mocks.writeContract.mock.calls.map(([write]) => write.functionName)).toEqual(['approve', 'fundBundle']);
    expect(mocks.writeContract.mock.calls[0][0]).toMatchObject({ address: TOKEN, args: ['0x1111111111111111111111111111111111111111', 20_000_000n] });
    expect(broadcast).toHaveBeenCalledExactlyOnceWith(TRANSACTION);
  });

  it('leaves automatic approval off by default', async () => {
    await expect(createBaseBondSponsor().fundingStatus()).resolves.toMatchObject({ ready: false, reason: 'insufficient_allowance' });
    expect(mocks.writeContract).not.toHaveBeenCalled();
  });

  it('uses existing allowance without another approval', async () => {
    const sponsor = createBaseBondSponsor({ autoApproveUsdc: true });
    await mocks.waitForTransactionReceipt(); // confirmed previous approval
    await expect(sponsor.fundBundle('1', 0)).rejects.toThrow('base_funding_event_missing');
    expect(mocks.writeContract.mock.calls.map(([write]) => write.functionName)).toEqual(['fundBundle']);
  });

  it.each([
    ['wrong_chain', 'chain', 1],
    ['sponsor_mismatch', 'sponsor', '0x0000000000000000000000000000000000000001'],
    ['unsupported_token', 'usdc', '0x0000000000000000000000000000000000000001'],
    ['unsupported_tier', 'tierConfig', [999n, 20_000_000n]],
  ])('rejects %s before approval or funding', async (reason, field, value) => {
    const sponsor = createBaseBondSponsor({ autoApproveUsdc: true });
    const rpc = mocks.createPublicClient.mock.results.at(-1)!.value;
    if (field === 'chain') rpc.getChainId.mockResolvedValue(value);
    else {
      const original = rpc.readContract.getMockImplementation();
      rpc.readContract.mockImplementation(async (request: { functionName: string }) => request.functionName === field ? value : original(request));
    }
    await expect(sponsor.fundBundle('1', 0)).rejects.toThrow(reason);
    expect(mocks.writeContract).not.toHaveBeenCalled();
  });

  it('rejects non-sandbox funding tiers before approval', async () => {
    await expect(createBaseBondSponsor({ autoApproveUsdc: true }).fundBundle('1', 1)).rejects.toThrow('unsupported_tier');
    expect(mocks.writeContract).not.toHaveBeenCalled();
  });

  it('does not replace an unconfirmed sponsor transaction with another approval', async () => {
    const sponsor = createBaseBondSponsor({ autoApproveUsdc: true });
    const rpc = mocks.createPublicClient.mock.results.at(-1)!.value;
    rpc.getTransactionCount.mockImplementation(async ({ blockTag }: { blockTag: string }) => blockTag === 'pending' ? 1 : 0);
    await expect(sponsor.fundBundle('1', 0)).rejects.toThrow('approval_pending');
    expect(mocks.writeContract).not.toHaveBeenCalled();
  });

  it('rejects insufficient approval gas before any approval or funding write', async () => {
    const sponsor = createBaseBondSponsor({ autoApproveUsdc: true });
    const rpc = mocks.createPublicClient.mock.results.at(-1)!.value;
    rpc.getBalance.mockResolvedValue(1n);
    await expect(sponsor.fundBundle('1', 0)).rejects.toThrow('insufficient_gas');
    expect(mocks.writeContract).not.toHaveBeenCalled();
  });

  it.each(['write_timeout', 'receipt_timeout', 'reverted'])('never funds or reports an approval hash as bundle funding after %s', async failure => {
    const sponsor = createBaseBondSponsor({ autoApproveUsdc: true });
    if (failure === 'write_timeout') mocks.writeContract.mockRejectedValueOnce(new Error('private RPC endpoint'));
    else if (failure === 'receipt_timeout') mocks.waitForTransactionReceipt.mockRejectedValueOnce(new Error('private RPC endpoint'));
    else mocks.waitForTransactionReceipt.mockResolvedValueOnce({ status: 'reverted' });
    const broadcast = vi.fn();
    await expect(sponsor.fundBundle('1', 0, broadcast)).rejects.toThrow(failure === 'reverted' ? 'approval_failed' : 'approval_pending');
    expect(mocks.writeContract.mock.calls.map(([write]) => write.functionName)).toEqual(['approve']);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
