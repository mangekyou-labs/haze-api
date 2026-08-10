import { expect, test } from '@playwright/test';

// Dev login (ENABLE_DEV_LOGIN=1, set by the Playwright webServer) makes the
// signed-in flow testable without a GitHub OAuth app.

test('dev login reaches the dashboard and renders all sections', async ({
  page,
}) => {
  await page.goto('/sign-in');
  await page
    .getByRole('button', { name: /Continue with dev account/ })
    .click();
  await page.waitForURL('**/dashboard');

  await expect(
    page.getByRole('heading', { name: 'Dashboard' })
  ).toBeVisible();
  await expect(page.getByText('dev@zkcredits.test')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'API Key' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Buy Credits' })
  ).toBeVisible();
  // No commitment in a fresh browser profile -> placeholder, not a crash.
  await expect(
    page.getByText('Generate an API key to see your usage status.')
  ).toBeVisible();
});

test('signed-in header shows Dashboard instead of Sign in', async ({
  page,
}) => {
  await page.goto('/sign-in');
  await page
    .getByRole('button', { name: /Continue with dev account/ })
    .click();
  await page.waitForURL('**/dashboard');

  const header = page.getByTestId('site-header');
  await expect(header.getByRole('link', { name: 'Dashboard' })).toBeVisible();
});

test('unconfigured integrations explain the disabled dashboard actions', async ({
  page,
}) => {
  await page.goto('/sign-in');
  await page
    .getByRole('button', { name: /Continue with dev account/ })
    .click();
  await page.waitForURL('**/dashboard');

  await expect(
    page.getByText(/gateway integration is not configured/i),
  ).toBeVisible();
  await expect(
    page.getByText(/Stripe checkout is unavailable/i),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Generate API Key' }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Buy Now' }).first()).toBeDisabled();
});
