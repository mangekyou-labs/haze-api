import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { verifyActivatedCredential, verifyRecoveryCapsule, type ActivatedCredentialFile, type RecoveryCapsuleFile } from '@zk-credits/shared/base';

const PASSWORD = 'correct horse battery staple';
const CONTRACT = '0x0000000000000000000000000000000000000001';
const alert = (page: Page) => page.locator('p[role="alert"]');
const FUNDING_RESPONSE = {
  network: 'eip155:84532',
  chainId: 84532,
  contractAddress: CONTRACT,
  deploymentDomain: '84532',
  tierId: 0,
  expiry: 1_900_000_000,
  transactionHash: '0xfunded',
};

async function signIn(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: /Continue with dev account/u }).click();
  await page.waitForURL('**/dashboard');
}

test('requires GitHub sign-in and a redeemed invite before anything is funded', async ({ page }) => {
  await page.goto('/dashboard');
  await page.waitForURL('**/sign-in');

  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Pilot onboarding' })).toBeVisible();

  // Uninvited: the gateway rejects the code and no funding path opens.
  await page.route('**/api/invites/redeem', (route) => route.fulfill({
    status: 400,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'invalid_invite_code' }),
  }));
  await page.fill('#invite-code', 'not-a-real-invite-code');
  await page.getByRole('button', { name: 'Redeem invite' }).click();
  await expect(alert(page)).toContainText('invalid_invite_code');
  await expect(page.getByRole('button', { name: /Generate and download recovery capsule/u })).toHaveCount(0);
  await expect(page.getByText('Locked', { exact: true }).first()).toBeVisible();
});

test('completes invite, capsule backup, detached funding, and local verification', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/invites/redeem', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ fundingToken: 'funding-token-value-0123456789', expiresAt: Date.now() + 30 * 60 * 1000 }),
  }));
  await page.route('**/api/pilot/funding', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(FUNDING_RESPONSE),
  }));

  await page.fill('#invite-code', 'pilot-invite-code-0123456789');
  await page.getByRole('button', { name: 'Redeem invite' }).click();
  await expect(page.getByText(/Invite redeemed/u)).toBeVisible();

  await page.fill('#capsule-password', PASSWORD);
  await page.fill('#capsule-password-confirmation', PASSWORD);
  const capsuleDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /Generate and download recovery capsule/u }).click();
  const capsuleFile = await capsuleDownload;
  expect(capsuleFile.suggestedFilename()).toMatch(/^zk-credits-recovery-capsule-/u);

  const capsulePath = (await capsuleFile.path())!;
  const capsule = JSON.parse(readFileSync(capsulePath, 'utf8')) as RecoveryCapsuleFile;
  const { commitment } = await verifyRecoveryCapsule(capsule, PASSWORD);

  // Backup gating: funding stays locked until the capsule is re-imported.
  await expect(page.getByText('Locked', { exact: true }).last()).toBeVisible();
  await page.locator('#capsule-file').setInputFiles(capsulePath);
  await expect(page.getByText(/Backup verified locally/u)).toBeVisible();

  const credentialDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /Fund my pilot credential/u }).click();
  await expect(page.getByRole('heading', { name: 'Verified locally' })).toBeVisible();
  const credentialFile = await credentialDownload;
  expect(credentialFile.suggestedFilename()).toMatch(/^zk-credits-credential-/u);

  // The browser wrapped the same capsule with the authoritative metadata.
  const activated = JSON.parse(readFileSync((await credentialFile.path())!, 'utf8')) as ActivatedCredentialFile;
  expect(activated.kind).toBe('activated-credential');
  expect(activated.capsule).toEqual(capsule.capsule);
  expect(activated.activation).toEqual({
    commitment,
    tierId: 0,
    expiry: FUNDING_RESPONSE.expiry,
    deploymentDomain: FUNDING_RESPONSE.deploymentDomain,
    network: FUNDING_RESPONSE.network,
    contractAddress: FUNDING_RESPONSE.contractAddress,
    transactionHash: FUNDING_RESPONSE.transactionHash,
  });
  const verified = await verifyActivatedCredential(activated, PASSWORD);
  expect(verified.commitment).toBe(commitment);

  // The funding capability is erased once funding succeeds.
  expect(await page.evaluate(() => sessionStorage.getItem('zk-credits:funding-token'))).toBeNull();

  // Control-plane view: no commitment value, no funding token, and no payment action.
  const html = await page.content();
  expect(html).not.toContain(commitment);
  expect(html).not.toContain('funding-token-value');
  expect(html).not.toMatch(/stripe/iu);
  expect(await page.locator('a[href*="checkout"], form[action*="checkout"], a[href*="billing"], form[action*="billing"]').count()).toBe(0);
});

test('survives funding rejection and retries the same detached capability', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/invites/redeem', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ fundingToken: 'funding-token-value-0123456789', expiresAt: Date.now() + 30 * 60 * 1000 }),
  }));
  let attempts = 0;
  await page.route('**/api/pilot/funding', (route) => {
    attempts += 1;
    if (attempts === 1) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'funding_unavailable' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FUNDING_RESPONSE) });
  });

  await page.fill('#invite-code', 'pilot-invite-code-0123456789');
  await page.getByRole('button', { name: 'Redeem invite' }).click();
  await page.fill('#capsule-password', PASSWORD);
  await page.fill('#capsule-password-confirmation', PASSWORD);
  const capsuleDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /Generate and download recovery capsule/u }).click();
  const capsulePath = (await (await capsuleDownload).path())!;
  await page.locator('#capsule-file').setInputFiles(capsulePath);

  await page.getByRole('button', { name: /Fund my pilot credential/u }).click();
  await expect(alert(page)).toContainText('funding_unavailable');
  expect(await page.evaluate(() => sessionStorage.getItem('zk-credits:funding-token'))).toBe('funding-token-value-0123456789');

  const retryDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /Fund my pilot credential/u }).click();
  await expect(page.getByRole('heading', { name: 'Verified locally' })).toBeVisible();
  await retryDownload;
  expect(attempts).toBe(2);
});
