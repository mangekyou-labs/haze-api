export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  } else {
    await import('./sentry.server.config');
  }
}
