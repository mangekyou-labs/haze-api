import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from './src/lib/sentry-scrub';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
  release: process.env.NEXT_PUBLIC_RELEASE_SHA,
  sendDefaultPii: false,
  includeLocalVariables: false,
  maxBreadcrumbs: 0,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  beforeSend(event) {
    return scrubSentryEvent(event as unknown as Record<string, unknown>) as unknown as typeof event;
  },
});
