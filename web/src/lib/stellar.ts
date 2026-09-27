// Stellar client — Soroban RPC reads for dashboard contract state.

import {
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
const PRICE_PER_CALL = 1000n;

function getSourceAddress(): string {
  return process.env.GATEWAY_ADDRESS || process.env.STELLAR_SOURCE_ADDRESS || '';
}

function commitmentToBigInt(value: string): bigint {
  if (/^0x/i.test(value) || /^[0-9]+$/.test(value)) return BigInt(value);
  return BigInt(`0x${value}`);
}

type DepositStatus = {
  amount: bigint;
  slashed: boolean;
  withdrawn: boolean;
};

function parseDepositResult(retval: xdr.ScVal): DepositStatus | null {
  try {
    const deposit = scValToNative(retval) as Record<string, unknown> | null;
    if (!deposit || typeof deposit !== 'object') return null;

    const amount = deposit.amount;
    if (
      amount !== undefined &&
      typeof amount !== 'string' &&
      typeof amount !== 'number' &&
      typeof amount !== 'bigint'
    ) {
      return null;
    }

    return {
      amount: BigInt(amount ?? 0),
      slashed: Boolean(deposit.slashed),
      withdrawn: Boolean(deposit.withdrawn),
    };
  } catch {
    return null;
  }
}

export async function getDepositStatus(
  contractId: string,
  commitmentHex: string,
): Promise<DepositStatus | null> {
  const sourceAddress = getSourceAddress();
  if (!sourceAddress) return null;

  const server = new rpc.Server(RPC_URL, { allowHttp: true });
  const source = await server.getAccount(sourceAddress);
  const contract = new Contract(contractId);
  const commitment = nativeToScVal(commitmentToBigInt(commitmentHex), { type: 'u256' });
  const transaction = new TransactionBuilder(source, {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call('get_deposit', commitment))
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation) || !simulation.result?.retval) {
    return null;
  }

  return parseDepositResult(simulation.result.retval);
}

export function calculateRemainingCalls(
  balanceAmount: bigint,
  callsUsed?: number,
): number {
  const total = balanceAmount / PRICE_PER_CALL;
  return Number(total) - (callsUsed ?? 0);
}
