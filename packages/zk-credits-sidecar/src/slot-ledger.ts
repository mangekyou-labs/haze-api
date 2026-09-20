/**
 * Durable local slot ledger for the Base pilot credential.
 *
 * A slot is unique only through its nullifier, so a slot whose payment never
 * reached the gateway may be reused. The ledger therefore separates the
 * provisional claim made before a prove from the committed record written
 * immediately after local self-verification and before PAYMENT-SIGNATURE can
 * be emitted. Proof misses, timeouts, hash failures, and verification failures
 * release the provisional claim and leave the slot reusable; only a payment
 * that can actually carry a valid proof burns a slot locally.
 *
 * The durable file holds slot numbers only. It never holds secrets, witnesses,
 * nullifiers, request signals, or credentials.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { FUNDED_SLOT_ALLOWANCE } from '@zk-credits/shared/base';

export interface BaseSlotLedgerOptions {
  /** Durable state file. Omit for an in-memory ledger used by focused tests. */
  path?: string;
  capacity?: number;
  now?: () => number;
}

export interface BaseSlotLedgerSnapshot {
  capacity: number;
  committed: number;
  provisional: number;
}

interface SlotLedgerFile {
  version: 1;
  capacity: number;
  committed: number[];
  updatedAt: number;
}

const LEDGER_VERSION = 1;

function validCapacity(value: number | undefined): number {
  if (value === undefined) return FUNDED_SLOT_ALLOWANCE;
  if (!Number.isSafeInteger(value) || value <= 0 || value > FUNDED_SLOT_ALLOWANCE) {
    throw new Error(`Slot ledger capacity must be an integer in [1, ${FUNDED_SLOT_ALLOWANCE}]`);
  }
  return value;
}

function validSlot(value: unknown, capacity: number): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value >= capacity) return undefined;
  return value;
}

/** Tracks committed slots and in-flight provisional allocations. */
export class BaseSlotLedger {
  private readonly capacity: number;
  private readonly path?: string;
  private readonly now: () => number;
  private readonly committed = new Set<number>();
  private readonly provisional = new Set<number>();
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(options: BaseSlotLedgerOptions) {
    this.capacity = validCapacity(options.capacity);
    this.path = options.path;
    this.now = options.now ?? Date.now;
  }

  /** Opens the ledger and restores every committed slot, or starts empty. */
  static async open(options: BaseSlotLedgerOptions = {}): Promise<BaseSlotLedger> {
    const ledger = new BaseSlotLedger(options);
    if (!ledger.path) return ledger;
    let raw: string;
    try {
      raw = await readFile(ledger.path, 'utf8');
    } catch {
      return ledger;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new Error('Slot ledger is not valid JSON');
    }
    const record = parsed as Partial<SlotLedgerFile>;
    if (
      !record
      || record.version !== LEDGER_VERSION
      || record.capacity !== ledger.capacity
      || !Array.isArray(record.committed)
    ) {
      throw new Error('Slot ledger is malformed or belongs to another capacity');
    }
    for (const value of record.committed) {
      const slot = validSlot(value, ledger.capacity);
      if (slot === undefined) throw new Error('Slot ledger contains an out-of-range slot');
      ledger.committed.add(slot);
    }
    return ledger;
  }

  /** Claims the lowest reusable slot until the caller commits or releases it. */
  allocateProvisional(): number {
    for (let slot = 0; slot < this.capacity; slot += 1) {
      if (this.committed.has(slot) || this.provisional.has(slot)) continue;
      this.provisional.add(slot);
      return slot;
    }
    throw new Error('slot_ledger_exhausted');
  }

  /** Durable record taken after self-verification and before the payment leaves. */
  async commit(slot: number): Promise<void> {
    if (!Number.isSafeInteger(slot) || slot < 0 || slot >= this.capacity) throw new Error('Invalid slot');
    if (!this.provisional.has(slot) && !this.committed.has(slot)) {
      throw new Error('Slot is not provisionally allocated');
    }
    this.provisional.delete(slot);
    this.committed.add(slot);
    try {
      await this.persist();
    } catch (error) {
      // A failed durable write must leave the slot provisional, never silently
      // reusable while the record is missing.
      this.committed.delete(slot);
      this.provisional.add(slot);
      throw error;
    }
  }

  /** Returns a provisional slot when no payment was produced. */
  release(slot: number): void {
    if (this.committed.has(slot)) return;
    this.provisional.delete(slot);
  }

  committedSlots(): number[] {
    return [...this.committed].sort((left, right) => left - right);
  }

  snapshot(): BaseSlotLedgerSnapshot {
    return {
      capacity: this.capacity,
      committed: this.committed.size,
      provisional: this.provisional.size,
    };
  }

  private persist(): Promise<void> {
    const write = async (): Promise<void> => {
      if (!this.path) return;
      const record: SlotLedgerFile = {
        version: LEDGER_VERSION,
        capacity: this.capacity,
        committed: this.committedSlots(),
        updatedAt: this.now(),
      };
      await mkdir(dirname(this.path!), { recursive: true });
      const temporary = `${this.path!}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600 });
      await rename(temporary, this.path!);
    };
    const next = this.writeChain.then(write, write);
    this.writeChain = next.catch(() => undefined);
    return next;
  }
}
