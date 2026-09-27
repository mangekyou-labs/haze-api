type UnknownRecord = Record<string, unknown>;

const SENSITIVE_KEY = /(authorization|cookie|prompt|request|body|secret|mnemonic|proof|commitment|signature|wallet|api.?key|password|private.?key|token|subject|identity)/i;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scrubValue(value: unknown, key: string | undefined, depth: number): unknown {
  if (key && SENSITIVE_KEY.test(key)) return undefined;
  if (depth > 6) return undefined;
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, undefined, depth + 1)).filter((item) => item !== undefined);
  }
  if (!isRecord(value)) return value;
  const result: UnknownRecord = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const scrubbed = scrubValue(childValue, childKey, depth + 1);
    if (scrubbed !== undefined) result[childKey] = scrubbed;
  }
  return result;
}

export function scrubSentryEvent<T extends UnknownRecord>(event: T): T {
  return scrubValue(event, undefined, 0) as T;
}
