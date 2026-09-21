export const STARTER_TICKET_COUNT = 100;
const DB_NAME = 'zk-credits-crypto';
const DB_VERSION = 1;
const STORE_NAME = 'keys';
const STATE_KEY = 'ticket_state';

export interface TicketState {
  nextIndex: number;
  reserved: number[];
  consumed: number[];
  skipped: number[];
}

export function initialTicketState(): TicketState {
  return { nextIndex: 0, reserved: [], consumed: [], skipped: [] };
}

function copyState(state: TicketState): TicketState {
  return {
    nextIndex: state.nextIndex,
    reserved: [...state.reserved],
    consumed: [...state.consumed],
    skipped: [...state.skipped],
  };
}

export function reserveNextTicketFromState(state: TicketState): { index: number; state: TicketState } {
  const next = copyState(state);
  if (next.nextIndex >= STARTER_TICKET_COUNT) throw new Error('No Starter tickets remain');

  const index = next.nextIndex;
  next.nextIndex += 1;
  next.reserved.push(index);
  return { index, state: next };
}

export function markTicketConsumed(state: TicketState, index: number): TicketState {
  const next = copyState(state);
  next.reserved = next.reserved.filter((candidate) => candidate !== index);
  if (!next.consumed.includes(index)) next.consumed.push(index);
  next.consumed.sort((a, b) => a - b);
  return next;
}

export function markTicketSkipped(state: TicketState, index: number): TicketState {
  const next = copyState(state);
  next.reserved = next.reserved.filter((candidate) => candidate !== index);
  if (!next.skipped.includes(index)) next.skipped.push(index);
  next.skipped.sort((a, b) => a - b);
  return next;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
  });
}

function readState(value: unknown): TicketState {
  if (!value || typeof value !== 'object') return initialTicketState();
  const candidate = value as Partial<TicketState>;
  const list = (items: unknown): number[] =>
    Array.isArray(items) ? items.filter((item): item is number => Number.isInteger(item)) : [];
  return {
    nextIndex: typeof candidate.nextIndex === 'number' ? candidate.nextIndex : 0,
    reserved: list(candidate.reserved),
    consumed: list(candidate.consumed),
    skipped: list(candidate.skipped),
  };
}

export class TicketLedger {
  private readonly database: Promise<IDBDatabase>;

  constructor() {
    this.database = openDb();
  }

  async getState(): Promise<TicketState> {
    const db = await this.database;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(STATE_KEY);
      request.onsuccess = () => resolve(readState(request.result));
      request.onerror = () => reject(request.error ?? new Error('Could not read ticket state'));
    });
  }

  private async update(mutator: (state: TicketState) => TicketState): Promise<TicketState> {
    const db = await this.database;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      let updated = initialTicketState();
      const request = store.get(STATE_KEY);
      request.onsuccess = () => {
        try {
          updated = mutator(readState(request.result));
          store.put(updated, STATE_KEY);
        } catch (error) {
          tx.abort();
          reject(error);
        }
      };
      request.onerror = () => reject(request.error ?? new Error('Could not reserve ticket'));
      tx.oncomplete = () => resolve(updated);
      tx.onerror = () => reject(tx.error ?? new Error('Could not update ticket state'));
    });
  }

  async reserveNext(): Promise<{ index: number; state: TicketState }> {
    let index = -1;
    const state = await this.update((current) => {
      const reserved = reserveNextTicketFromState(current);
      index = reserved.index;
      return reserved.state;
    });
    return { index, state };
  }

  async consume(index: number): Promise<TicketState> {
    return this.update((state) => markTicketConsumed(state, index));
  }

  async skip(index: number): Promise<TicketState> {
    return this.update((state) => markTicketSkipped(state, index));
  }
}
