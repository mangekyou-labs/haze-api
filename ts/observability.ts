import * as Sentry from '@sentry/node';

const SENSITIVE_KEY = /(authorization|cookie|prompt|request|body|secret|mnemonic|proof|commitment|signature|wallet|api.?key|password|private.?key|token|subject|identity)/i;

type UnknownRecord = Record<string, unknown>;

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

/** Remove private request material before an event reaches Sentry. */
export function scrubSentryEvent<T extends UnknownRecord>(event: T): T {
  return scrubValue(event, undefined, 0) as T;
}

export function initGatewaySentry(): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
    release: process.env.SENTRY_RELEASE || process.env.RELEASE_SHA,
    sendDefaultPii: false,
    includeLocalVariables: false,
    maxBreadcrumbs: 0,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      return scrubSentryEvent(event as unknown as UnknownRecord) as unknown as typeof event;
    },
  });
  return true;
}

export function captureGatewayException(error: unknown, tags: Record<string, string> = {}): void {
  Sentry.captureException(error, { tags });
}
