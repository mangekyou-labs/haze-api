import type { CodexOptions, ThreadOptions } from '@openai/codex-sdk';
import { DEFAULT_CODEX_MODEL } from './codex-profile.js';

export interface BuildCodexSdkOptionsInput {
  loopbackBaseUrl: string;
  token: string;
  codexHome: string;
  env?: Record<string, string>;
}

export interface BuildCodexThreadOptionsInput {
  model?: string;
  workingDirectory?: string;
}

export function buildCodexSdkOptions(
  input: BuildCodexSdkOptionsInput,
): CodexOptions {
  let url: URL;
  try {
    url = new URL(input.loopbackBaseUrl);
  } catch {
    throw new Error('Codex SDK provider must use a 127.0.0.1 HTTP sidecar URL with an explicit port');
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) {
    throw new Error('Codex SDK provider must use a 127.0.0.1 HTTP sidecar URL with an explicit port');
  }
  const baseUrl = `${url.origin}/v1`;
  return {
    baseUrl,
    apiKey: input.token,
    env: {
      ...(input.env ?? process.env),
      CODEX_HOME: input.codexHome,
      OPENAI_BASE_URL: baseUrl,
      OPENAI_API_KEY: input.token,
    },
  };
}

export function buildCodexThreadOptions(
  input?: BuildCodexThreadOptionsInput,
): ThreadOptions {
  return {
    model: input?.model ?? DEFAULT_CODEX_MODEL,
    sandboxMode: 'read-only',
    skipGitRepoCheck: true,
    approvalPolicy: 'never',
    ...(input?.workingDirectory ? { workingDirectory: input.workingDirectory } : {}),
  };
}
