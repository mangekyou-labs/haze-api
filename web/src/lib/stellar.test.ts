import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Account,
  Keypair,
  nativeToScVal,
  rpc,
  StrKey,
} from '@stellar/stellar-sdk';
import { getDepositStatus } from './stellar';

const sourceAddress = Keypair.random().publicKey();
const contractId = StrKey.encodeContract(Buffer.alloc(32, 7));

describe('web Stellar contract reads', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GATEWAY_ADDRESS;
  });

  it('reads a deposit through Soroban RPC simulation', async () => {
    process.env.GATEWAY_ADDRESS = sourceAddress;

    const getAccount = vi
      .spyOn(rpc.Server.prototype, 'getAccount')
      .mockResolvedValue(new Account(sourceAddress, '1'));
    const simulateTransaction = vi
      .spyOn(rpc.Server.prototype, 'simulateTransaction')
      .mockResolvedValue({
        id: 'simulation',
        latestLedger: 1,
        minResourceFee: '0',
        cost: { cpuInsns: '0', memBytes: '0' },
        result: {
          retval: nativeToScVal(
            {
              amount: 5_0000000n,
              commitment: 42n,
              depositor: sourceAddress,
              slashed: false,
              withdrawn: false,
            },
            {
              // The SDK's map type declaration omits boolean field variants,
              // although the runtime accepts the contract's bool values.
              type: {
                amount: [null, 'i128'],
                commitment: [null, 'u256'],
                depositor: [null, 'address'],
                slashed: [null, 'bool'],
                withdrawn: [null, 'bool'],
              } as never,
            },
          ),
        },
      } as never);

    await expect(getDepositStatus(contractId, '2a')).resolves.toEqual({
      amount: 5_0000000n,
      slashed: false,
      withdrawn: false,
    });
    expect(getAccount).toHaveBeenCalledWith(sourceAddress);
    expect(simulateTransaction).toHaveBeenCalledOnce();
  });
});
