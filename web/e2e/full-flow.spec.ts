import { test, expect } from '@playwright/test';

/**
 * E2E browser test: full zk-api-credits user flow in dev mode.
 *
 * Prerequisites:
 *   - Gateway running on localhost:3001 (with circuits/verification_key_rln.json)
 *   - Web app running on localhost:3000 (without GITHUB_CLIENT_ID → dev auth)
 *
 * Run:
 *   cd web && npx playwright test
 */

test.describe('ZK API Credits — full browser flow', () => {
  test('landing → sign-in → onboarding → dashboard → buy credits → generate key', async ({
    page,
  }) => {
    // ─── Step 1: Landing page ──────────────────────────────────────
    await test.step('landing page loads', async () => {
      await page.goto('/');
      await expect(page.locator('h1')).toContainText('ZK API Credits');
    });

    // ─── Step 2: Sign in (dev mode) ───────────────────────────────
    await test.step('dev sign-in', async () => {
      await page.getByRole('link', { name: 'Get Started' }).click();
      await page.waitForURL('**/sign-in');
      const devBtn = page.getByTestId('dev-sign-in');
      await expect(devBtn).toBeVisible();
      await devBtn.click();
      await page.waitForURL('**/dashboard');
    });

    // ─── Step 3: Dashboard initial state ──────────────────────────
    await test.step('dashboard loads', async () => {
      await expect(page.locator('h1')).toContainText('Dashboard');
      await expect(page.getByText('dev@test.local')).toBeVisible();
      await expect(page.getByTestId('generate-api-key')).toBeVisible();
    });

    // ─── Step 4: Onboarding — generate secret key ─────────────────
    const words: string[] = [];
    await test.step('onboarding: generate secret key', async () => {
      await page.goto('/onboarding');
      await page.getByTestId('generate-secret-key').click();
      await expect(page.getByText('Backup Your Recovery Phrase')).toBeVisible({
        timeout: 15_000,
      });

      const wordElements = page.locator('.grid.grid-cols-3 .font-mono');
      await expect(wordElements).toHaveCount(24);
      for (let i = 0; i < 24; i++) {
        const text = await wordElements.nth(i).textContent();
        words.push(text?.trim() ?? '');
      }
      expect(words.filter(Boolean)).toHaveLength(24);
      await page.getByTestId('mnemonic-acknowledge').click();
    });

    // ─── Step 5: Onboarding — confirm mnemonic ────────────────────
    await test.step('onboarding: confirm mnemonic', async () => {
      await expect(page.getByText('Confirm Your Backup')).toBeVisible();
      const labels = page.locator('label:has-text("Word #")');
      const count = await labels.count();
      expect(count).toBe(3);

      for (let i = 0; i < count; i++) {
        const labelText = await labels.nth(i).textContent();
        const match = labelText?.match(/Word #(\d+)/);
        if (!match) throw new Error(`Could not parse: ${labelText}`);
        const wordIndex = parseInt(match[1], 10) - 1;
        await page.locator('input').nth(i).fill(words[wordIndex]);
      }
      await page.getByTestId('confirm-mnemonic').click();
      await expect(page.getByText('All Set!')).toBeVisible({ timeout: 10_000 });
    });

    // ─── Step 6: Go to dashboard ──────────────────────────────────
    await test.step('onboarding: go to dashboard', async () => {
      await page.getByTestId('onboarding-done').click();
      await page.waitForURL('**/dashboard');
    });

    // ─── Step 7: Generate API key ─────────────────────────────────
    await test.step('generate API key', async () => {
      await page.getByTestId('generate-api-key').click();
      await expect(page.getByTestId('api-key-display')).toBeVisible({
        timeout: 15_000,
      });
      const keyText = await page
        .getByTestId('api-key-display')
        .locator('.font-mono')
        .first()
        .textContent();
      expect(keyText).toBeTruthy();
      expect(keyText!.length).toBeGreaterThan(20);
    });

    // ─── Step 8: Buy credits (dev deposit) ────────────────────────
    await test.step('buy credits via dev deposit', async () => {
      await expect(page.getByText('(dev mode)')).toBeVisible();
      await page.getByTestId('buy-starter').click();
      await expect(page.getByTestId('deposit-success')).toBeVisible({
        timeout: 30_000,
      });
      const successText = await page
        .getByTestId('deposit-success')
        .textContent();
      expect(successText).toMatch(/credited|simulated/);
    });

    // ─── Step 9: Verify dashboard status ──────────────────────────
    await test.step('dashboard shows active keys', async () => {
      await expect(page.getByText('Active Keys')).toBeVisible();
      await page.reload();
      await expect(page.getByText('Active Keys')).toBeVisible();
    });
  });

  test('recovers a key from a valid 24-word phrase', async ({ page }) => {
    const recoveryPhrase = [
      ...Array(23).fill('abandon'),
      'art',
    ].join(' ');

    await test.step('sign in for the protected dashboard', async () => {
      await page.goto('/sign-in');
      await page.getByTestId('dev-sign-in').click();
      await page.waitForURL('**/dashboard');
    });

    await test.step('restore browser key material', async () => {
      await page.goto('/recover');
      await page.getByTestId('recovery-phrase').fill(recoveryPhrase);
      await page.getByTestId('recover-key').click();
      await expect(page.getByText('Key Recovered!')).toBeVisible({ timeout: 15_000 });
    });

    await test.step('use recovered key material on the dashboard', async () => {
      await page.getByTestId('recovery-dashboard').click();
      await page.waitForURL('**/dashboard');
      await expect(page.getByTestId('generate-api-key')).toBeVisible();
      await page.getByTestId('generate-api-key').click();
      await expect(page.getByTestId('api-key-display')).toBeVisible({ timeout: 15_000 });
    });
  });
});
