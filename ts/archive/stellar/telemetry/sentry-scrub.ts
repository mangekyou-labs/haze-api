const FILTERED_VALUE = '[Filtered]';
const MAX_DEPTH = 6;

const SENSITIVE_KEY = /(?:authorization|cookie|request|body|prompt|secret|mnemonic|proof|commitment|signature|wallet|api.?key|password|private.?key|token|subject|identity)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function scrubValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return FILTERED_VALUE;
  if (Array.isArray(value)) return value.map((entry) => scrubValue(entry, depth + 1));
  if (!isRecord(value)) return value;

  const scrubbed: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    scrubbed[key] = SENSITIVE_KEY.test(key)
      ? FILTERED_VALUE
      : scrubValue(entry, depth + 1);
  }
  return scrubbed;
}

export function scrubSentryEvent(event: Record<string, unknown>): Record<string, unknown> {
  return scrubValue(event, 0) as Record<string, unknown>;
}
