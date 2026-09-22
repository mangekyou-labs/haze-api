/**
 * `scripts/launch-pilot.sh` entrypoint.
 *
 * The shell wrapper owns the environment file and the terminal; everything it
 * decides lives in `launch/cli.ts`, so the ordering rules and the checkpoints
 * are testable without a shell.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { resolve } from 'node:path';
import { runLaunchCli } from './launch/cli.js';

const repoRoot = resolve(import.meta.dirname, '..');
const result = await runLaunchCli(process.argv.slice(2), { repoRoot });
process.exitCode = result.exitCode;
