import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import Credentials from 'next-auth/providers/credentials';

// Opt-in dev/test-only login (ENABLE_DEV_LOGIN=1). Lets the signed-in flow
// (dashboard, API keys, buy credits) be exercised locally and in Playwright
// without a GitHub OAuth app. Off by default; never enable in production.
const devLoginEnabled = process.env.ENABLE_DEV_LOGIN === '1';

const providers = [
  GitHub({
    clientId: process.env.GITHUB_CLIENT_ID ?? '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
  }),
  ...(devLoginEnabled
    ? [
        Credentials({
          id: 'dev',
          name: 'Dev account',
          credentials: {},
          async authorize() {
            return {
              id: 'dev-user',
              email: 'dev@zkcredits.test',
              name: 'Dev User',
            };
          },
        }),
      ]
    : []),
];

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers,
  session: { strategy: 'jwt' },
  callbacks: {
    session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
  pages: {
    signIn: '/sign-in',
  },
});

