import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  createCredential,
  createRecoveryCapsule,
  encryptCredentialExport,
  FUNDED_TIER_ID,
  generateSecret,
  wrapActivatedCredential,
} from '@zk-credits/shared/base';

const PASSWORD = 'correct horse battery staple';
const EXPIRY = 1_900_000_000;
const DOMAIN = '84532';

function writeFixture(name: string, payload: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), 'zk-recovery-'));
  const path = join(directory, name);
  writeFileSync(path, JSON.stringify(payload));
  return path;
}

async function activatedFixture(): Promise<{ path: string; commitment: string }> {
  const secret = generateSecret();
  const capsule = await createRecoveryCapsule(secret, PASSWORD);
  const credential = await createCredential(secret, FUNDED_TIER_ID, EXPIRY, DOMAIN);
  const path = writeFixture('activated.json', wrapActivatedCredential(capsule, {
    commitment: credential.commitment,
    tierId: FUNDED_TIER_ID,
    expiry: EXPIRY,
    deploymentDomain: DOMAIN,
    network: 'eip155:84532',
    contractAddress: '0x0000000000000000000000000000000000000001',
    transactionHash: '0xfunded',
  }));
  return { path, commitment: credential.commitment };
}

test('restores a version-2 activated credential without showing the commitment', async ({ page }) => {
  const { path, commitment } = await activatedFixture();
  await page.goto('/recover');
  await page.locator('#credential-file').setInputFiles(path);
  await page.getByLabel('Import a legacy encrypted export').check();
  await page.fill('#recovery-password', PASSWORD);
  await page.getByRole('button', { name: 'Restore credential' }).click();

  await expect(page.getByText('Credential restored locally.')).toBeVisible();
  await expect(page.getByText(/Activated credential · tier 0/u)).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain(commitment);
});

test('restores a passwordless activated credential without retaining its secret in browser storage', async ({ page }) => {
  const secret = generateSecret();
  const credential = await createCredential(secret, FUNDED_TIER_ID, EXPIRY, DOMAIN);
  const capsule = await createRecoveryCapsule(secret);
  const path = writeFixture('passwordless.json', wrapActivatedCredential(capsule, {
    ...credential, network: 'eip155:84532',
    contractAddress: '0x0000000000000000000000000000000000000001', transactionHash: '0xfunded',
  }));
  await page.goto('/recover');
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  await page.locator('#credential-file').setInputFiles(path);
  await page.getByRole('button', { name: 'Restore credential' }).click();
  await expect(page.getByText('Credential restored locally.')).toBeVisible();
  const browserStorage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(browserStorage).not.toContain(credential.secret);
  expect(await page.content()).not.toContain(credential.secret);
});

test('still restores a legacy version-1 export', async ({ page }) => {
  const secret = generateSecret();
  const credential = await createCredential(secret, FUNDED_TIER_ID, EXPIRY, DOMAIN);
  const path = writeFixture('legacy.json', {
    format: 'zk-credits-credential',
    version: 1,
    encrypted: await encryptCredentialExport(credential, PASSWORD),
  });

  await page.goto('/recover');
  await page.locator('#credential-file').setInputFiles(path);
  await page.getByLabel('Import a legacy encrypted export').check();
  await page.fill('#recovery-password', PASSWORD);
  await page.getByRole('button', { name: 'Restore credential' }).click();
  await expect(page.getByText(/Legacy version-1 export · tier 0/u)).toBeVisible();
});

test('rejects a wrong password and a tampered capsule', async ({ page }) => {
  const { path: goodPath } = await activatedFixture();
  await page.goto('/recover');
  await page.locator('#credential-file').setInputFiles(goodPath);
  await page.getByLabel('Import a legacy encrypted export').check();
  await page.fill('#recovery-password', 'wrong password value');
  await page.getByRole('button', { name: 'Restore credential' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(/password or ciphertext is invalid/u);

  const capsule = await createRecoveryCapsule(generateSecret(), PASSWORD);
  if (capsule.algorithm !== 'PBKDF2-AES-GCM') throw new Error('Expected legacy fixture');
  const tampered = {
    format: 'zk-credits-credential',
    version: 2,
    kind: 'activated-credential',
    capsule: { ...capsule, ciphertext: `${capsule.ciphertext.slice(0, -2)}aa` },
    activation: {
      commitment: '1',
      tierId: FUNDED_TIER_ID,
      expiry: EXPIRY,
      deploymentDomain: DOMAIN,
      network: 'eip155:84532',
      contractAddress: '0x0000000000000000000000000000000000000001',
      transactionHash: '0xfunded',
    },
  };
  const tamperedPath = writeFixture('tampered.json', tampered);
  await page.locator('#credential-file').setInputFiles(tamperedPath);
  await page.getByLabel('Import a legacy encrypted export').check();
  await page.fill('#recovery-password', PASSWORD);
  await page.getByRole('button', { name: 'Restore credential' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(/invalid|malformed/iu);
});

test('activates a recovered capsule from its existing funding bundle', async ({ page }) => {
  const secret = generateSecret();
  const capsule = await createRecoveryCapsule(secret, PASSWORD);
  const path = writeFixture('capsule.json', {
    format: 'zk-credits-credential',
    version: 2,
    kind: 'recovery-capsule',
    capsule,
  });
  const credential = await createCredential(secret, FUNDED_TIER_ID, EXPIRY, DOMAIN);
  let lookedUpCommitment = '';
  await page.route('**/api/pilot/recovery**', async (route) => {
    const requestUrl = new URL(route.request().url());
    lookedUpCommitment = requestUrl.searchParams.get('commitment') ?? '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        commitment: credential.commitment,
        tierId: FUNDED_TIER_ID,
        expiry: EXPIRY,
        deploymentDomain: DOMAIN,
        network: 'eip155:84532',
        contractAddress: '0x0000000000000000000000000000000000000001',
        transactionHash: '0xfunded',
      }),
    });
  });

  await page.goto('/recover');
  await page.locator('#credential-file').setInputFiles(path);
  await page.getByLabel('Import a legacy encrypted export').check();
  await page.fill('#recovery-password', PASSWORD);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Restore credential' }).click();
  const download = await downloadPromise;

  expect(lookedUpCommitment).toBe(credential.commitment);
  expect(download.suggestedFilename()).toMatch(/^zk-credits-credential-/u);
  await expect(page.getByText('Credential restored locally.')).toBeVisible();
});

test('does not save or download a recovered credential with expired activation metadata', async ({ page }) => {
  const secret = generateSecret();
  const capsule = await createRecoveryCapsule(secret, PASSWORD);
  const path = writeFixture('capsule-expired.json', {
    format: 'zk-credits-credential',
    version: 2,
    kind: 'recovery-capsule',
    capsule,
  });
  const credential = await createCredential(secret, FUNDED_TIER_ID, EXPIRY, DOMAIN);
  await page.route('**/api/pilot/recovery**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        commitment: credential.commitment,
        tierId: FUNDED_TIER_ID,
        expiry: Math.floor(Date.now() / 1000) - 1,
        deploymentDomain: DOMAIN,
        network: 'eip155:84532',
        contractAddress: '0x0000000000000000000000000000000000000001',
        transactionHash: '0xfunded',
      }),
    });
  });

  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  await page.goto('/recover');
  await page.locator('#credential-file').setInputFiles(path);
  await page.getByLabel('Import a legacy encrypted export').check();
  await page.fill('#recovery-password', PASSWORD);
  await page.getByRole('button', { name: 'Restore credential' }).click();

  await expect(page.locator('p[role="alert"]')).toContainText(/bundle has expired/iu);
  expect(downloads).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('zk-credits:credential-metadata'))).toBeNull();
});

test('rejects a wrong capsule password and malformed capsule before lookup', async ({ page }) => {
  const secret = generateSecret();
  const capsule = await createRecoveryCapsule(secret, PASSWORD);
  const wrongPasswordPath = writeFixture('capsule-wrong-password.json', {
    format: 'zk-credits-credential',
    version: 2,
    kind: 'recovery-capsule',
    capsule,
  });
  const malformedPath = writeFixture('capsule-malformed.json', {
    format: 'zk-credits-credential',
    version: 2,
    kind: 'recovery-capsule',
    capsule: { ...capsule, ciphertext: 'not-base64url!' },
  });
  let lookupRequests = 0;
  await page.route('**/api/pilot/recovery**', async (route) => {
    lookupRequests += 1;
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"bundle_not_found"}' });
  });

  await page.goto('/recover');
  await page.locator('#credential-file').setInputFiles(wrongPasswordPath);
  await page.getByLabel('Import a legacy encrypted export').check();
  await page.fill('#recovery-password', 'wrong password value');
  await page.getByRole('button', { name: 'Restore credential' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(/password or ciphertext is invalid/u);
  expect(lookupRequests).toBe(0);

  await page.locator('#credential-file').setInputFiles(malformedPath);
  await page.getByLabel('Import a legacy encrypted export').check();
  await page.fill('#recovery-password', PASSWORD);
  await page.getByRole('button', { name: 'Restore credential' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(/invalid|malformed/iu);
  expect(lookupRequests).toBe(0);
});

test('does not fund a capsule with no existing bundle and rejects mismatched lookup metadata', async ({ page }) => {
  const secret = generateSecret();
  const capsule = await createRecoveryCapsule(secret, PASSWORD);
  const path = writeFixture('capsule-without-bundle.json', {
    format: 'zk-credits-credential',
    version: 2,
    kind: 'recovery-capsule',
    capsule,
  });
  let fundingRequests = 0;
  await page.route('**/api/pilot/recovery**', async (route) => {
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'bundle_not_found' }) });
  });
  await page.route('**/api/pilot/funding', async (route) => {
    fundingRequests += 1;
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.goto('/recover');
  await page.locator('#credential-file').setInputFiles(path);
  await page.getByLabel('Import a legacy encrypted export').check();
  await page.fill('#recovery-password', PASSWORD);
  await page.getByRole('button', { name: 'Restore credential' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(/no funded credential bundle was found/iu);
  expect(fundingRequests).toBe(0);

  const wrongCommitment = await createCredential(generateSecret(), FUNDED_TIER_ID, EXPIRY, DOMAIN);
  await page.unroute('**/api/pilot/recovery**');
  await page.route('**/api/pilot/recovery**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        commitment: wrongCommitment.commitment,
        tierId: FUNDED_TIER_ID,
        expiry: EXPIRY,
        deploymentDomain: DOMAIN,
        network: 'eip155:84532',
        contractAddress: '0x0000000000000000000000000000000000000001',
        transactionHash: '0xfunded',
      }),
    });
  });
  await page.getByRole('button', { name: 'Restore credential' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(/commitment mismatch/iu);
  expect(fundingRequests).toBe(0);
});
