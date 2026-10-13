'use client';

import { useFormStatus } from 'react-dom';

export function SignInSubmit({ configured }: { configured: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={!configured || pending} aria-busy={pending}
    className="flex min-h-11 w-full items-center justify-center rounded-xl bg-zinc-100 px-6 py-3 font-medium text-zinc-900 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50">
    {pending ? 'Connecting to GitHub…' : 'Sign in with GitHub'}
  </button>;
}
