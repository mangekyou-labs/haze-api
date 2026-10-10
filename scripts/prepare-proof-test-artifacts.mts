/** Install the committed public bundle and verify every manifest hash for CI. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseCircuitManifest } from '../packages/zk-credits-sidecar/src/artifact-bundle.js';
import { acquirePinnedArtifactBundle } from '../packages/zk-credits-sidecar/src/artifact-release.js';

const directory = new URL('../packages/zk-credits-sidecar/circuits/', import.meta.url);
const manifest = parseCircuitManifest(JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8')));
await acquirePinnedArtifactBundle({
  manifest,
  archivePath: fileURLToPath(new URL(manifest.release!.assetName, directory)),
  targetDirectory: fileURLToPath(new URL('artifacts/', directory)),
});
console.log('Public proof test artifacts installed and SHA-256 verified.');
