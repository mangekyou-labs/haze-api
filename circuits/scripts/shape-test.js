const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const circuit = path.join(__dirname, '..', 'slash.r1cs');
const info = execFileSync('npx', ['snarkjs', 'r1cs', 'info', circuit], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

assert.match(info, /# of Public Inputs:\s+4/);
assert.match(
  info,
  /# of Outputs:\s+5/,
  'slash must publish recovered values plus current and post-removal roots',
);

console.log('slash public statement shape: 5 outputs + 4 public share inputs = 9 signals');
