import { signIn } from '@/auth';
import { renderSession } from '@/lib/session';
import { AuthError } from 'next-auth';
import { SignInSubmit } from './submit-button';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const session = await renderSession();

  if (session?.user?.id) {
    redirect('/dashboard');
  }

  const { error } = await searchParams;
  const errorMessage = error === 'AccessDenied'
    ? 'GitHub sign-in was cancelled or access was denied. Try again when you are ready.'
    : error === 'InvalidCheck' || error === 'OAuthCallbackError' || error === 'OAuthCallback'
      ? 'Your GitHub sign-in session expired or could not be verified. Start sign-in again.'
      : error ? 'GitHub sign-in could not finish. Try again in a moment or restore your credential below.' : null;

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
            Sign in with GitHub to set up your credits.
          </p>

          {errorMessage && <p role="alert" className="mt-4 rounded-lg border border-amber-300/30 bg-amber-300/5 p-3 text-sm text-amber-200">{errorMessage}</p>}
          <p className="mt-3 text-xs leading-5 text-zinc-400">GitHub identifies your billing account. Haze links this account and Stripe test payments to bundle funding history. Credential secrets stay on your device; your billing identity is visible to Haze and Stripe.</p>

          <form
            className="mt-8"
            action={async () => {
              'use server';
              try {
                await signIn('github', { redirectTo: '/dashboard' });
              } catch (error) {
                if (error instanceof AuthError) redirect('/sign-in?error=OAuthSignin');
                throw error; // Preserve Auth.js / Next.js successful redirects.
              }
            }}
          >
            <SignInSubmit configured={oauthConfigured} />
          </form>

          {!oauthConfigured && (
            <p className="mt-3 text-xs text-amber-400/90">
              GitHub sign-in is unavailable. Try again later or restore your credential below.
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
            Already have a credential?{' '}
            <Link
              href="/recover"
              className="text-indigo-400 transition-colors hover:text-indigo-300"
            >
              Restore your credential
            </Link>
          </p>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
