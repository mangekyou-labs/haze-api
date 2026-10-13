export function SiteFooter() {
  return (
    <footer data-testid="site-footer" className="border-t border-zinc-800/80 py-6">
      <div className="mx-auto max-w-6xl px-6 text-xs text-zinc-500">
        Haze Credits
        <a href="https://github.com/mangekyou-labs/haze-api" target="_blank" rel="noopener noreferrer" className="ml-3 inline-flex min-h-11 items-center text-zinc-300 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200">Source code</a>
      </div>
    </footer>
  );
}
