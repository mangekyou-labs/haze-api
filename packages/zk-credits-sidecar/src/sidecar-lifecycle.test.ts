import { describe, expect, it, vi } from 'vitest';
import { ensureSidecarReady } from './sidecar-lifecycle.js';

describe('sidecar lifecycle', () => {
  it('reuses a healthy sidecar without spawning another process', async () => {
    const startDetached = vi.fn(async () => undefined);
    const readToken = vi.fn(async () => 'active-token');

    await expect(ensureSidecarReady({
      isHealthy: async () => true,
      startDetached,
      readToken,
      wait: async () => undefined,
      logPath: '/tmp/zk-credits-sidecar.log',
    })).resolves.toBe('active-token');

    expect(startDetached).not.toHaveBeenCalled();
    expect(readToken).toHaveBeenCalledOnce();
  });

  it('starts once and waits until the sidecar is healthy before reading its token', async () => {
    const healthStates = [false, false, true];
    const startDetached = vi.fn(async () => undefined);
    const readToken = vi.fn(async () => 'new-token');
    const wait = vi.fn(async () => undefined);

    await expect(ensureSidecarReady({
      isHealthy: async () => healthStates.shift() ?? true,
      startDetached,
      readToken,
      wait,
      logPath: '/tmp/zk-credits-sidecar.log',
    }, { attempts: 3, intervalMs: 1 })).resolves.toBe('new-token');

    expect(startDetached).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledTimes(2);
    expect(readToken).toHaveBeenCalledOnce();
  });

  it('fails after bounded readiness checks and points to the sidecar log', async () => {
    const readToken = vi.fn(async () => 'must-not-be-read');

    await expect(ensureSidecarReady({
      isHealthy: async () => false,
      startDetached: async () => undefined,
      readToken,
      wait: async () => undefined,
      logPath: '/private/state/sidecar.log',
    }, { attempts: 2, intervalMs: 1 })).rejects.toThrow(
      'ZK Credits sidecar did not become ready; inspect /private/state/sidecar.log',
    );

    expect(readToken).not.toHaveBeenCalled();
  });
});
