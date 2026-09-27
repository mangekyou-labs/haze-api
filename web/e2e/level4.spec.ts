import { expect, test } from '@playwright/test';

test('dashboard completes the mocked Level 4 path without a wallet provider', async ({ page }) => {
  let enrolled = false;
  let depositConfirmed = false;
  let feedbackSubmitted = false;

  await page.route('**/api/evaluation/status', async (route) => {
    if (!enrolled) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_enrolled' }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        participantCode: 'L4-aaaaaaaaaaaa',
        consentVersion: 'level4-2026-09-11',
        enrolledAt: '2026-09-12T00:00:00.000Z',
        retentionDeadline: '2026-12-11T00:00:00.000Z',
        wallet: { verified: false, addressRedacted: null },
        deposit: {
          confirmed: depositConfirmed,
          transactionHash: depositConfirmed ? 'a'.repeat(64) : null,
          explorerUrl: depositConfirmed ? 'https://stellar.expert/explorer/testnet/tx/' + 'a'.repeat(64) : null,
          newRoot: null,
        },
        feedbackSubmitted,
        complete: depositConfirmed && feedbackSubmitted,
      }),
    });
  });

  await page.route('**/api/evaluation/enroll', async (route) => {
    enrolled = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ participantCode: 'L4-aaaaaaaaaaaa' }) });
  });
  await page.route('**/api/checkout', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    expect(body).toMatchObject({ tier: 'evaluation', commitment: '0x' + '1'.repeat(64) });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: '/dashboard?checkout=success&session_id=cs_test_level4' }) });
  });
  await page.route('**/api/checkout/receipt?session_id=cs_test_level4', async (route) => {
    depositConfirmed = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ processingStatus: 'confirmed', transactionHash: 'a'.repeat(64) }),
    });
  });
  await page.route('**/api/evaluation/feedback', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    expect(body).toMatchObject({
      easeRating: 5,
      taskCompleted: true,
      wouldUseAgain: true,
      mostValuableAspect: 'private API access',
      biggestFriction: 'cold start',
      quoteConsent: false,
    });
    feedbackSubmitted = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        participantCode: 'L4-aaaaaaaaaaaa',
        consentVersion: 'level4-2026-09-11',
        enrolledAt: '2026-09-12T00:00:00.000Z',
        retentionDeadline: '2026-12-11T00:00:00.000Z',
        wallet: { verified: false, addressRedacted: null },
        deposit: {
          confirmed: true,
          transactionHash: 'a'.repeat(64),
          explorerUrl: 'https://stellar.expert/explorer/testnet/tx/' + 'a'.repeat(64),
          newRoot: null,
        },
        feedbackSubmitted: true,
        complete: true,
      }),
    });
  });

  await page.goto('/sign-in');
  await page.getByRole('button', { name: /Continue with dev account/ }).click();
  await page.waitForURL('**/dashboard');

  const evaluation = page.getByRole('region', { name: /Help validate the Stellar testnet flow/i });
  await expect(evaluation).toBeVisible();
  const enroll = evaluation.getByRole('button', { name: 'Enroll in evaluation' });
  await expect(enroll).toBeDisabled();
  await evaluation.getByRole('checkbox').first().check();
  await expect(enroll).toBeEnabled();
  await enroll.click();

  await expect(evaluation).not.toContainText(/Verify wallet|Freighter/i);
  const checkout = evaluation.getByRole('button', { name: 'Start $1 test checkout' });
  await expect(checkout).toBeDisabled();

  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('zk-credits-crypto', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('keys');
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('keys', 'readwrite');
      transaction.objectStore('keys').put('0x' + '1'.repeat(64), 'commitment');
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  }));
  await page.reload();
  await expect(evaluation).not.toContainText(/Verify wallet|Freighter/i);
  await expect(checkout).toBeEnabled();
  await checkout.click();
  await expect(page.getByText(/Checkout confirmed; the Stellar testnet deposit is recorded/)).toBeVisible({ timeout: 15_000 });
  await expect(evaluation.getByText(/Deposit confirmed on Stellar testnet/)).toBeVisible();
  await expect(evaluation.getByRole('link', { name: 'View Stellar Explorer transaction' })).toHaveAttribute('href', /stellar\.expert\/explorer\/testnet\/tx/);

  await evaluation.getByLabel('Most valuable aspect').fill('private API access');
  await evaluation.getByLabel('Biggest friction').fill('cold start');
  await evaluation.getByText('5', { exact: true }).last().click();
  await evaluation.getByText('I completed the requested task.').click();
  await evaluation.getByText('I would use this flow again.').click();
  await evaluation.getByRole('button', { name: 'Submit feedback' }).click();
  await expect(evaluation.getByText('Thank you — your feedback was recorded.')).toBeVisible();
});
