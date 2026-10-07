import { resolveInstalledPackages } from '../../packages/zk-credits-sidecar/scripts/resolve-installed.mjs';
import { build } from "esbuild";
await build({
  plugins: [resolveInstalledPackages],
  entryPoints: [new URL("../../ts/service-class.ts", import.meta.url).pathname],
  outfile: new URL("./.generated/service-class.mjs", import.meta.url).pathname,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
});

await build({
  plugins: [resolveInstalledPackages],
  entryPoints: [
    new URL(
      "../../packages/zk-credits-sidecar/src/runtime-owner.ts",
      import.meta.url,
    ).pathname,
  ],
  outfile: new URL("./.generated/runtime-owner.mjs", import.meta.url).pathname,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
});
await build({
  plugins: [resolveInstalledPackages],
  entryPoints: [
    new URL(
      "../../packages/zk-credits-sidecar/src/slot-ledger.ts",
      import.meta.url,
    ).pathname,
  ],
  outfile: new URL("./.generated/slot-ledger.mjs", import.meta.url).pathname,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
});

// Only public deployment configuration enters the package candidate.
const { readFile, writeFile } = await import('node:fs/promises');
const { parseEnv } = await import('node:util');
const { createHash } = await import('node:crypto');
const manifest = JSON.parse(await readFile(new URL('../../packages/zk-credits-sidecar/circuits/manifest.json', import.meta.url), 'utf8'));
let launch = {};
try { launch = parseEnv(await readFile(new URL('../../.env.launch.local', import.meta.url), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const recipient = launch.BASE_TREASURY_ADDRESS ?? '0x0000000000000000000000000000000000000002';
if (!/^0x[0-9a-fA-F]{40}$/.test(recipient ?? '')) throw Error('Public BASE_TREASURY_ADDRESS is required for the investigator candidate');
const buildIdentity = createHash('sha256');
for (const name of ['live.mjs', 'investigator.mjs', 'inference.mjs', 'recovery.mjs', 'purchase.mjs', 'evidence-binding.mjs', 'tool-loop.mjs', 'status-check.mjs']) buildIdentity.update(await readFile(new URL(name, import.meta.url)));
const defaults = { build: buildIdentity.digest('hex'), inference: {
  gateway: 'https://zk-credits-gateway.onrender.com/v1/chat/completions',
  deploymentDomain: manifest.deployment.deploymentDomain,
  contract: manifest.deployment.bondAddress, recipient,
  circuit: manifest.deployment.circuitId, verifyingKey: manifest.deployment.verifyingKeyId,
  serviceClass: 'coding-deepseek-v4-flash-v1',
} };
await writeFile(new URL('./.generated/live-defaults.mjs', import.meta.url), 'export const LIVE_DEFAULTS = ' + JSON.stringify(defaults) + ';\n');
