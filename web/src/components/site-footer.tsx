export function SiteFooter() {
  return (
    <footer
      data-testid="site-footer"
      className="border-t border-zinc-800/80 py-8"
    >
      <div className="mx-auto max-w-6xl space-y-2 px-6 text-xs leading-relaxed text-zinc-500">
        <p>
          Stellar testnet &middot; USDC testnet &middot; OpenRouter (400+
          models) &mdash; testnet only, no real money.
        </p>
        <p>
          Honest caveats: single-contributor dev-only trusted setup; one
          gateway operator can observe call timing patterns; browser proving
          adds latency; your network identity is not hidden.
        </p>
      </div>
    </footer>
  );
}
