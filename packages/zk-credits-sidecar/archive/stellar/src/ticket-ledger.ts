import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { requestDigestToField } from '@zk-credits/shared';

export type TicketState = 'reserved' | 'consumed';

export interface TicketReservation {
  index: number;
  requestDigest: string;
  state: TicketState;
}

type LedgerFile = { entries: TicketReservation[] };

function parseLedger(raw: string): LedgerFile {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { entries?: unknown }).entries)) {
    throw new Error('Sidecar ticket ledger is malformed');
  }
  const entries = (parsed as { entries: unknown[] }).entries.map((entry) => {
    if (
      !entry || typeof entry !== 'object'
      || !Number.isInteger((entry as { index?: unknown }).index)
      || typeof (entry as { requestDigest?: unknown }).requestDigest !== 'string'
      || !['reserved', 'consumed'].includes((entry as { state?: unknown }).state as string)
    ) {
      throw new Error('Sidecar ticket ledger is malformed');
    }
    return entry as TicketReservation;
  });
  return { entries };
}

/**
 * Durable, serialized local ticket allocation. It never reassigns a ticket
 * after an ambiguous request: only an exact canonical request digest may
 * reuse its prior reservation for gateway idempotency.
 */
export class TicketLedger {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly capacity = 100,
  ) {}

  async reserve(request: unknown): Promise<TicketReservation> {
    const digest = (await requestDigestToField(request)).digest;
    return this.serialized(async () => {
      const ledger = await this.read();
      const existing = ledger.entries.find((entry) => entry.requestDigest === digest);
      if (existing) return { ...existing };

      const used = new Set(ledger.entries.map((entry) => entry.index));
      const index = Array.from({ length: this.capacity }, (_, candidate) => candidate)
        .find((candidate) => !used.has(candidate));
      if (index === undefined) throw new Error('All ZK Credit tickets have been reserved');

      const reservation: TicketReservation = { index, requestDigest: digest, state: 'reserved' };
      ledger.entries.push(reservation);
      await this.write(ledger);
      return reservation;
    });
  }

  async consume(requestDigest: string): Promise<void> {
    await this.serialized(async () => {
      const ledger = await this.read();
      const entry = ledger.entries.find((candidate) => candidate.requestDigest === requestDigest);
      if (!entry) throw new Error('Unknown sidecar ticket reservation');
      entry.state = 'consumed';
      await this.write(ledger);
    });
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release!();
    }
  }

  private async read(): Promise<LedgerFile> {
    try {
      return parseLedger(await readFile(this.filePath, 'utf8'));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { entries: [] };
      throw error;
    }
  }

  private async write(ledger: LedgerFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(ledger), { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}
