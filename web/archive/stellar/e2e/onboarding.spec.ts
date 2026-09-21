import { expect, test, type Page } from '@playwright/test';

// Browser-side crypto E2E: the onboarding wizard generates a secret key,
// derives the 24-word mnemonic, computes the deposit commitment with the
// served circuit artifacts (/circuits/*.wasm + *.zkey), and persists both to
// IndexedDB. The recover page must round-trip the same identity.

async function idbGet(page: Page, key: string): Promise<string | null> {
  return page.evaluate(
    (k) =>
      new Promise<string | null>((resolve) => {
        const req = indexedDB.open('zk-credits-crypto', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('keys');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('keys', 'readonly');
          const get = tx.objectStore('keys').get(k);
          get.onsuccess = () => resolve((get.result as string) ?? null);
          get.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
      }),
    key,
  );
}

test('onboarding wizard: generate, backup, confirm, persist', async ({
  page,
}) => {
  test.setTimeout(120_000); // browser Groth16 commitment proving

  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Generate Key' }).click();

  // Backup step: 24 mnemonic words rendered.
  const wordEls = page.getByTestId('mnemonic-word');
  await expect(wordEls.first()).toBeVisible({ timeout: 60_000 });
  const words = await wordEls.allTextContents();
  expect(words).toHaveLength(24);

  await page.getByRole('button', { name: "I've Written It Down" }).click();

  // Confirm step: fill the 3 requested words using their 1-based positions.
  const inputs = page.getByTestId('confirm-input');
  expect(await inputs.count()).toBe(3);
  for (let i = 0; i < 3; i++) {
    const position = Number(await inputs.nth(i).getAttribute('data-word-index'));
    await inputs.nth(i).fill(words[position - 1]);
  }
  await page.getByRole('button', { name: 'Confirm & Continue' }).click();

  await expect(page.getByText('All Set!')).toBeVisible({ timeout: 60_000 });

  // Key material persisted to IndexedDB.
  const secretK = await idbGet(page, 'secret_k');
  const commitment = await idbGet(page, 'commitment');
  expect(secretK).toMatch(/^[0-9a-f]{64}$/);
  expect(commitment).toBeTruthy();
});

test('recover page round-trips an onboarding mnemonic to the same commitment', async ({
  page,
}) => {
  test.setTimeout(180_000);

  // Produce an identity through the wizard first.
  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Generate Key' }).click();
  await page.getByTestId('mnemonic-word').first().waitFor({ timeout: 60_000 });
  const words = await page.getByTestId('mnemonic-word').allTextContents();
  expect(words).toHaveLength(24);
  await page.getByRole('button', { name: "I've Written It Down" }).click();
  const inputs = page.getByTestId('confirm-input');
  for (let i = 0; i < 3; i++) {
    const position = Number(await inputs.nth(i).getAttribute('data-word-index'));
    await inputs.nth(i).fill(words[position - 1]);
  }
  await page.getByRole('button', { name: 'Confirm & Continue' }).click();
  await expect(page.getByText('All Set!')).toBeVisible({ timeout: 60_000 });
  const originalCommitment = await idbGet(page, 'commitment');
  expect(originalCommitment).toBeTruthy();

  // Wipe the stored identity, then recover from the mnemonic.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open('zk-credits-crypto', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('keys', 'readwrite');
          tx.objectStore('keys').delete('secret_k');
          tx.objectStore('keys').delete('commitment');
          tx.oncomplete = () => resolve();
        };
        req.onerror = () => resolve();
      }),
  );

  await page.goto('/recover');
  await page
    .getByPlaceholder(/word1 word2 word3/)
    .fill(words.join(' '));
  await page.getByRole('button', { name: 'Recover Key' }).click();
  await expect(page.getByText('Key Recovered!')).toBeVisible({
    timeout: 60_000,
  });

  expect(await idbGet(page, 'commitment')).toBe(originalCommitment);
  expect(await idbGet(page, 'secret_k')).toMatch(/^[0-9a-f]{64}$/);
});

test('recover page rejects a malformed phrase with a clear error', async ({
  page,
}) => {
  await page.goto('/recover');
  await page.getByPlaceholder(/word1 word2 word3/).fill('abandon abandon abandon');
  await page.getByRole('button', { name: 'Recover Key' }).click();
  await expect(page.getByText(/Expected 24 words, got 3/)).toBeVisible();
});
