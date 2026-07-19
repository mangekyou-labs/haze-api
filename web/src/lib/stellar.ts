// @ts-nocheck
// Stellar client — Soroban RPC for reading contract state
// NOTE: This file is a stub for M8 E2E integration. The XDR construction
// needs to be updated for @stellar/stellar-sdk v16 API changes.

import { xdr, scValToNative } from '@stellar/stellar-sdk';

const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const PRICE_PER_CALL = 1000n;

function commitmentToBytes(hex: string): number[] {
  const padded = hex.padStart(64, '0');
  const bytes: number[] = [];
  for (let i = 0; i < padded.length; i += 2) {
    bytes.push(parseInt(padded.slice(i, i + 2), 16));
  }
  if (bytes.length !== 32) {
    throw new Error(`Commitment must be 32 bytes, got ${bytes.length}`);
  }
  return bytes;
}

export async function getDepositStatus(
  contractId: string,
  commitmentHex: string,
): Promise<{ amount: bigint; slashed: boolean; withdrawn: boolean } | null> {
  const commitmentBytes = commitmentToBytes(commitmentHex);

  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'simulateTransaction',
    params: {
      transaction: '',
    },
  };

  const xdrStr = buildSimulationTxXdr(contractId, commitmentBytes);
  body.params.transaction = xdrStr;

  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (data.error || !data.result) {
    return null;
  }

  return parseDepositResult(data.result);
}

function buildSimulationTxXdr(contractId: string, commitmentBytes: number[]): string {
  const commitmentVal = new xdr.ScVal.scvBytes(Buffer.from(commitmentBytes));
  const contractIdBytes = Buffer.from(contractId, 'hex');

  const hostFn = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: xdr.ScAddress.scAddressTypeContract(contractIdBytes),
      functionName: 'get_deposit',
      args: [commitmentVal],
    }),
  );

  const tx = new xdr.TransactionEnvelope.envelopeTypeTx(
    new xdr.TransactionV1Envelope({
      tx: new xdr.Transaction({
        sourceAccount: xdr.MuxedAccount.med25519(Buffer.alloc(32)),
        fee: 100,
        seqNum: xdr.SequenceNumber.fromString('0'),
        cond: xdr.Preconditions.precondNone(),
        memo: xdr.Memo.memoNone(),
        operations: [
          new xdr.Operation({
            body: xdr.OperationBody.invokeHostFunction(hostFn),
          }),
        ],
        ext: new xdr.TransactionExt(0, Buffer.alloc(0)),
      }),
      signatures: [],
    }),
  );

  return tx.toXDR('base64');
}

function parseDepositResult(
  result: Record<string, unknown>,
): { amount: bigint; slashed: boolean; withdrawn: boolean } | null {
  try {
    const retval = (result as Record<string, unknown>).retval as Record<string, unknown>;
    if (!retval) return null;

    const deposit = scValToNative(retval as xdr.ScVal) as Record<string, unknown>;
    if (!deposit || (deposit as Record<string, unknown>)._type === 'void') return null;

    return {
      amount: BigInt((deposit as Record<string, unknown>).amount ?? 0),
      slashed: Boolean((deposit as Record<string, unknown>).slashed),
      withdrawn: Boolean((deposit as Record<string, unknown>).withdrawn),
    };
  } catch {
    return null;
  }
}

export function calculateRemainingCalls(
  balanceAmount: bigint,
  callsUsed?: number,
): number {
  const total = balanceAmount / PRICE_PER_CALL;
  return Number(total) - (callsUsed ?? 0);
}
