// SPDX-License-Identifier: AGPL-3.0-or-later
/*
 * Compile the spend circuit with Circom 2 into circuits/build/private-credit.
 * Never overwrite the root Circom 0.5 artifacts used as negative fixtures.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'build', 'private-credit');
const CIRCUIT = path.join(ROOT, 'private_credit_spend.circom');

function resolveCircom() {
  const candidates = [
    process.env.CIRCOM,
    path.join(os.homedir(), '.local', 'bin', 'circom'),
    'circom',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status !== 0) continue;
    const version = `${probe.stdout} ${probe.stderr}`;
    if (!/\b2\.\d+/u.test(version) || /\b0\.5\b/u.test(version)) continue;
    return { bin: candidate, version: version.trim() };
  }
  throw new Error('Circom 2 is required to compile private_credit_spend.circom (found none on PATH)');
}

function copyWasm() {
  const nested = path.join(OUT_DIR, 'private_credit_spend_js', 'private_credit_spend.wasm');
  const flat = path.join(OUT_DIR, 'private_credit_spend.wasm');
  if (!fs.existsSync(nested)) throw new Error(`Circom 2 wasm missing at ${nested}`);
  fs.copyFileSync(nested, flat);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const circom = resolveCircom();
const args = [
  CIRCUIT,
  '--r1cs',
  '--wasm',
  '--sym',
  '-o',
  OUT_DIR,
  '-l',
  path.join(ROOT, 'node_modules'),
];
const result = spawnSync(circom.bin, args, { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
copyWasm();
console.log(`compiled with ${circom.version} -> ${OUT_DIR}`);
