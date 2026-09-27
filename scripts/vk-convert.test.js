const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { convertVk } = require('./vk-convert.js');

const circuitsDir = path.join(__dirname, '..', 'circuits');

test('converts the RLN BLS12-381 VK into Soroban point encodings', () => {
  const generated = convertVk(path.join(circuitsDir, 'verification_key_rln.json'));
  const checkedIn = JSON.parse(
    fs.readFileSync(path.join(circuitsDir, 'verification_key_rln_soroban.json'), 'utf8'),
  );

  assert.equal(generated.alpha.length, 2 + 96 * 2);
  assert.equal(generated.beta.length, 2 + 192 * 2);
  assert.equal(generated.gamma.length, 2 + 192 * 2);
  assert.equal(generated.delta.length, 2 + 192 * 2);
  assert.equal(generated.ic.length, generated.nPublic + 1);
  assert.deepEqual(generated, checkedIn);
});
