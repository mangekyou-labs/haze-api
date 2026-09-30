import { chmod, readFile, writeFile } from 'node:fs/promises';
import { builtinModules, createRequire } from 'node:module';
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
const nodeBuiltins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
// Ship the matching credential format implementation rather than resolving an
// older published shared package at runtime.
const runtimeExternalPackages = ['@napi-rs/keyring', '@x402/core', '@zk-credits/x402-zk-prepaid', 'snarkjs'];

function isRuntimeExternal(path) {
  return runtimeExternalPackages.some((packageName) => (
    path === packageName || path.startsWith(`${packageName}/`)
  ));
}

const resolveBareImportsWithoutPnp = {
  name: 'resolve-bare-imports-without-pnp',
  setup(context) {
    context.onResolve({ filter: /.*/ }, (args) => {
      if (args.path.startsWith('.') || args.path.startsWith('/') || args.path.startsWith('node:')) {
        return undefined;
      }
      if (nodeBuiltins.has(args.path)) {
        return { path: args.path, external: true };
      }
      if (isRuntimeExternal(args.path)) {
        return { path: args.path, external: true };
      }

      const importer = args.importer || entryPoint;
      try {
        return { path: createRequire(importer).resolve(args.path) };
      } catch {
        return undefined;
      }
    });
  },
};

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
