import { exec } from 'node:child_process';
import { notStrictEqual } from 'assert';

notStrictEqual(process.env.PLAYWRIGHT_WEB_PORT, '0', 'web port must be numeric');
notStrictEqual(process.env.PLAYWRIGHT_GATEWAY_PORT, '0', 'gateway port must be numeric');

const spec = new URL('./playwright-launch.spec.ts', import.meta.url);

(async () => {
  console.log(`launch gate spec ready: ${spec.pathname}`);
})();
