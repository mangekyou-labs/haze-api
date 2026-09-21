import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TicketLedger } from './ticket-ledger.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('TicketLedger', () => {
  it('reuses an exact request reservation and advances for a different request', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zk-credits-sidecar-'));
    temporaryDirectories.push(directory);
    const ledger = new TicketLedger(join(directory, 'tickets.json'), 3);

    const first = await ledger.reserve({ model: 'test', input: 'first' });
    const exactRetry = await ledger.reserve({ input: 'first', model: 'test' });
    const second = await ledger.reserve({ model: 'test', input: 'second' });

    expect(first.index).toBe(0);
    expect(exactRetry).toEqual(first);
    expect(second.index).toBe(1);
  });
});
