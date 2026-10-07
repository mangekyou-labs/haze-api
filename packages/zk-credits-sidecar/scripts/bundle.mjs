import { chmod, readFile, writeFile } from 'node:fs/promises';
import { installedPackageResolver } from './resolve-installed.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { parseEnv } from 'node:util';

const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
// Read only the launch RPC; never copy the remaining launch environment.
const launchEnvironment = parseEnv(await readFile(resolve(packageDirectory, '../../.env.launch.local'), 'utf8'));
const releaseRpc = launchEnvironment.BASE_RPC_URL?.trim();
if (!releaseRpc) throw new Error('BASE_RPC_URL is required in .env.launch.local to build zk-credits.');
let parsedRpc;
try { parsedRpc = new URL(releaseRpc); } catch { throw new Error('Release RPC must be an HTTP(S) URL.'); }
if (!['https:', 'http:'].includes(parsedRpc.protocol) || parsedRpc.hash) throw new Error('Release RPC must be an HTTP(S) URL without a fragment.');
const rpcModulePath = resolve(packageDirectory, 'dist/rpc-config.js');
const rpcModule = await readFile(rpcModulePath, 'utf8');
const defaultDeclaration = "export const DEFAULT_BASE_SEPOLIA_RPC_URL = '__ZK_CREDITS_RELEASE_RPC_URL__';";
if (!rpcModule.includes(defaultDeclaration)) throw new Error('Release RPC placeholder is missing.');
await writeFile(rpcModulePath, rpcModule.replace(defaultDeclaration, `export const DEFAULT_BASE_SEPOLIA_RPC_URL = ${JSON.stringify(releaseRpc)};`));

const outputPath = resolve(packageDirectory, 'dist/zk-credits.js');
const entryPoint = resolve(packageDirectory, 'dist/cli.js');
// Ship the matching credential format implementation rather than resolving an
// older published shared package at runtime.
const runtimeExternalPackages = ['@napi-rs/keyring', '@x402/core', '@zk-credits/x402-zk-prepaid', 'snarkjs'];

const resolveBareImportsWithoutPnp = installedPackageResolver(runtimeExternalPackages);

await build({
  absWorkingDir: packageDirectory,
  entryPoints: [entryPoint],
  outfile: outputPath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: {
    js: "import { createRequire as __createNodeRequire } from 'node:module'; const require = __createNodeRequire(import.meta.url);",
  },
  external: runtimeExternalPackages.flatMap((packageName) => [packageName, `${packageName}/*`]),
  plugins: [resolveBareImportsWithoutPnp],
  legalComments: 'external',
  logLevel: 'warning',
});

await chmod(outputPath, 0o755);

// Library consumers need the same passwordless runtime as the CLI.
for (const name of ['local-x402-agent', 'codex-sdk-options']) {
  await build({
    absWorkingDir: packageDirectory,
    entryPoints: [resolve(packageDirectory, `dist/${name}.js`)],
    outfile: resolve(packageDirectory, `dist/${name}.js`),
    allowOverwrite: true,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    banner: { js: "import { createRequire as __createNodeRequire } from 'node:module'; const require = __createNodeRequire(import.meta.url);" },
    external: runtimeExternalPackages.flatMap((packageName) => [packageName, `${packageName}/*`]),
    plugins: [resolveBareImportsWithoutPnp],
    legalComments: 'external',
    logLevel: 'warning',
  });
}

// Package the reviewed task runtime and public policy without fixture assets.
const { execFileSync } = await import('node:child_process');
const example = resolve(packageDirectory, '../../examples/base-transaction-investigator');
execFileSync(process.execPath, [resolve(example, 'build.mjs')], { cwd: packageDirectory, stdio: 'inherit' });
await build({ entryPoints: [resolve(example, 'live.mjs')], outfile: resolve(packageDirectory, 'dist/investigator.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node20',
  external: ['zk-credits/x402'], legalComments: 'external' });
