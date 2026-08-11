import { chmod } from 'node:fs/promises';
import { builtinModules, createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = resolve(packageDirectory, 'dist/zk-credits.js');
const entryPoint = resolve(packageDirectory, 'dist/cli.js');
const nodeBuiltins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));

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
      if (args.path === 'keytar') {
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
  external: ['keytar'],
  plugins: [resolveBareImportsWithoutPnp],
  legalComments: 'external',
  logLevel: 'warning',
});

await chmod(outputPath, 0o755);
