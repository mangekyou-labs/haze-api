import { test, expect } from '@playwright/test';

test('onboarding wizard completion step displays all three coding agent commands', async ({ page }) => {
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

  // Done step: verify all three agent commands are rendered in DOM
  await expect(page.getByText('All Set!')).toBeVisible();
  await expect(page.getByText('npm install --global zk-credits')).toBeVisible();
  await expect(page.getByText('zk-credits import-mnemonic')).toBeVisible();
  await expect(page.getByText(/zk-credits cline/)).toBeVisible();
  await expect(page.getByText(/zk-credits claude/)).toBeVisible();
  await expect(page.getByText(/zk-credits setup codex/)).toBeVisible();
});
