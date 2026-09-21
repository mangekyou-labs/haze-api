import { expect, test } from '@playwright/test';

test('dashboard gates the Level 4 flow behind consent and completes the mocked testnet path', async ({ page }) => {
  let enrolled = false;
  let walletVerified = false;
  let depositConfirmed = false;

  await page.addInitScript(() => {
    const signature = btoa('s'.repeat(64));
    Object.defineProperty(window, 'freighterApi', {
      configurable: true,
      value: {
        getNetworkDetails: async () => ({ network: 'TESTNET' }),
        getPublicKey: async () => 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        signMessage: async () => signature,
      },
    });
  });

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
        wallet: { verified: walletVerified, addressRedacted: walletVerified ? 'GAAAA…WHF' : null },
        deposit: {
          confirmed: depositConfirmed,
          transactionHash: depositConfirmed ? 'a'.repeat(64) : null,
          explorerUrl: depositConfirmed ? 'https://stellar.expert/explorer/testnet/tx/' + 'a'.repeat(64) : null,
          newRoot: null,
        },
        feedbackSubmitted: false,
        complete: false,
      }),
    });
  });

  await page.route('**/api/evaluation/enroll', async (route) => {
    enrolled = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ participantCode: 'L4-aaaaaaaaaaaa' }) });
  });
  await page.route('**/api/evaluation/challenge', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'challenge-1', message: 'Stellar Signed Message:\nlevel4 challenge', expiresAt: '2026-09-12T00:10:00.000Z' }),
    });
  });
  await page.route('**/api/evaluation/wallet-proof', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    expect(body.network).toBe('testnet');
    expect(body.signature).not.toContain('private');
    walletVerified = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ verified: true }) });
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

  await expect(evaluation.getByRole('button', { name: 'Verify wallet' })).toBeVisible();
  await evaluation.getByRole('button', { name: 'Verify wallet' }).click();
  await expect(evaluation.getByText(/Wallet verified on Stellar testnet/)).toBeVisible();

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
  await expect(evaluation.getByRole('button', { name: 'Start $1 test checkout' })).toBeVisible();
  await evaluation.getByRole('button', { name: 'Start $1 test checkout' }).click();
  await expect(page.getByText(/Checkout confirmed; the Stellar testnet deposit is recorded/)).toBeVisible({ timeout: 15_000 });
  await expect(evaluation.getByText(/Deposit confirmed on Stellar testnet/)).toBeVisible();
});
