import { builtinModules, createRequire } from 'node:module';
const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
/** Resolve an npm checkout independently of an ancestor's Yarn PnP manifest. */
export function installedPackageResolver(externals = ['@napi-rs/keyring']) {
  return {
    name: 'resolve-installed-packages',
    setup(context) {
      context.onResolve({ filter: /^[^./]/ }, args => {
        if (args.path.startsWith('node:') || builtins.has(args.path) ||
            externals.some(name => args.path === name || args.path.startsWith(`${name}/`)))
          return { path: args.path, external: true };
        if (!args.importer) return undefined;
        try { return { path: createRequire(args.importer).resolve(args.path) }; }
        catch { return undefined; }
      });
    },
  };
}
export const resolveInstalledPackages = installedPackageResolver();
