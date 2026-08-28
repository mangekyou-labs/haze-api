import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('README and honest caveats spec', () => {
  const readmePath = path.resolve(__dirname, '../../../README.md');
  const readme = fs.readFileSync(readmePath, 'utf-8');

  it('documents public URLs for hosted gateway and web app', () => {
    expect(readme).toContain('https://zk-credits-gateway.onrender.com');
    expect(readme).toContain(
      'https://feature-zk-api-credits-gadillacers-projects.vercel.app',
    );
  });

  it('references the launch contract and does not reference legacy or dummy VK contract', () => {
    expect(readme).toContain(
      'CBDGHYF5CQM527IM3GVDDWXLDB4XNPA5BT4KXFVCSJZTQIOFZGOIHAIT',
    );
    expect(readme).not.toContain('dummy VK');
    expect(readme).not.toContain(
      'CCJG427D5B2KCLQC4GNSUXLZU7T3455T763EEIX44DNLCUMLXYKGEE4R',
    );
    expect(readme).not.toContain('must be redeployed');
  });

  it('documents all nine honest caveats', () => {
    // 1. Testnet only
    expect(readme).toMatch(/testnet only/i);
    // 2. 100-ticket specialization
    expect(readme).toMatch(/100-ticket specialization|100 private ticket/i);
    // 3. Variable-cost refunds deferred
    expect(readme).toMatch(/variable-cost refunds deferred|variable-cost/i);
    // 4. Single-contributor trusted setup
    expect(readme).toMatch(/single-contributor.*trusted setup/i);
    // 5. Custodial gateway-mediated withdrawal
    expect(readme).toMatch(/custodial.*gateway-mediated withdrawal/i);
    expect(readme).toMatch(/gateway can block.*disappearing/i);
    expect(readme).toMatch(/membership-removal proof|unilateral/i);
    expect(readme).toMatch(/unilateral.*redirect|redirect.*unilateral/i);
    expect(readme).toMatch(/membership-removal proof/i);
    // 6. Async per-call on-chain audit
    expect(readme).toMatch(/async.*on-chain.*audit|async per-call/i);
    // 7. Single gateway timing
    expect(readme).toMatch(/single gateway.*timing/i);
    // 8. Browser proving latency
    expect(readme).toMatch(/browser proving.*latency/i);
    // 9. IP / network identity not hidden
    expect(readme).toMatch(/network identity.*not hidden|IP.*not hidden/i);
  });

  it('does not state GitHub sign-in as the required identity step', () => {
    expect(readme).not.toMatch(/1\.\s+Developer signs in with GitHub/i);
  });
});
