// Fee-relay request store tests (M2.4). Memory store is exercised offline;
// Postgres store runs against real Postgres with RUN_DB_TESTS=1.

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryFeeSponsorStore } from './fee-sponsor.js';

function sampleReq(over: Partial<Parameters<MemoryFeeSponsorStore['recordRelayRequestOnce']>[0]> = {}) {
  return {
    innerTxHash: 'tx-hash-1',
    method: 'slash' as const,
    contractId: 'C-zkcredits',
    innerTxXdr: 'AAAA...',
    ...over,
  };
}

describe('MemoryFeeSponsorStore (fee-relay idempotency contract)', () => {
  let store: MemoryFeeSponsorStore;

  beforeEach(() => {
    store = new MemoryFeeSponsorStore();
  });

  it('records a first-time relay request', async () => {
    const { inserted, request } = await store.recordRelayRequestOnce(sampleReq());
    expect(inserted).toBe(true);
    expect(request.status).toBe('received');
    expect(request.method).toBe('slash');
  });

  it('returns the existing request on a duplicate inner tx hash (idempotent)', async () => {
    await store.recordRelayRequestOnce(sampleReq());
    await store.markSubmitted('tx-hash-1', 'fee-bump-1');
    const retry = await store.recordRelayRequestOnce(sampleReq());
    expect(retry.inserted).toBe(false);
    expect(retry.request.status).toBe('submitted'); // prior result preserved
    expect(retry.request.feeBumpHash).toBe('fee-bump-1');
  });

  it('transitions via markSubmitted and markFailed', async () => {
    await store.recordRelayRequestOnce(sampleReq());
    await store.markFailed('tx-hash-1');
    expect((await store.getRequest('tx-hash-1'))?.status).toBe('failed');
    await store.markSubmitted('tx-hash-1', 'fee-bump-2');
    const done = await store.getRequest('tx-hash-1');
    expect(done?.status).toBe('submitted');
    expect(done?.submittedAt).toBeTruthy();
  });

  it('lists requests in insertion order', async () => {
    await store.recordRelayRequestOnce(sampleReq({ innerTxHash: 'a' }));
    await store.recordRelayRequestOnce(sampleReq({ innerTxHash: 'b', method: 'withdraw' }));
    const list = await store.listRequests();
    expect(list.map((r) => r.innerTxHash)).toEqual(['a', 'b']);
  });
});