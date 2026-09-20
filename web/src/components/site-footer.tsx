export function SiteFooter() {
  return (
    <footer
      data-testid="site-footer"
      className="border-t border-zinc-800/80 py-8"
    >
      <div className="mx-auto max-w-6xl space-y-2 px-6 text-xs leading-relaxed text-zinc-500">
        <p>
          Base Sepolia &middot; invite-only unpaid pilot &middot; OpenRouter inference
          &mdash; experimental, testnet only.
        </p>
        <p>
          Honest caveats: the custom x402 scheme needs the bundled proxy or
          facilitator; development proving material is for Sepolia; one active
          local proxy per bundle is supported; browser proving adds latency;
          your network identity / IP is not hidden.
        </p>
      </div>
    </footer>
  );
}
