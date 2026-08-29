// Baseline capture: screenshots of every page in the current (broken) state.
// Usage: node scripts/baseline-screenshots.mjs <baseUrl> <outDir>
import { chromium } from '@playwright/test';

const [base, outDir] = [
  process.argv[2] ?? 'http://127.0.0.1:3210',
  process.argv[3] ?? './test-results/baseline',
];

const pages = ['/', '/sign-in', '/onboarding', '/recover', '/dashboard'];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];

for (const path of pages) {
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  const resp = await page.goto(base + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const name = path === '/' ? 'landing' : path.slice(1);
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
  console.log(
    `CAPTURED ${path} status=${resp?.status()} finalUrl=${page.url()} consoleErrors=${consoleErrors.length}`,
  );
  if (consoleErrors.length) {
    for (const e of consoleErrors.slice(0, 3)) errors.push(`${path}: ${e.slice(0, 200)}`);
  }
  page.removeAllListeners('console');
  page.removeAllListeners('pageerror');
}

await browser.close();
console.log('---');
console.log(errors.length ? errors.join('\n') : 'NO_CONSOLE_ERRORS');
