import { expect, test } from '@playwright/test';

test('explains the product and links to setup', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Haze Credits' })).toBeVisible();
  await expect(page.getByTestId('site-header')).toContainText('Haze Credits');
  await expect(page.getByTestId('site-header').getByRole('link', { name: 'Dashboard' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'GitHub', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Create your credential' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connect your client' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Start building' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Get Started' }).first()).toHaveAttribute('href', '/sign-in');
  await expect(page.getByTestId('site-header').getByRole('link', { name: 'Sign in with GitHub' })).toHaveAttribute('href', '/sign-in');
  await expect(page.getByText('ZK API credits · Base Sepolia', { exact: true })).toBeVisible();
  await expect(page.getByText(/ZK API credits for your coding agent/)).toBeVisible();
  await expect(page.getByText(/Your credential stays on your device/)).toHaveCount(0);
  await expect(page.getByTestId('site-footer')).not.toContainText('Base Sepolia testnet');
  await expect(page.getByTestId('site-footer')).not.toContainText('Not independently audited');
  expect(await page.locator('body').innerText()).not.toMatch(/research pilot|honorarium|slots A and C/i);
});
