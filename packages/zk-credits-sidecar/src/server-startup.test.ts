import { describe, expect, it, vi } from 'vitest';
import { activateSidecarServer } from './server-startup.js';

describe('sidecar server activation', () => {
  it('publishes the token only after the loopback port is bound', async () => {
    const events: string[] = [];

    await expect(activateSidecarServer({
      listen: async () => {
        events.push('listen');
        return 'http://127.0.0.1:3210';
      },
      publishToken: async () => { events.push('token'); },
    })).resolves.toBe('http://127.0.0.1:3210');

    expect(events).toEqual(['listen', 'token']);
  });

  it('does not replace the active token when binding fails', async () => {
    const publishToken = vi.fn(async () => undefined);

    await expect(activateSidecarServer({
      listen: async () => { throw new Error('address already in use'); },
      publishToken,
    })).rejects.toThrow('address already in use');

    expect(publishToken).not.toHaveBeenCalled();
  });
});
