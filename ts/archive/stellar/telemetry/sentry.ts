import * as Sentry from '@sentry/node';
import { scrubSentryEvent } from './sentry-scrub.js';

export function initGatewaySentry(env: NodeJS.ProcessEnv = process.env): void {
  const dsn = env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV || 'production',
    release: env.SENTRY_RELEASE || env.RELEASE_SHA,
    enabled: true,
    sendDefaultPii: false,
    maxBreadcrumbs: 0,
    tracesSampleRate: 0,
    beforeSend(event) {
      return scrubSentryEvent(event as unknown as Record<string, unknown>) as unknown as typeof event;
    },
  });
}
