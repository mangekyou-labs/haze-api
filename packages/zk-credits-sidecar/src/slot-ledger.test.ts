import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BaseSlotLedger } from './slot-ledger.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function ledgerPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'zk-credits-ledger-'));
  temporaryDirectories.push(directory);
  return join(directory, 'nested', 'base-slots.json');
}

describe('durable local slot ledger', () => {
  it('keeps a slot provisional until commit and persists only committed slots', async () => {
    const path = await ledgerPath();
    const ledger = await BaseSlotLedger.open({ path });
    const first = ledger.allocateProvisional();
    expect(first).toBe(0);
    expect(ledger.committedSlots()).toEqual([]);

    await ledger.commit(first);
    expect(ledger.committedSlots()).toEqual([0]);
    const stored = JSON.parse(await readFile(path, 'utf8')) as { version: number; capacity: number; committed: number[] };
    expect(stored).toEqual({ version: 1, capacity: 250, committed: [0], updatedAt: expect.any(Number) });

    const reopened = await BaseSlotLedger.open({ path });
    expect(reopened.committedSlots()).toEqual([0]);
    expect(reopened.allocateProvisional()).toBe(1);
  });

  it('leaves a slot reusable after a failed proof attempt', async () => {
    const path = await ledgerPath();
    const ledger = await BaseSlotLedger.open({ path });
    const slot = ledger.allocateProvisional();
    ledger.release(slot);
    expect(ledger.snapshot()).toMatchObject({ committed: 0, provisional: 0 });

    const committed = ledger.allocateProvisional();
    expect(committed).toBe(0);
    await ledger.commit(committed);
    expect(ledger.committedSlots()).toEqual([0]);
    expect(ledger.allocateProvisional()).toBe(1);
  });

  it('never hands the same provisional slot to two in-flight attempts', async () => {
    const ledger = await BaseSlotLedger.open({});
    const slots = new Set<number>();
    for (let index = 0; index < 250; index += 1) slots.add(ledger.allocateProvisional());
    expect(slots.size).toBe(250);
    expect(() => ledger.allocateProvisional()).toThrow('slot_ledger_exhausted');
    ledger.release(17);
    expect(ledger.allocateProvisional()).toBe(17);
  });

  it('refuses to commit a slot that was never allocated and rejects malformed state', async () => {
    const path = await ledgerPath();
    const ledger = await BaseSlotLedger.open({ path });
    await expect(ledger.commit(3)).rejects.toThrow('not provisionally allocated');
    ledger.release(3);
    expect(ledger.committedSlots()).toEqual([]);
  });

  it('bounds capacity to the funded slot allowance', async () => {
    await expect(BaseSlotLedger.open({ capacity: 251 })).rejects.toThrow('capacity');
    const ledger = await BaseSlotLedger.open({ capacity: 2 });
    expect(ledger.allocateProvisional()).toBe(0);
    expect(ledger.allocateProvisional()).toBe(1);
    expect(() => ledger.allocateProvisional()).toThrow('slot_ledger_exhausted');
  });
});
