import { expect, test } from '@playwright/test';

// Landing page: styled, branded, and honest about its caveats.
// The pre-existing smoke.spec.ts keeps guarding the core value-prop hooks.

test('landing renders styled (Tailwind active), not raw unstyled HTML', async ({
  page,
}) => {
  await page.goto('/');

  const h1 = page.getByRole('heading', { name: 'ZK API Credits', exact: true });
  await expect(h1).toBeVisible();

  // Tailwind loaded: the hero heading must be set larger than the browser
  // default h1 (2em = 32px) and the page must not be a plain white document.
  const fontSize = await h1.evaluate(
    (el) => parseFloat(getComputedStyle(el).fontSize),
  );
  expect(fontSize).toBeGreaterThanOrEqual(36);

  const bodyBg = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  expect(bodyBg).not.toBe('rgb(255, 255, 255)');
});

test('landing has a site header and an honest-caveats footer covering all 9 caveats', async ({
  page,
}) => {
  await page.goto('/');

  const header = page.getByTestId('site-header');
  await expect(header).toBeVisible();
  await expect(
    header.getByRole('link', { name: 'Sign in' })
  ).toBeVisible();

  const footer = page.getByTestId('site-footer');
  await expect(footer).toBeVisible();
  await expect(footer).toContainText(/testnet only/i);
  await expect(footer).toContainText(/100-ticket/i);
  await expect(footer).toContainText(/variable-cost/i);
  await expect(footer).toContainText(/single-contributor.*trusted setup/i);
  await expect(footer).toContainText(/gateway-mediated withdrawal/i);
  await expect(footer).toContainText(/async.*on-chain audit|async per-call/i);
  await expect(footer).toContainText(/timing patterns/i);
  await expect(footer).toContainText(/browser proving/i);
  await expect(footer).toContainText(/network identity/i);
});

test('landing copy describes GitHub sign-in, browser secret identity, and testnet funding', async ({
  page,
}) => {
  await page.goto('/');

  const main = page.locator('main');
  await expect(main).not.toContainText('100 calls/day');
  await expect(main).toContainText(/Sign in/i);

  // Confirms identity path is browser secret + mnemonic / testnet funding
  await expect(main).toContainText(/browser secret|recovery phrase|mnemonic/i);
  await expect(main).toContainText(/100 tickets|100-ticket|Starter/i);

  // Confirms public deployment info
  await expect(main).toContainText('https://zk-credits-gateway.onrender.com');
  await expect(main).toContainText('CBDGHYF5CQM527IM3GVDDWXLDB4XNPA5BT4KXFVCSJZTQIOFZGOIHAIT');
});
