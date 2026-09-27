import { describe, expect, it } from 'vitest';
import { applySessionIdentity, authCallbacks } from '@/lib/auth-callbacks';

describe('Auth.js GitHub identity callbacks', () => {
  it('stores GitHub provider identity separately from the application session id', async () => {
    const token = await authCallbacks.jwt({
      token: { sub: 'b73848f4-32e1-49c4-b8d4-fb840b1a81b9' },
      user: { id: 'b73848f4-32e1-49c4-b8d4-fb840b1a81b9' },
      account: { provider: 'github', providerAccountId: '107874128', type: 'oauth' },
    });

    const sessionUser: { id?: string; githubAccountId?: string } = {
      id: 'b73848f4-32e1-49c4-b8d4-fb840b1a81b9',
    };
    applySessionIdentity(sessionUser, token);

    expect(token.sub).toBe('b73848f4-32e1-49c4-b8d4-fb840b1a81b9');
    expect(token.githubAccountId).toBe('107874128');
    expect(sessionUser.id).toBe('b73848f4-32e1-49c4-b8d4-fb840b1a81b9');
    expect(sessionUser.githubAccountId).toBe('107874128');
  });

  it('does not retain a GitHub identity when a different provider signs in', async () => {
    const token = await authCallbacks.jwt({
      token: { sub: 'dev-user', githubAccountId: '107874128' },
      user: { id: 'dev-user' },
      account: { provider: 'dev', providerAccountId: 'dev-user', type: 'credentials' },
    });

    expect(token.githubAccountId).toBeUndefined();
  });
});
