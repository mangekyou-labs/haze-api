import type { NextAuthConfig } from 'next-auth';

const githubAccountIdPattern = /^\d+$/;

export function applySessionIdentity(
  user: { id?: string; githubAccountId?: string },
  token: { sub?: string; githubAccountId?: string },
): void {
  if (token.sub) {
    user.id = token.sub;
  }

  if (typeof token.githubAccountId === 'string' && githubAccountIdPattern.test(token.githubAccountId)) {
    user.githubAccountId = token.githubAccountId;
  } else {
    delete user.githubAccountId;
  }
}

export const authCallbacks = {
  jwt({ token, account }) {
    if (account) {
      if (account.provider === 'github' && githubAccountIdPattern.test(account.providerAccountId)) {
        token.githubAccountId = account.providerAccountId;
      } else {
        delete token.githubAccountId;
      }
    }

    return token;
  },
  session({ session, token }) {
    applySessionIdentity(session.user, token);
    return session;
  },
} satisfies NonNullable<NextAuthConfig['callbacks']>;
