import { expect, Page, test } from '@playwright/test';

const transactionHash = 'a'.repeat(64);
const participantCode = 'L4-TESTUSER';

type EvaluationMockState = {
  enrolled: boolean;
  walletVerified: boolean;
  checkoutStarted: boolean;
  depositConfirmed: boolean;
  feedbackSubmitted: boolean;
};

function statusFor(state: EvaluationMockState) {
  return {
    participantCode,
    consentVersion: 'level4-2026-09-11',
    enrolledAt: '2026-09-11T00:00:00.000Z',
    retentionDeadline: '2026-12-10T00:00:00.000Z',
    wallet: {
      verified: state.walletVerified,
      addressRedacted: state.walletVerified ? 'GABC…WXYZ' : null,
    },
    deposit: {
      confirmed: state.depositConfirmed,
      transactionHash: state.depositConfirmed ? transactionHash : null,
      explorerUrl: state.depositConfirmed
        ? `https://stellar.expert/explorer/testnet/tx/${transactionHash}`
        : null,
      newRoot: state.depositConfirmed ? 'b'.repeat(64) : null,
    },
    feedbackSubmitted: state.feedbackSubmitted,
    complete: state.walletVerified && state.depositConfirmed && state.feedbackSubmitted,
  };
}

async function installEvaluationMocks(
  page: Page,
  initial: Partial<EvaluationMockState> = {},
  seedCommitment = true,
) {
  if (seedCommitment) {
    await page.addInitScript(() => {
      const request = indexedDB.open('zk-credits-crypto', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('keys')) request.result.createObjectStore('keys');
      };
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('keys', 'readwrite');
        transaction.objectStore('keys').put('123456789', 'commitment');
        transaction.oncomplete = () => db.close();
      };
    });
  }
  const state: EvaluationMockState = {
    enrolled: false,
    walletVerified: false,
    checkoutStarted: false,
    depositConfirmed: false,
    feedbackSubmitted: false,
    ...initial,
  };

  await page.route('**/api/evaluation/status', async (route) => {
    if (!state.enrolled) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_enrolled' }) });
      return;
    }
    if (state.checkoutStarted) state.depositConfirmed = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(statusFor(state)) });
  });

  await page.route('**/api/evaluation/enroll', async (route) => {
    state.enrolled = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ participantCode }) });
  });

  await page.route('**/api/evaluation/challenge', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'challenge-level4',
        message: 'Stellar Signed Message:\nL4-TESTUSER\nchallenge-level4',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      }),
    });
  });

  await page.route('**/api/evaluation/wallet-proof', async (route) => {
    state.walletVerified = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ verified: true }) });
  });

  await page.route('**/api/checkout', async (route) => {
    state.checkoutStarted = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: '/dashboard?session_id=cs_test_level4' }),
    });
  });

  await page.route('**/api/checkout/receipt**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        checkoutSessionId: 'cs_test_level4',
        amountCents: 100,
        processingStatus: 'confirmed',
        transactionHash,
        newRoot: 'b'.repeat(64),
      }),
    });
  });

  await page.route('**/api/evaluation/feedback', async (route) => {
    state.feedbackSubmitted = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(statusFor(state)) });
  });

  await page.route('**/api/evaluation/analytics', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ analyticsId: 'c'.repeat(64) }) });
  });

  return state;
}

async function installFreighter(page: Page, network: string = 'TESTNET') {
  await page.addInitScript(({ initialNetwork }) => {
    (window as unknown as { freighterApi: Record<string, unknown> }).freighterApi = {
      getNetworkDetails: async () => initialNetwork,
      getPublicKey: async () => 'GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456789',
      signMessage: async () => 'A'.repeat(88),
    };
  }, { initialNetwork: network });
}

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('dev-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test.describe('Level 4 evaluation browser flow', () => {
  test('completes consent, wallet proof, checkout return, feedback, and opt-in analytics', async ({ page }) => {
    await installEvaluationMocks(page);
    await installFreighter(page);
    await signIn(page);

    await expect(page.getByRole('heading', { name: 'Help prove the Stellar testnet flow' })).toBeVisible();
    await page.getByLabel(/I consent to the Level 4 evaluation/).check();
    await page.getByRole('button', { name: 'Enroll in evaluation' }).click();
    await expect(page.getByTestId('participant-code')).toHaveText(participantCode);

    await page.getByRole('button', { name: 'Verify wallet' }).click();
    await expect(page.getByText('Wallet verified on Stellar testnet.')).toBeVisible();

    await page.getByRole('button', { name: 'Start $1 test checkout' }).click();
    await page.waitForURL('**/dashboard?session_id=cs_test_level4');
    await expect(page.getByText('Deposit confirmed on Stellar testnet.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'View Stellar Explorer transaction' })).toHaveAttribute('href', new RegExp(transactionHash));

    await page.locator('label.rating-option').filter({ hasText: /^5$/ }).click();
    await page.getByLabel('I completed the requested task.').check();
    await page.getByLabel('I would use this flow again.').check();
    await page.getByLabel('Most valuable aspect').fill('The consent and wallet checklist was clear.');
    await page.getByLabel('Biggest friction').fill('The free service cold start added a pause.');
    await page.getByLabel('You may quote this feedback without identifying me.').check();
    await page.getByRole('button', { name: 'Submit feedback' }).click();
    await expect(page.getByText('Feedback submitted.')).toBeVisible();

    await page.getByLabel(/Share coarse opt-in product analytics/).check();
    await expect(page.getByLabel(/Share coarse opt-in product analytics/)).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });

  test('shows wrong-network and signature-rejection recovery states', async ({ page }) => {
    await installEvaluationMocks(page, { enrolled: true });
    await installFreighter(page, 'PUBLIC');
    await signIn(page);

    await page.getByRole('button', { name: 'Verify wallet' }).click();
    await expect(page.getByText('Freighter is on the wrong network. Select Stellar Testnet and retry.')).toBeVisible();

    await page.evaluate(() => {
      const freighter = (window as unknown as { freighterApi: Record<string, unknown> }).freighterApi;
      freighter.getNetworkDetails = async () => 'TESTNET';
      freighter.signMessage = async () => { throw new Error('user_rejected'); };
    });
    await page.getByRole('button', { name: 'Verify wallet' }).click();
    await expect(page.getByText('Wallet signing was rejected or could not be verified. Retry when ready.')).toBeVisible();
    await expect(page.getByText('The signature was rejected or invalid. Nothing was recorded; retry safely.')).toBeVisible();
  });

  test('re-enables checkout after a missing browser commitment', async ({ page }) => {
    await installEvaluationMocks(page, { enrolled: true, walletVerified: true }, false);
    await signIn(page);

    const checkout = page.getByRole('button', { name: 'Start $1 test checkout' });
    await checkout.click();
    await expect(page.getByText('Generate an API key first so this test deposit uses your browser-held commitment.')).toBeVisible();
    await expect(checkout).toBeEnabled();
  });
});
