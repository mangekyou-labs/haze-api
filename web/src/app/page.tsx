import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-xl w-full space-y-8 text-center">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">ZK API Credits</h1>
          <p className="mt-3 text-lg text-gray-600">
            Anonymous RLN-rate-limited API credits for coding agents on Stellar.
          </p>
        </div>

        <div className="space-y-4 text-left text-sm text-gray-600">
          <div className="p-4 border rounded-lg">
            <h2 className="font-semibold text-gray-900">How It Works</h2>
            <ol className="mt-2 space-y-2 list-decimal list-inside">
              <li>Sign in with GitHub and buy credits via Stripe</li>
              <li>Your browser generates a secret key (never leaves your device)</li>
              <li>Call LLMs through the gateway with ZK proofs</li>
              <li>The gateway cannot link your calls to your deposit</li>
            </ol>
          </div>

          <div className="p-4 border rounded-lg">
            <h2 className="font-semibold text-gray-900">Privacy</h2>
            <p className="mt-1">
              ZK-RLN proofs verified on-chain via Stellar&apos;s native BLS12-381 (CAP-0059).
              The gateway sees your proof but cannot determine which deposit funded your call.
            </p>
          </div>

          <div className="p-4 border rounded-lg">
            <h2 className="font-semibold text-gray-900">Rate Limiting</h2>
            <p className="mt-1">
              100 calls/day (configurable). Over-quota double-spend triggers a slash:
              50% to protocol treasury, 50% to the reporter.
            </p>
          </div>
        </div>

        <div className="flex justify-center gap-4">
          <Link
            href="/sign-in"
            className="px-6 py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors font-medium"
          >
            Get Started
          </Link>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 border rounded-lg hover:bg-gray-50 transition-colors font-medium"
          >
            GitHub
          </a>
        </div>

        <p className="text-xs text-gray-400">
          Stellar testnet &middot; USDC testnet &middot; OpenRouter (400+ models)
        </p>
      </div>
    </main>
  );
}
