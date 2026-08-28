import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('multi-agent UI visibility in onboarding and dashboard', () => {
  const wizardPath = path.resolve(__dirname, '../app/onboarding/onboarding-wizard.tsx');
  const apiKeySectionPath = path.resolve(__dirname, '../app/dashboard/api-key-section.tsx');

  const wizardSource = fs.readFileSync(wizardPath, 'utf8');
  const apiKeySource = fs.readFileSync(apiKeySectionPath, 'utf8');

  it('onboarding wizard done step presents commands for Cline, Claude, and Codex', () => {
    expect(wizardSource).toContain('zk-credits cline');
    expect(wizardSource).toContain('zk-credits claude');
    expect(wizardSource).toContain('zk-credits setup codex');
    expect(wizardSource).toContain('zk-credits import-mnemonic');
  });

  it('dashboard api-key-section presents agent quick start for existing identity / commitment', () => {
    expect(apiKeySource).toContain('zk-credits cline');
    expect(apiKeySource).toContain('zk-credits claude');
    expect(apiKeySource).toContain('zk-credits setup codex');
    // Ensure agent commands are visible for existing commitment, not only fresh mnemonic state
    expect(apiKeySource).toMatch(/existingCommitment[\s\S]*zk-credits cline/);
  });
});
