import { auth, signIn } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

export default async function SignInPage() {
  const session = await auth();

  if (session) {
    redirect('/dashboard');
  }

  const oauthConfigured = Boolean(
    process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET,
  );
  const devLoginEnabled = process.env.ENABLE_DEV_LOGIN === '1';

  return (
    <main className="flex min-h-screen flex-col">
      <SiteHeader />

      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center shadow-2xl shadow-black/40">
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Sign in
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Anonymous API credits for coding agents on Stellar.
          </p>

          <form
            className="mt-8"
            action={async () => {
              'use server';
              await signIn('github', { redirectTo: '/dashboard' });
            }}
          >
            <button
              type="submit"
              disabled={!oauthConfigured}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-100 px-6 py-3 font-medium text-zinc-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg viewBox="0 0 16 16" aria-hidden className="h-5 w-5 fill-current">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
              Sign in with GitHub
            </button>
          </form>

          {!oauthConfigured && (
            <p className="mt-3 text-xs text-amber-400/90">
              GitHub OAuth is not configured on this deployment
              (GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET missing). Mnemonic
              recovery below always works.
            </p>
          )}

          {devLoginEnabled && (
            <form
              className="mt-4"
              action={async () => {
                'use server';
                await signIn('dev', { redirectTo: '/dashboard' });
              }}
            >
              <button
                type="submit"
                className="w-full rounded-xl border border-zinc-700 px-6 py-3 font-medium text-zinc-200 transition-colors hover:bg-zinc-800/60"
              >
                Continue with dev account (test-only)
              </button>
            </form>
          )}

          <p className="mt-6 text-sm text-zinc-500">
            Lost access?{' '}
            <Link
              href="/recover"
              className="text-indigo-400 transition-colors hover:text-indigo-300"
            >
              Recover from mnemonic
            </Link>
          </p>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}

