import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { verifyActivatedCredential, verifyRecoveryCapsule } from '@zk-credits/shared/base';

const CONTRACT = '0x0000000000000000000000000000000000000001';
const HASH = `0x${'ab'.repeat(32)}`;
async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: /Continue with dev account/u }).click();
  await page.waitForURL('**/dashboard');
}
async function mockSandbox(page: Page, available = 2000) {
  const state = { balanceCents: available, reservedCents: 0, availableCents: available, bundlePriceCents: 2000,
    bundles: [] as Record<string, unknown>[], funder: { address: CONTRACT, tokenAddress: CONTRACT, usdcBalance: '20000000', ready: true, reason: null, faucetUrl: 'https://faucet.circle.com/' } };
  await page.route('**/api/sandbox', route => route.fulfill({ json: state }));
  return state;
}
async function backup(page: Page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download recovery file' }).click();
  const path = (await (await download).path())!;
  const capsule = JSON.parse(readFileSync(path, 'utf8'));
  const { commitment } = await verifyRecoveryCapsule(capsule);
  await expect(page.getByRole('button', { name: 'Activate my credits' })).toHaveCount(0);
  await page.locator('#capsule-file').setInputFiles(path);
  await expect(page.getByText('Backup verified locally.', { exact: true })).toBeVisible();
  return { path, capsule, commitment };
}
function bundle(commitment: string, state: string, reason: string | null = null) {
  return { commitment, state, reason, transactionHash: state === 'unknown' || state === 'funded' ? HASH : null,
    activation: state === 'funded' ? { commitment, network: 'eip155:84532', chainId: 84532, contractAddress: CONTRACT, deploymentDomain: '84532', tierId: 0, expiry: 1_900_000_000, transactionHash: HASH } : null };
}

test('requires sign-in and simulated balance, without invite entry', async ({ page }) => {
  await page.goto('/dashboard'); await page.waitForURL('**/sign-in');
  await mockSandbox(page, 0); await signIn(page);
  await expect(page.locator('#invite-code')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pay with Stripe', exact: true })).toBeEnabled();
  await backup(page);
  await expect(page.getByRole('button', { name: 'Activate my credits' })).toBeDisabled();
});

test('funds after local backup and downloads a verified credential', async ({ page }) => {
  const snapshot = await mockSandbox(page);
  let attempts = 0;
  await page.route('**/api/pilot/funding', route => {
    const body = route.request().postDataJSON();
    expect(Object.keys(body)).toEqual(['commitment']);
    attempts++;
    const funded = bundle(body.commitment, 'funded');
    snapshot.bundles = [funded]; snapshot.balanceCents = 0; snapshot.availableCents = 0;
    return route.fulfill({ json: funded });
  });
  await signIn(page);
  const { capsule, commitment } = await backup(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Activate my credits' }).click();
  const activatedPath = (await (await download).path())!;
  const activated = JSON.parse(readFileSync(activatedPath, 'utf8'));
  expect((await verifyActivatedCredential(activated)).commitment).toBe(commitment);
  expect(activated.capsule).toEqual(capsule.capsule);
  expect(attempts).toBe(1);
  await expect(page.getByRole('button', { name: 'Download activated credential again' })).toBeVisible();
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).not.toContain(capsule.capsule.secret);
  expect(storage).not.toContain(commitment);
  await page.reload();
  const recovered = page.waitForEvent('download');
  await page.locator('#capsule-file').setInputFiles(activatedPath);
  await recovered;
  expect(attempts).toBe(1);
});

test('holds unknown outcomes across reload and recovers without another activation', async ({ page }) => {
  const snapshot = await mockSandbox(page);
  let attempts = 0;
  await page.route('**/api/pilot/funding', route => {
    attempts++;
    const pending = bundle(route.request().postDataJSON().commitment, 'unknown', 'confirmation_pending');
    snapshot.bundles = [pending]; snapshot.availableCents = 0; snapshot.reservedCents = 2000;
    return route.fulfill({ json: pending });
  });
  await signIn(page);
  const { path, commitment } = await backup(page);
  await page.getByRole('button', { name: 'Activate my credits' }).click();
  await expect(page.getByRole('button', { name: 'Waiting for confirmation…' })).toBeDisabled();
  await page.reload();
  await page.locator('#capsule-file').setInputFiles(path);
  await expect(page.getByRole('button', { name: 'Waiting for confirmation…' })).toBeDisabled();
  snapshot.bundles = [bundle(commitment, 'funded')]; snapshot.balanceCents = 0; snapshot.reservedCents = 0;
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await download;
  expect(attempts).toBe(1);
});

test('shows funder recovery and retries the same commitment after definitive failure', async ({ page }) => {
  const snapshot = await mockSandbox(page);
  let attempts = 0; const commitments: string[] = [];
  await page.route('**/api/pilot/funding', route => {
    const commitment = route.request().postDataJSON().commitment;
    commitments.push(commitment); attempts++;
    const result = attempts === 1 ? bundle(commitment, 'waiting_funds', 'insufficient_usdc') : bundle(commitment, 'funded');
    snapshot.bundles = [result];
    return route.fulfill({ json: result });
  });
  await signIn(page); await backup(page);
  await page.getByRole('button', { name: 'Activate my credits' }).click();
  await expect(page.getByText('Bundle status: Waiting for test USDC')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Get Base Sepolia USDC from the faucet' })).toHaveAttribute('href', 'https://faucet.circle.com/');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Retry activation' }).click();
  await download;
  expect(commitments[0]).toBe(commitments[1]);
});

test('refreshes a successful checkout return until verified balance arrives', async ({ page }) => {
  const snapshot = await mockSandbox(page, 0);
  await signIn(page);
  await page.evaluate(() => sessionStorage.setItem('zk-credits:checkout-pending', JSON.stringify({ requestId: 'pending-small', amountCents: 2000 })));
  await page.goto('/dashboard?checkout=success');
  await expect(page.getByText('Checkout completed. Waiting for the verified payment to update your balance.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/u);
  Object.assign(snapshot, { topups: [{ requestId: 'pending-small', amountCents: 2000, paid: true }] });
  snapshot.balanceCents = 2000;
  snapshot.availableCents = 2000;
  await expect(page.getByText('Your simulated balance is ready.', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Pay with Stripe', exact: true })).toBeEnabled();
});

test('renders the authenticated dashboard while contract status is still loading', async ({ page }) => {
  await mockSandbox(page, 0);
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/network-status', async route => {
    await waiting;
    await route.fulfill({ json: { healthy: false, contractAddress: null } });
  });
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Set up your credits' })).toBeVisible();
  await expect(page.getByText('Checking contract status…')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay with Stripe', exact: true })).toBeEnabled();
  release();
  await expect(page.getByText('Contract status unavailable · Base Sepolia testnet')).toBeVisible();
});

test('resumes pending payment verification after reload even when the first snapshot fails', async ({ page }) => {
  const snapshot = await mockSandbox(page, 2000);
  await signIn(page);
  await page.evaluate(() => {
    sessionStorage.setItem('zk-credits:checkout-pending', JSON.stringify({ requestId: 'reload-payment', amountCents: 500 }));
    sessionStorage.setItem('zk-credits:checkout-request:500', 'reload-payment');
  });
  await page.route('**/api/sandbox', route => route.fulfill({ status: 503, json: { error: 'gateway_unavailable' } }));
  await page.goto('/dashboard?checkout=success');
  await expect(page.locator('p[role=alert]')).toBeVisible();
  await page.unroute('**/api/sandbox');
  await page.route('**/api/sandbox', route => route.fulfill({ json: snapshot }));
  await page.reload();
  await expect(page.getByText('Checking the status of your pending top-up…', { exact: true })).toBeVisible();
  Object.assign(snapshot, { topups: [{ requestId: 'reload-payment', amountCents: 500, paid: true }] });
  await expect(page.getByText('Your simulated balance is ready.', { exact: true })).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => sessionStorage.getItem('zk-credits:checkout-pending'))).toBeNull();
});

test('manual refresh reconciles a late payment and the next same-amount top-up starts a new request', async ({ page }) => {
  const snapshot = await mockSandbox(page, 0);
  await signIn(page);
  await page.clock.install();
  await page.evaluate(() => {
    sessionStorage.setItem('zk-credits:checkout-pending', JSON.stringify({ requestId: 'late-payment', amountCents: 2000 }));
    sessionStorage.setItem('zk-credits:checkout-request:2000', 'late-payment');
  });
  await page.goto('/dashboard?checkout=success');
  await expect(page.getByText('Checkout completed. Waiting for the verified payment to update your balance.', { exact: true })).toBeVisible();
  await page.clock.fastForward(61_000);
  await expect(page.getByText('Payment verification may still be processing.', { exact: false })).toBeVisible();
  Object.assign(snapshot, { topups: [{ requestId: 'late-payment', amountCents: 2000, paid: true }], balanceCents: 2000, availableCents: 2000 });
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect(page.getByText('Your simulated balance is ready.', { exact: true })).toBeVisible();
  let requestId = '';
  await page.route('**/api/sandbox/checkout', route => {
    requestId = route.request().postDataJSON().requestId;
    return route.fulfill({ status: 503, json: { error: 'checkout_unavailable' } });
  });
  await page.getByRole('button', { name: 'Pay with Stripe', exact: true }).click();
  await expect(page.locator('p[role=alert]')).toBeVisible();
  expect(requestId).not.toBe('late-payment');
});

test('shows friendly GitHub cancellation and expired sign-in recovery', async ({ page }) => {
  await page.goto('/sign-in?error=AccessDenied');
  await expect(page.locator('p[role=alert]')).toContainText('GitHub sign-in was cancelled');
  await expect(page.getByRole('link', { name: 'Restore your credential', exact: true })).toBeVisible();
  await page.goto('/sign-in?error=InvalidCheck');
  await expect(page.locator('p[role=alert]')).toContainText('expired');
  await expect(page.locator('p[role=alert]')).not.toContainText('InvalidCheck');
});

test('waits for this top-up verification even when existing balance is positive', async ({ page }) => {
  const snapshot = await mockSandbox(page, 2000);
  await signIn(page);
  await page.evaluate(() => sessionStorage.setItem('zk-credits:checkout-pending', JSON.stringify({ requestId: 'pending-large', amountCents: 10000 })));
  await page.goto('/dashboard?checkout=success');
  await expect(page.getByText('Checkout completed. Waiting for the verified payment to update your balance.', { exact: true })).toBeVisible();
  await expect(page.getByText('Your simulated balance is ready.', { exact: true })).toHaveCount(0);
  Object.assign(snapshot, { topups: [{ requestId: 'pending-large', amountCents: 10000, paid: true }], balanceCents: 12000, availableCents: 12000 });
  await expect(page.getByText('Your simulated balance is ready.', { exact: true })).toBeVisible({ timeout: 10_000 });
});

test('opens GitHub authorization with immediate pending feedback and one submission', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let submissions = 0;
  await page.route('**/sign-in', async route => {
    if (route.request().method() === 'POST') { submissions++; await pending; }
    await route.continue();
  });
  await page.route('https://github.com/login/oauth/authorize**', route => route.fulfill({ body: 'GitHub authorization' }));
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in with GitHub', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connecting to GitHub…' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Connecting to GitHub…' })).toHaveAttribute('aria-busy', 'true');
  expect(submissions).toBe(1);
  release();
  await page.waitForURL('https://github.com/login/oauth/authorize**');
  expect(new URL(page.url()).searchParams.get('redirect_uri')).toContain('/api/auth/callback/github');
});

test('offers all test top-ups and resumes each selected amount after a Checkout failure', async ({ page }) => {
  await mockSandbox(page, 0);
  const requests: { requestId: string; amountCents: number }[] = [];
  await page.route('**/api/sandbox/checkout', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, json: { error: 'checkout_unavailable' } });
  });
  await signIn(page);
  await expect(page.getByRole('radio', { name: '$20 sandbox top-up', exact: true })).toBeChecked();
  await page.getByRole('radio', { name: '$20 sandbox top-up', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: '$100 sandbox top-up', exact: true })).toBeChecked();
  expect(requests).toHaveLength(0);
  for (const dollars of [5, 20, 100]) {
    const choice = page.getByRole('radio', { name: `$${dollars} sandbox top-up`, exact: true });
    const button = page.getByRole('button', { name: 'Pay with Stripe', exact: true });
    const previousRequests = requests.length;
    await choice.check();
    await expect(choice).toBeChecked();
    expect(requests).toHaveLength(previousRequests); // Selection alone must never start a payment.
    await button.click();
    await expect(page.locator('p[role=alert]')).toContainText('Retry to resume the same top-up');
    await expect(button).toBeEnabled();
    await button.click();
    await expect(button).toBeEnabled();
    const [first, retry] = requests.slice(-2);
    expect(first.amountCents).toBe(dollars * 100);
    expect(retry).toEqual(first);
  }
  expect(new Set(requests.map(request => request.requestId)).size).toBe(3);
  await expect(page.getByText('$5 adds balance toward a bundle;', { exact: false })).toBeVisible();
  await page.goto('/sign-in');
  await expect(page).toHaveURL(/\/dashboard$/u);
  await expect(page.getByText('dev@zkcredits.test', { exact: true })).toBeVisible();
  await expect(page.getByTestId('site-header').getByRole('link', { name: 'GitHub' })).toHaveCount(0);
  await expect(page.getByTestId('site-footer').getByRole('link', { name: 'Source code' })).toBeVisible();
  await page.goto('/');
  await expect(page.getByTestId('site-header').getByRole('link', { name: 'Dashboard' })).toBeVisible();
  await page.getByTestId('site-header').getByRole('link', { name: 'Dashboard' }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
  await page.goto('/');
  await expect(page.getByTestId('site-header').getByRole('link', { name: 'Dashboard' })).toHaveCount(0);
  await expect(page.getByTestId('site-header').getByRole('link', { name: 'Get Started' })).toHaveAttribute('href', '/sign-in');
});
