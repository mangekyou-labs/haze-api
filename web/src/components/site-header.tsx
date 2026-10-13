import Link from 'next/link';
import { renderSession } from '@/lib/session';

export async function SiteHeader() {
  const session = await renderSession();

  return (
    <header
      data-testid="site-header"
      className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur"
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 font-semibold tracking-tight text-zinc-100"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400 font-mono text-sm font-bold text-white">
            H
          </span>
          Haze Credits
        </Link>

        <nav className="flex items-center gap-5 text-sm">
          {session?.user?.id ? (
            <Link
              href="/dashboard"
              className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white transition-colors hover:bg-indigo-500"
            >
              Dashboard
            </Link>
          ) : (
            <Link
              href="/sign-in"
              className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white transition-colors hover:bg-indigo-500"
            >
              Get Started
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
