const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const circuit = path.join(__dirname, '..', 'membership_removal.r1cs');
const info = execFileSync('npx', ['snarkjs', 'r1cs', 'info', circuit], {
  encoding: 'utf8',
});

assert.match(info, /# of Public Inputs: 0/);
assert.match(info, /# of Outputs: 3/);
console.log('membership-removal public statement shape: 3 outputs (commitment, current root, next root)');
