import { expect, test } from '@playwright/test';

test('renders the Base Sepolia private-credit landing page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ZK API Credits' })).toBeVisible();
  await expect(page.getByText('Base Sepolia', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Honest caveats', { exact: false }).first()).toBeVisible();
});
