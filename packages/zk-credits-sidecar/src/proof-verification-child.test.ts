import { fork } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// Exercise the actual child boundary: invalid input must fail closed and exit,
// rather than leave verifier threads alive in the application process.
describe('local verification process', () => {
  it('rejects malformed verification inputs and exits without leaking the payload', async () => {
    const child = fork(new URL('../dist/proof-verification-child.js', import.meta.url), [], {
      execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let output = '';
    child.stdout?.on('data', (chunk) => { output += String(chunk); });
    child.stderr?.on('data', (chunk) => { output += String(chunk); });
    const message = new Promise((resolve) => child.once('message', resolve));
    const exit = new Promise((resolve) => child.once('exit', resolve));
    try {
      child.send({ verificationKey: {}, publicSignals: ['private-test-sentinel'], proof: {} });
      expect(await message).toBe(false);
      expect(await exit).toBe(0);
      expect(output).toBe('');
    } finally { if (child.exitCode === null) child.kill(); }
  }, 10_000);
});
