import { test, expect } from '@playwright/test';

test('onboarding wizard completion step displays CLI setup and directs to funding', async ({ page }) => {
  await page.goto('/onboarding');
  await page.getByRole('button', { name: /Generate/i }).click();

  // Wait for backup step
  await expect(page.getByRole('heading', { name: /Backup Your Recovery Phrase/i })).toBeVisible();

  // Read the 24 words
  const words = await page.getByTestId('mnemonic-word').allInnerTexts();
  expect(words.length).toBe(24);

  await page.getByRole('button', { name: "I've Written It Down" }).click();

  // Fill in confirmation words
  const inputs = await page.getByTestId('confirm-input').all();
  for (const input of inputs) {
    const wordIndexAttr = await input.getAttribute('data-word-index');
    const wordIndex = Number(wordIndexAttr) - 1;
    await input.fill(words[wordIndex]!);
  }

  await page.getByRole('button', { name: 'Confirm & Continue' }).click();

  // Done step: verify CLI import commands are rendered, and pre-funded launch commands are absent
  await expect(page.getByText('All Set!')).toBeVisible();
  await expect(page.getByText('npm install --global zk-credits')).toBeVisible();
  await expect(page.getByText('zk-credits import-mnemonic')).toBeVisible();
  await expect(page.getByText(/zk-credits cline/)).not.toBeVisible();
  await expect(page.getByText(/zk-credits claude/)).not.toBeVisible();
  await expect(page.getByText(/zk-credits setup codex/)).not.toBeVisible();
  await expect(page.getByRole('button', { name: /Go to Dashboard to Fund Tickets/i })).toBeVisible();
});

test('dashboard renders agent launch commands when deposit status is active, and hides them when unfunded', async ({
  page,
}) => {
  let depositStatus: 'active' | 'unfunded' = 'active';
  await page.route('**/api/dashboard/status*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        commitment: '0x1234567890abcdef',
        callsThisEpoch: 0,
        epochQuota: 100,
        remainingCalls: 100,
        activeKeys: 1,
        balanceUsdc: '1000000',
        depositStatus,
      }),
    });
  });

  // Seed commitment in IndexedDB before navigating
  await page.goto('/sign-in');
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('zk-credits-crypto', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('keys');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('keys', 'readwrite');
        tx.objectStore('keys').put('0x1234567890abcdef', 'commitment');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });

  // Sign in via dev account
  await page.getByRole('button', { name: /Continue with dev account/ }).click();
  await page.waitForURL('**/dashboard');

  // 1. Active funded status: verify launch commands are visible in DOM
  await expect(page.getByText('Run with your coding agent:')).toBeVisible();
  await expect(page.getByText(/zk-credits cline/)).toBeVisible();
  await expect(page.getByText(/zk-credits claude/)).toBeVisible();
  await expect(page.getByText(/zk-credits setup codex/)).toBeVisible();

  // 2. Switch mock to unfunded status and reload: verify launch commands are absent in DOM
  depositStatus = 'unfunded';
  await page.reload();
  await expect(page.getByText('Run with your coding agent:')).not.toBeVisible();
  await expect(page.getByText(/zk-credits cline/)).not.toBeVisible();
  await expect(page.getByText(/zk-credits claude/)).not.toBeVisible();
  await expect(page.getByText(/zk-credits setup codex/)).not.toBeVisible();
});
