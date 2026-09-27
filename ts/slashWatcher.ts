import { rpc as SorobanRpc, scValToNative } from '@stellar/stellar-sdk';

export interface EventSource {
  getEvents: SorobanRpc.Server['getEvents'];
}

export interface NullifierCollision {
  nullifier: string;
  firstEventId: string;
  secondEventId: string;
  firstLedger: number;
  secondLedger: number;
}

export interface SlashWatcherOptions {
  contractId: string;
  startLedger: number;
  eventSource: EventSource;
  onCollision?: (collision: NullifierCollision) => void | Promise<void>;
  limit?: number;
}

type SpentEvent = {
  id: string;
  ledger: number;
};

function isNullifierSpentEvent(event: Awaited<ReturnType<EventSource['getEvents']>>['events'][number]) {
  if (event.type !== 'contract' || event.inSuccessfulContractCall !== true) return null;

  const topic = event.topic?.[0] ? scValToNative(event.topic[0]) : null;
  if (topic !== 'NullifierSpent') return null;

  const data = scValToNative(event.value);
  if (!Array.isArray(data) || data.length < 1) return null;

  return {
    id: event.id,
    ledger: event.ledger,
    nullifier: BigInt(data[0]).toString(),
  };
}

export class SlashWatcher {
  private cursor: string | undefined;
  private readonly seenEvents = new Set<string>();
  private readonly spentByNullifier = new Map<string, SpentEvent>();
  private readonly options: SlashWatcherOptions;

  constructor(options: SlashWatcherOptions) {
    this.options = options;
  }

  async pollOnce(): Promise<NullifierCollision[]> {
    const request = this.cursor
      ? {
          filters: [{ type: 'contract' as const, contractIds: [this.options.contractId] }],
          cursor: this.cursor,
          limit: this.options.limit ?? 100,
        }
      : {
          filters: [{ type: 'contract' as const, contractIds: [this.options.contractId] }],
          startLedger: this.options.startLedger,
          limit: this.options.limit ?? 100,
        };

    const response = await this.options.eventSource.getEvents(request);
    this.cursor = response.cursor || undefined;
    const collisions: NullifierCollision[] = [];

    for (const event of response.events) {
      if (this.seenEvents.has(event.id)) continue;
      this.seenEvents.add(event.id);

      const spent = isNullifierSpentEvent(event);
      if (!spent) continue;

      const previous = this.spentByNullifier.get(spent.nullifier);
      if (previous) {
        const collision: NullifierCollision = {
          nullifier: spent.nullifier,
          firstEventId: previous.id,
          secondEventId: spent.id,
          firstLedger: previous.ledger,
          secondLedger: spent.ledger,
        };
        collisions.push(collision);
        await this.options.onCollision?.(collision);
      } else {
        this.spentByNullifier.set(spent.nullifier, {
          id: spent.id,
          ledger: spent.ledger,
        });
      }
    }

    return collisions;
  }
}
