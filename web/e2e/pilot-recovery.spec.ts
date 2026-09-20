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
  await page.fill('#recovery-password', PASSWORD);
  await page.getByRole('button', { name: 'Restore credential' }).click();

  await expect(page.getByText('Credential restored locally.')).toBeVisible();
  await expect(page.getByText(/Activated credential · tier 0/u)).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain(commitment);
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
  await page.fill('#recovery-password', PASSWORD);
  await page.getByRole('button', { name: 'Restore credential' }).click();
  await expect(page.getByText(/Legacy version-1 export · tier 0/u)).toBeVisible();
});

test('rejects a wrong password and a tampered capsule', async ({ page }) => {
  const { path: goodPath } = await activatedFixture();
  await page.goto('/recover');
  await page.locator('#credential-file').setInputFiles(goodPath);
  await page.fill('#recovery-password', 'wrong password value');
  await page.getByRole('button', { name: 'Restore credential' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(/password or ciphertext is invalid/u);

  const capsule = await createRecoveryCapsule(generateSecret(), PASSWORD);
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
  await page.fill('#recovery-password', PASSWORD);
  await page.getByRole('button', { name: 'Restore credential' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(/invalid|malformed/u);
});
