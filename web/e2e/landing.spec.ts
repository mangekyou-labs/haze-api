import { expect, test } from '@playwright/test';

test('renders the invite-only Base Sepolia research pilot contract', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'ZK API Credits' })).toBeVisible();
  await expect(page.getByText(/invite-only research pilot/i).first()).toBeVisible();
  await expect(page.getByText(/Base Sepolia/).first()).toBeVisible();
  await expect(page.getByText(/\$25 for a 30-minute research session/i)).toBeVisible();
  await expect(page.getByText(/not product revenue or willingness-to-pay evidence/i)).toBeVisible();
  await expect(page.getByText(/no product payment step/i).first()).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Supported clients' })).toBeVisible();
  await expect(page.getByText(/POST \/v1\/chat\/completions/).first()).toBeVisible();
  await expect(page.getByText(/x402-native agent/).first()).toBeVisible();
  await expect(page.getByText(/zk-prepaid/).first()).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Privacy boundary' })).toBeVisible();
  await expect(page.getByText(/Pilot telemetry does not collect/).first()).toBeVisible();
  await expect(page.getByText(/can still observe request content and traffic metadata/).first()).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Experimental circuit' })).toBeVisible();
  await expect(page.getByText(/not been independently audited/).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Honest caveats' })).toBeVisible();

  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/stripe|checkout|purchas|\bbuy\b|price|renew|\bsku\b|subscription/i);
});
