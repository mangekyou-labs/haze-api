import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

const STEPS = [
  { title: 'Create your credential', body: 'Sign in, activate your credits, and save your recovery file.' },
  { title: 'Connect your client', body: 'Set up Codex, Cline, or your own x402 agent with zk-credits.' },
  { title: 'Start building', body: 'Your client proves each spend locally and sends the request.' },
];

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col">
      <SiteHeader />

      <section className="relative flex-1 overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_40%_at_50%_0%,rgba(99,102,241,0.22),transparent)]"
        />
        <div className="relative mx-auto max-w-6xl px-6 pb-20 pt-24 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-zinc-700/80 bg-zinc-900/80 px-3 py-1 font-mono text-xs text-zinc-300">
            API credits &middot; Base Sepolia
          </span>

          <h1 className="mx-auto mt-6 max-w-3xl text-5xl font-bold tracking-tight text-white sm:text-6xl">
            Haze Credits
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-zinc-400">
            API credits for your coding agent. Prove each spend locally,
            then use Codex, Cline, or your own x402 agent.
          </p>

          <div className="mt-10 flex justify-center gap-4">
            <Link
              href="/sign-in"
              className="rounded-xl bg-indigo-600 px-6 py-3 font-medium text-white shadow-lg shadow-indigo-950/50 transition-colors hover:bg-indigo-500"
            >
              Get Started
            </Link>
          </div>

          <div className="mt-20 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((step, i) => (
              <div
                key={step.title}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5"
              >
                <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/15 font-mono text-sm font-semibold text-indigo-300">
                  {i + 1}
                </div>
                <h2 className="font-semibold text-zinc-100">{step.title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
                  {step.body}
                </p>
              </div>
            ))}
          </div>

          <p className="mx-auto mt-8 max-w-2xl text-sm leading-6 text-zinc-500">
            Your credential stays on your device. The gateway and model provider
            receive your prompts and can observe traffic metadata.
          </p>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
