const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const deployScript = fs.readFileSync(
  path.join(__dirname, 'deploy-contract.js'),
  'utf8',
);

test('prepares every Soroban deployment transaction before signing', () => {
  assert.match(
    deployScript,
    /const preparedUploadTx = await server\.prepareTransaction\(tx\);\s*preparedUploadTx\.sign\(sourceKeypair\);\s*(?:const|let) sendResult = requireAcceptedSubmission\(\s*await server\.sendTransaction\(preparedUploadTx\),/,
  );
  assert.match(
    deployScript,
    /const preparedDeployTx = await server\.prepareTransaction\(tx2\);\s*preparedDeployTx\.sign\(sourceKeypair\);\s*let sendResult2 = requireAcceptedSubmission\(\s*await server\.sendTransaction\(preparedDeployTx\),/,
  );
  assert.doesNotMatch(deployScript, /fee: '100000000'/);
  assert.match(
    deployScript,
    /vkJson\.alpha[\s\S]*vkJson\.beta[\s\S]*vkJson\.delta[\s\S]*vkJson\.gamma[\s\S]*vkJson\.ic/,
  );
  assert.match(deployScript, /ScVal\.scvMap\(\[/);
  assert.match(deployScript, /ScVal\.scvSymbol\(key\)/);
  assert.match(deployScript, /function requireAcceptedSubmission\(result, label\)/);
  assert.match(deployScript, /process\.env\.WASM_HASH/);
  assert.match(deployScript, /Using pre-uploaded WASM hash/);
  for (const label of ['WASM upload', 'Contract deployment', 'Statement-key installation']) {
    assert.match(
      deployScript,
      new RegExp(`requireAcceptedSubmission\\([\\s\\S]*?'${label}'`),
    );
  }
  for (const field of ['alpha', 'beta', 'delta', 'gamma', 'ic']) {
    assert.match(
      deployScript,
      new RegExp(`entry\\(\\s*'${field}'`),
    );
  }
});
