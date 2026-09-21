import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('multi-agent UI visibility in onboarding and dashboard', () => {
  const wizardPath = path.resolve(__dirname, '../app/onboarding/onboarding-wizard.tsx');
  const dashboardStatusPath = path.resolve(__dirname, '../app/dashboard/dashboard-status.tsx');
  const apiKeySectionPath = path.resolve(__dirname, '../app/dashboard/api-key-section.tsx');

  const wizardSource = fs.readFileSync(wizardPath, 'utf8');
  const dashboardStatusSource = fs.readFileSync(dashboardStatusPath, 'utf8');
  const apiKeySource = fs.readFileSync(apiKeySectionPath, 'utf8');

  it('onboarding wizard done step presents CLI setup and directs to funding', () => {
    expect(wizardSource).toContain('npm install --global zk-credits');
    expect(wizardSource).toContain('zk-credits import-mnemonic');
    expect(wizardSource).not.toContain('zk-credits cline');
    expect(wizardSource).not.toContain('zk-credits claude');
    expect(wizardSource).not.toContain('zk-credits setup codex');
  });

  it('dashboard status component presents agent launch commands exclusively when depositStatus is active', () => {
    expect(dashboardStatusSource).toContain('Run with your coding agent:');
    expect(dashboardStatusSource).toContain('zk-credits cline');
    expect(dashboardStatusSource).toContain('zk-credits claude');
    expect(dashboardStatusSource).toContain('zk-credits setup codex');
    expect(dashboardStatusSource).toMatch(/status\.depositStatus === 'active'[\s\S]*zk-credits cline/);
  });

  it('dashboard api-key-section presents import-mnemonic and avoids pre-funded launch commands', () => {
    expect(apiKeySource).toContain('zk-credits import-mnemonic');
    expect(apiKeySource).not.toContain('zk-credits cline');
    expect(apiKeySource).not.toContain('zk-credits claude');
    expect(apiKeySource).not.toContain('zk-credits setup codex');
  });
});
