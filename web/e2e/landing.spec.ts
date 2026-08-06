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

test('landing has a site header and an honest-caveats footer', async ({
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
  await expect(footer).toContainText(/testnet/i);
  await expect(footer).toContainText(/trusted setup/i);
  await expect(footer).toContainText(/no real money/i);
});
