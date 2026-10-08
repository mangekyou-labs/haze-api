import { expect, test } from '@playwright/test';

test('explains the product and links to setup', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ZK API Credits' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create your credential' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connect your client' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Start building' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Get Started' })).toHaveAttribute('href', '/sign-in');
  await expect(page.getByText(/gateway and model provider receive your prompts/)).toBeVisible();
  await expect(page.getByTestId('site-footer')).toContainText('Base Sepolia testnet');
  await expect(page.getByTestId('site-footer')).toContainText('Not independently audited');
  expect(await page.locator('body').innerText()).not.toMatch(/research pilot|honorarium|slots A and C/i);
});
