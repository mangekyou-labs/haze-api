import { expect, test } from '@playwright/test';

// Auth/session behavior with a configured secret: the session endpoint must be
// healthy and the auth guards must behave correctly for anonymous visitors.

test('session endpoint responds 200 for anonymous visitors', async ({
  request,
}) => {
  const res = await request.get('/api/auth/session');
  expect(res.status()).toBe(200);
});

test('anonymous /sign-in shows the GitHub sign-in button', async ({
  page,
}) => {
  await page.goto('/sign-in');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(
    page.getByRole('button', { name: 'Sign in with GitHub' })
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Recover from mnemonic' })
  ).toBeVisible();
});

test('anonymous /dashboard redirects to /sign-in', async ({ page }) => {
  await page.goto('/dashboard');
  await page.waitForURL('**/sign-in');
  await expect(
    page.getByRole('button', { name: 'Sign in with GitHub' })
  ).toBeVisible();
});
