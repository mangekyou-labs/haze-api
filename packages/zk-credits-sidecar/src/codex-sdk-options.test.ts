import { describe, it, expect } from 'vitest';
import {
  buildCodexSdkOptions,
  buildCodexThreadOptions,
} from './codex-sdk-options.js';

describe('Codex SDK options builder', () => {
  it('builds Codex SDK constructor options with isolated CODEX_HOME and loopback URL', () => {
    const options = buildCodexSdkOptions({
      loopbackBaseUrl: 'http://127.0.0.1:3210',
      token: 'zk-test-token-12345',
      codexHome: '/tmp/test-codex-home',
    });

    expect(options.baseUrl).toBe('http://127.0.0.1:3210/v1');
    expect(options.apiKey).toBe('zk-test-token-12345');
    expect(options.env).toBeDefined();
    expect(options.env?.CODEX_HOME).toBe('/tmp/test-codex-home');
  });

  it('builds thread options with default model, read-only sandbox, and skipped git check', () => {
    const threadOptions = buildCodexThreadOptions({
      workingDirectory: '/tmp/workspace',
    });

    expect(threadOptions.model).toBe('openai/gpt-4o-mini');
    expect(threadOptions.sandboxMode).toBe('read-only');
    expect(threadOptions.skipGitRepoCheck).toBe(true);
    expect(threadOptions.approvalPolicy).toBe('never');
    expect(threadOptions.workingDirectory).toBe('/tmp/workspace');
  });

  it('allows overriding model in thread options', () => {
    const threadOptions = buildCodexThreadOptions({
      model: 'openai/gpt-4o',
    });

    expect(threadOptions.model).toBe('openai/gpt-4o');
  });

  it('rejects non-loopback or insecure URLs to prevent bearer leakage', () => {
    expect(() =>
      buildCodexSdkOptions({
        loopbackBaseUrl: 'https://remote-attacker.com:3210',
        token: 'secret-token',
        codexHome: '/tmp/codex',
      }),
    ).toThrow('Codex SDK provider must use a 127.0.0.1 HTTP sidecar URL with an explicit port');

    expect(() =>
      buildCodexSdkOptions({
        loopbackBaseUrl: 'http://localhost:3210',
        token: 'secret-token',
        codexHome: '/tmp/codex',
      }),
    ).toThrow('Codex SDK provider must use a 127.0.0.1 HTTP sidecar URL with an explicit port');

    expect(() =>
      buildCodexSdkOptions({
        loopbackBaseUrl: 'http://127.0.0.1',
        token: 'secret-token',
        codexHome: '/tmp/codex',
      }),
    ).toThrow('Codex SDK provider must use a 127.0.0.1 HTTP sidecar URL with an explicit port');
  });
});
