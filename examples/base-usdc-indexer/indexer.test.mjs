import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexTransfers } from './indexer.mjs';

const transfer = { chainId: 84532, transactionHash: `0x${'ab'.repeat(32)}`, logIndex: 0, amount: '2000000' };
test('deduplicates repeated RPC logs', () => {
  const indexed = indexTransfers([transfer, { ...transfer }]);
  assert.equal(indexed.length, 1);
  assert.equal(indexed.reduce((sum, log) => sum + log.amount, 0n), 2000000n);
});
test('preserves two transfers in the same transaction', () => {
  const indexed = indexTransfers([transfer, { ...transfer, logIndex: 1, amount: '3000000' }]);
  assert.equal(indexed.length, 2);
  assert.equal(indexed.reduce((sum, log) => sum + log.amount, 0n), 5000000n);
});
test('preserves matching hashes on distinct chains', () => {
  assert.equal(indexTransfers([transfer, { ...transfer, chainId: 8453 }]).length, 2);
});
test('normalizes transaction-hash casing', () => {
  assert.equal(indexTransfers([transfer, { ...transfer, transactionHash: transfer.transactionHash.toUpperCase() }]).length, 1);
});
