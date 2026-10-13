import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const PRODUCT_PAGES = [
  'web/src/app/layout.tsx',
  'web/src/app/page.tsx',
  'web/src/components/site-footer.tsx',
  'web/src/app/sign-in/page.tsx',
  'web/src/app/onboarding/page.tsx',
  'web/src/app/dashboard/page.tsx',
  'web/src/app/dashboard/pilot-onboarding-flow.tsx',
] as const;

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), '..', relativePath), 'utf8');
}

describe('product copy', () => {
  it.each(PRODUCT_PAGES)('keeps research operations out of %s', (file) => {
    expect(read(file)).not.toMatch(/research pilot|honorarium|slots A and C|willingness.to.pay|founder.provisioned/i);
  });

  it('keeps the approved landing copy concise without claiming anonymity', () => {
    const footer = read('web/src/components/site-footer.tsx');
    const landing = read('web/src/app/page.tsx');
    expect(footer).toContain('Haze Credits');
    expect(footer).not.toContain('Base Sepolia testnet');
    expect(footer).not.toContain('Not independently audited');
    expect(landing).toContain('ZK API credits');
    expect(landing).not.toContain('Your credential stays on your device');
    for (const file of PRODUCT_PAGES) {
      expect(read(file)).not.toMatch(/\banonym(?:ous|ity)\b/i);
    }
  });

  it('offers simulated top-up, recovery-file safety, and client setup', () => {
    const onboarding = read('web/src/app/dashboard/pilot-onboarding-flow.tsx');
    expect(onboarding).toContain('Top up $20 in sandbox');
    expect(onboarding).not.toContain('id="invite-code"');
    expect(onboarding).toContain('Anyone possessing this recovery file can spend its credits');
    expect(onboarding).toContain('Select the file you downloaded to verify your backup');
    expect(onboarding).toContain('Base RPC');
    expect(onboarding).toContain('Open the setup guide');
    expect(onboarding).not.toContain('type="password"');
    const dashboard = read('web/src/app/dashboard/page.tsx');
    expect(dashboard).toContain('https://zk-credits-gateway.onrender.com');
    expect(dashboard).not.toContain('your-gateway.example');
  });
});
