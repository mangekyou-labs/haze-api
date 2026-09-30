import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharedCandidates = [
  path.resolve(webRoot, '../packages/zk-credits-shared'),
  path.resolve(webRoot, 'vendor/zk-credits-shared'),
];
const target = path.resolve(webRoot, 'node_modules/@zk-credits/shared');

const sharedRoot = sharedCandidates.find((candidate) => existsSync(path.join(candidate, 'dist/index.js')));
if (!sharedRoot) {
  throw new Error('Shared package artifact is missing from both the workspace and web/vendor');
}

// A web-only deployment cannot see the workspace package. Refresh its tracked
// artifact whenever building from the monorepo so both builds use the same API.
const vendorRoot = sharedCandidates[1];
if (sharedRoot !== vendorRoot) {
  mkdirSync(vendorRoot, { recursive: true });
  rmSync(path.join(vendorRoot, 'dist'), { recursive: true, force: true });
  cpSync(path.join(sharedRoot, 'dist'), path.join(vendorRoot, 'dist'), { recursive: true });
  cpSync(path.join(sharedRoot, 'package.json'), path.join(vendorRoot, 'package.json'));
}

rmSync(target, { force: true, recursive: true });
mkdirSync(path.dirname(target), { recursive: true });
cpSync(sharedRoot, target, { recursive: true });

const packageJson = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
console.log(`Prepared ${packageJson.name}@${packageJson.version} for the Vercel build`);
