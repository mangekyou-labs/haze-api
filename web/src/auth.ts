import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import Credentials from 'next-auth/providers/credentials';

const hasGithubOAuth = process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET;

const providers = [];

if (hasGithubOAuth) {
  providers.push(
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  );
} else {
  // Dev-mode fallback: credentials provider that auto-signs in as test user
  console.warn(
    '⚠️  GITHUB_CLIENT_ID not set — using dev credentials provider. NOT for production.',
  );
  providers.push(
    Credentials({
      name: 'Dev Login',
      credentials: {},
      async authorize() {
        return {
          id: 'dev-user-123',
          name: 'Dev User',
          email: 'dev@test.local',
        };
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
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

export const isDevMode = !hasGithubOAuth;
