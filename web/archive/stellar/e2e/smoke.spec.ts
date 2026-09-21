import { test, expect } from '@playwright/test';

test('landing page renders the ZK API Credits value proposition', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'ZK API Credits' })
  ).toBeVisible();
  await expect(page.getByText(/Anonymous RLN-rate-limited API credits/)).toBeVisible();
});

test('landing page links to the buy flow via /sign-in', async ({ page }) => {
  await page.goto('/');
  const getStarted = page.getByRole('link', { name: 'Get Started' });
  await expect(getStarted).toBeVisible();
  await expect(getStarted).toHaveAttribute('href', '/sign-in');
});