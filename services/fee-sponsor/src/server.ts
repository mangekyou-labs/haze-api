// Fee-sponsor service bootstrap (M2.4).
//
// Public fee-relay deployment unit: wraps the tested fee-relay core
// (ts/fee-sponsor-app.ts + ts/fee-relay.ts) with the Postgres store and a
// real Stellar RPC submitter. Fee-only authority — it only fee-bumps
// slash/withdraw inner txs and never alters their contents.

import express from 'express';
import { TransactionBuilder as SDKTransactionBuilder, rpc as SorobanRpc, Networks } from '@stellar/stellar-sdk';
import { createFeeRelayApp } from '@gateway/fee-sponsor-app.ts';
import { PostgresFeeSponsorStore, runMigrations, createPool } from '@gateway/db/index.ts';

const PORT = Number(process.env.PORT ?? 3002);
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
const CONTRACT_ID = process.env.ZK_CONTRACT_ID || '';
const SPONSOR_SECRET_KEY = process.env.FEE_SPONSOR_SECRET_KEY || '';
const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';

function getServer(): SorobanRpc.Server {
  return new SorobanRpc.Server(RPC_URL, { allowHttp: true });
}

// Real fee-bump envelope submitter: parse the envelope, send it, and poll for
// confirmation. Returns the fee-bump transaction hash (the inner tx hash is
// the idempotency key, recorded by the core before this runs).
async function submitEnvelope(envelopeXdr: string): Promise<string> {
  const server = getServer();
  const envelope = SDKTransactionBuilder.fromXDR(envelopeXdr, NETWORK_PASSPHRASE as never);
  const result = await server.sendTransaction(envelope);

  if (result.status === 'ERROR') {
    throw new Error(`Fee-bump transaction error: ${JSON.stringify(result.errorResult)}`);
  }

  let txResult: Awaited<ReturnType<typeof server.getTransaction>>;
  let retries = 0;
  do {
    if (retries > 20) throw new Error('Fee-bump confirmation timed out');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    txResult = await server.getTransaction(result.hash);
    retries++;
  } while (txResult.status === 'NOT_FOUND');

  if (txResult.status !== 'SUCCESS') {
    throw new Error(`Fee-bump transaction failed: ${txResult.status}`);
  }
  return result.hash;
}

async function main() {
  if (!CONTRACT_ID || !SPONSOR_SECRET_KEY) {
    console.error('FATAL: ZK_CONTRACT_ID and FEE_SPONSOR_SECRET_KEY are required');
    process.exit(1);
  }

  const pool = createPool(process.env);
  const migrationsDir = new URL('../../../ts/db/migrations/', import.meta.url).pathname;
  await runMigrations(pool, migrationsDir);

  const app = createFeeRelayApp({
    networkPassphrase: NETWORK_PASSPHRASE,
    contractId: CONTRACT_ID,
    sponsorSecretKey: SPONSOR_SECRET_KEY,
    store: new PostgresFeeSponsorStore(pool),
    submitEnvelope,
  });

  const healthApp = express();
  healthApp.use(app);
  healthApp.listen(PORT, '0.0.0.0', () => {
    console.log(`Fee-sponsor service running on port ${PORT}`);
    console.log(`Contract: ${CONTRACT_ID}`);
  });
}

void main();