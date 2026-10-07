import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('./acceptance-manifest.json', import.meta.url), 'utf8'));
const files = (await readdir(directory)).filter((f) => f.endsWith('.test.mjs')).sort();
const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
};
// Each manifest entry selects real public-seam assertions; an empty selection fails.
for (const entry of [...manifest.cases, ...(manifest.authenticCases ?? [])]) {
  const source = await readFile(new URL(entry.file, import.meta.url), 'utf8');
  if (!source.includes(entry.testName)) throw Error(`Missing acceptance assertions: ${entry.name}`);
}
run(process.execPath, ['--test', ...files], directory);
run('npm', ['test', '--', 'src/base-sidecar.test.ts', 'src/investigator-transport.test.ts', 'src/runtime-owner.test.ts'], `${root}packages/zk-credits-sidecar`);
run('npm', ['test', '--', 'service-class.test.ts'], `${root}ts`);
console.log(JSON.stringify({ offlineControllerCases: manifest.cases.map((c) => c.name),
  authenticFixtureAcceptance: manifest.authenticAcceptanceGaps.length || !manifest.authenticCases?.length ? 'INCOMPLETE' : 'PASS',
  authenticCases: (manifest.authenticCases ?? []).map((c) => c.name), gaps: manifest.authenticAcceptanceGaps,
  prepaidIntegration: 'SKIP: separately authorized consumption required',
  livePurchasedTrace: 'DISABLED: exact signing remains disabled' }, null, 2));
