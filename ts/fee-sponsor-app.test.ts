// Fee-sponsor HTTP service tests (M2.4). Black-box via supertest against the
// app factory with an injected (in-memory) store + mocked submitter.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
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
import { createFeeRelayApp } from './fee-sponsor-app.js';
import { MemoryFeeSponsorStore, type FeeRelayDeps } from './db/index.js';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 9));
const PASS = Networks.TESTNET;
const SOURCE = Keypair.random();

function fakeAccount() {
  return {
    accountId: () => SOURCE.publicKey(),
    sequenceNumber: () => '1',
    incrementSequenceNumber: () => {},
  } as unknown as Parameters<typeof TransactionBuilder>[0];
}

function buildWithdrawTx(): string {
  const contract = new Contract(CONTRACT_ID);
  const tx = new TransactionBuilder(fakeAccount(), {
    fee: BASE_FEE,
    networkPassphrase: PASS,
  })
    .addOperation(
      contract.call(
        'withdraw',
        nativeToScVal('123'),
        Address.fromString(Keypair.random().publicKey()).toScVal(),
      ),
    )
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

describe('fee-sponsor HTTP service', () => {
  let store: MemoryFeeSponsorStore;
  let submitEnvelope: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = new MemoryFeeSponsorStore();
    submitEnvelope = vi.fn().mockResolvedValue('fee-bump-hash-1');
  });

  function app() {
    return createFeeRelayApp({
      networkPassphrase: PASS,
      contractId: CONTRACT_ID,
      sponsorSecretKey: Keypair.random().secret(),
      store,
      submitEnvelope,
    } as FeeRelayDeps);
  }

  it('GET /health returns ok', async () => {
    const res = await request(app()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('POST /v1/fee-relay accepts a withdraw tx and returns the fee-bump hash', async () => {
    const res = await request(app())
      .post('/v1/fee-relay')
      .send({ innerTransactionXdr: buildWithdrawTx() });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(true);
    expect(res.body.method).toBe('withdraw');
    expect(res.body.feeBumpHash).toBe('fee-bump-hash-1');
  });

  it('POST /v1/fee-relay is idempotent on retry', async () => {
    const xdr = buildWithdrawTx();
    const first = await request(app()).post('/v1/fee-relay').send({ innerTransactionXdr: xdr });
    const second = await request(app()).post('/v1/fee-relay').send({ innerTransactionXdr: xdr });
    expect(first.body.accepted).toBe(true);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.feeBumpHash).toBe('fee-bump-hash-1'); // prior result preserved
    expect(submitEnvelope).toHaveBeenCalledTimes(1);
  });

  it('POST /v1/fee-relay rejects a missing inner transaction', async () => {
    const res = await request(app()).post('/v1/fee-relay').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_inner_transaction');
  });

  it('POST /v1/fee-relay rejects a payment (non-contract) transaction with 403', async () => {
    const res = await request(app()).post('/v1/fee-relay').send({ innerTransactionXdr: buildPaymentTx() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('invalid_relay_request');
  });
});