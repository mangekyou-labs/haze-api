import { auth, signIn, signOut } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export default async function SignInPage() {
  const session = await auth();

  if (session) {
    redirect('/dashboard');
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-sm w-full space-y-6 text-center">
        <h1 className="text-3xl font-bold">ZK API Credits</h1>
        <p className="text-gray-600">Anonymous API credits for coding agents</p>
        <form
          action={async () => {
            'use server';
            await signIn('github', { redirectTo: '/dashboard' });
          }}
        >
          <button
            type="submit"
            className="w-full px-6 py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            Sign in with GitHub
          </button>
        </form>
        <p className="text-sm text-gray-500">
          Lost access?{' '}
          <Link href="/recover" className="text-blue-600 hover:underline">
            Recover from mnemonic
          </Link>
        </p>
      </div>
    </main>
  );
}
