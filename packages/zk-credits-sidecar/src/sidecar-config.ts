import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

export interface SidecarStatePaths {
  ledgerPath: string;
  tokenPath: string;
}

export function createLoopbackToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sidecarStatePaths(stateDirectory: string): SidecarStatePaths {
  return {
    ledgerPath: join(stateDirectory, 'tickets.json'),
    tokenPath: join(stateDirectory, 'loopback-token'),
  };
}

/** Shell-safe environment lines for clients with OpenAI-compatible settings. */
export function formatOpenAiEnvironment(loopbackBaseUrl: string, localToken: string): string {
  const url = new URL(loopbackBaseUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !/^[A-Za-z0-9_-]+$/.test(localToken)) {
    throw new Error('Sidecar environment must use a valid 127.0.0.1 URL and local token');
  }
  return [
    `export OPENAI_BASE_URL=${url.origin}/v1`,
    `export OPENAI_API_KEY=${localToken}`,
  ].join('\n');
}
