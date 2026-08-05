// Fee-relay core tests (M2.4). Builds real Stellar transactions with the SDK
// to exercise the method-validation gate + idempotency + fee-bump submission.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TransactionBuilder,
  Contract,
  Keypair,
  Networks,
  Operation,
  BASE_FEE,
  nativeToScVal,
  StrKey,
  Address,
  Asset,
} from '@stellar/stellar-sdk';
import {
  validateRelayRequest,
  relayOne,
  buildFeeBumpEnvelope,
  InvalidRelayRequestError,
  type FeeRelayConfig,
  type FeeRelayDeps,
} from './fee-relay.js';
import { MemoryFeeSponsorStore } from './db/index.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 7));
const PASS = Networks.TESTNET;
const SOURCE = Keypair.random();

function fakeAccount() {
  return {
    accountId: () => SOURCE.publicKey(),
    sequenceNumber: () => '1',
    incrementSequenceNumber: () => {},
  } as unknown as Parameters<typeof TransactionBuilder>[0];
}

function buildContractTx(method: 'slash' | 'withdraw' | 'deposit'): string {
  const contract = new Contract(CONTRACT_ID);
  const addrVal = Address.fromString(Keypair.random().publicKey()).toScVal();
  const args: unknown[] =
    method === 'slash'
      ? [nativeToScVal({ a: 'A', b: 'B', c: 'C' }), nativeToScVal(['1', '2']), nativeToScVal('123'), addrVal]
      : method === 'withdraw'
        ? [nativeToScVal('123'), addrVal]
        : [addrVal, nativeToScVal('123'), nativeToScVal('0'), nativeToScVal(100)];

  const tx = new TransactionBuilder(fakeAccount(), {
    fee: BASE_FEE,
    networkPassphrase: PASS,
  })
    .addOperation(contract.call(method, ...(args as never[])))
    .setTimeout(30)
    .build();
  return tx.toEnvelope().toXDR('base64');
}

function buildPaymentTx(): string {
  const tx = new TransactionBuilder(fakeAccount(), {
    fee: BASE_FEE,
    networkPassphrase: PASS,
  })
    .addOperation(
      Operation.payment({
        destination: SOURCE.publicKey(),
        asset: Asset.native(),
        amount: '1',
      }),
    )
    .setTimeout(30)
    .build();
  return tx.toEnvelope().toXDR('base64');
}

const CFG: FeeRelayConfig = {
  networkPassphrase: PASS,
  contractId: CONTRACT_ID,
  sponsorSecretKey: Keypair.random().secret(),
};

describe('validateRelayRequest (method-validation gate)', () => {
  it('accepts a slash transaction', () => {
    const { method, innerTxHash } = validateRelayRequest(buildContractTx('slash'), CONTRACT_ID);
    expect(method).toBe('slash');
    expect(innerTxHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts a withdraw transaction', () => {
    const result = validateRelayRequest(buildContractTx('withdraw'), CONTRACT_ID);
    expect(result.method).toBe('withdraw');
  });

  it('rejects a non-contract transaction (payment) with 403', () => {
    try {
      validateRelayRequest(buildPaymentTx(), CONTRACT_ID);
      expect.fail('expected rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidRelayRequestError);
      expect((err as InvalidRelayRequestError).status).toBe(403);
    }
  });

describe('relayOne (fee-only sponsorship + idempotency)', () => {
  let store: MemoryFeeSponsorStore;
  let submitEnvelope: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = new MemoryFeeSponsorStore();
    submitEnvelope = vi.fn().mockResolvedValue('fee-bump-tx-hash-1');
  });

  function deps(): FeeRelayDeps {
    return { ...CFG, store, submitEnvelope };
  }

  it('fee-bumps and submits an allowed method exactly once', async () => {
    const result = await relayOne(deps(), buildContractTx('withdraw'));

    expect(result.duplicate).toBe(false);
    expect(result.method).toBe('withdraw');
    expect(result.feeBumpHash).toBe('fee-bump-tx-hash-1');
    expect(submitEnvelope).toHaveBeenCalledTimes(1);

    const req = await store.getRequest(result.innerTxHash);
    expect(req?.status).toBe('submitted');
  });

  it('is idempotent on the inner tx hash (retry does not re-sponsor)', async () => {
    const xdr = buildContractTx('slash');
    const first = await relayOne(deps(), xdr);
    const second = await relayOne(deps(), xdr);

    expect(second.duplicate).toBe(true);
    expect(submitEnvelope).toHaveBeenCalledTimes(1);
    expect(second.innerTxHash).toBe(first.innerTxHash);
  });

  it('marks failed and surfaces 503 when submission fails', async () => {
    submitEnvelope.mockRejectedValueOnce(new Error('rpc down'));

    await expect(relayOne(deps(), buildContractTx('withdraw'))).rejects.toMatchObject({ status: 503 });

    const reqs = await store.listRequests();
    expect(reqs[0].status).toBe('failed');
  });
});

describe('buildFeeBumpEnvelope', () => {
  it('produces a base64 fee-bump envelope from an inner contract tx', () => {
    const xdr = buildContractTx('withdraw');
    const envelope = buildFeeBumpEnvelope(xdr, CFG);
    expect(envelope).toMatch(/^[A-Za-z0-9+/=]+$/);
    // Fee bump wraps the inner transaction: envelope is larger than inner.
    expect(envelope.length).toBeGreaterThan(xdr.length);
  });
});

  it('rejects a disallowed contract method (deposit)', () => {
    try {
      validateRelayRequest(buildContractTx('deposit'), CONTRACT_ID);
      expect.fail('expected rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidRelayRequestError);
      expect((err as InvalidRelayRequestError).status).toBe(403);
      expect((err as InvalidRelayRequestError).message).toMatch(/not sponsored/);
    }
  });

  it('rejects malformed XDR', () => {
    try {
      validateRelayRequest('not-a-tx!!', CONTRACT_ID);
      expect.fail('expected rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidRelayRequestError);
      expect((err as InvalidRelayRequestError).message).toMatch(/malformed/);
    }
  });
});
