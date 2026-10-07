// @ts-expect-error build helper has no declaration file
import { resolveInstalledPackages } from '../scripts/resolve-installed.mjs';
import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, test } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const children: ChildProcess[] = [];
const roots: string[] = [];
afterEach(async () => { for (const child of children.splice(0)) child.kill('SIGKILL'); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function launchScript(root: string, script: string, credential?: unknown): Promise<ChildProcess> {
 const outfile = join(root, randomUUID()+'.mjs');
 await build({plugins:[...(credential ? [{name:'offline-os-boundaries',setup(build){build.onResolve({filter:/credential-store\.js$/},()=>({path:'credential-store',namespace:'offline-native-store'}));build.onLoad({filter:/.*/,namespace:'offline-native-store'},()=>({contents:`export const nativeCredentialStore=()=>({});export const readStoredCredential=async()=>(${JSON.stringify(credential)});export const importCredentialPath=readStoredCredential;`,loader:'js'}));build.onResolve({filter:/^node:os$/},args=>args.namespace==='offline-home'?undefined:({path:'os',namespace:'offline-home'}));build.onLoad({filter:/.*/,namespace:'offline-home'},()=>({contents:`export * from 'node:os';export const homedir=()=>${JSON.stringify(root)};`,loader:'js'}));}}]:[]), resolveInstalledPackages],stdin:{contents:script,resolveDir:fileURLToPath(new URL('.',import.meta.url)),loader:'ts'},outfile,bundle:true,platform:'node',format:'esm',target:'node20',external:['@napi-rs/keyring'],banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"},logLevel:'silent'});
 const child=spawn(process.execPath,[outfile]); children.push(child);return child;
}
async function launcher(root: string, state: string, path = 'sidecar'): Promise<{ child: ChildProcess; result: string }> {
  const modulePath = fileURLToPath(new URL('./runtime-owner.ts', import.meta.url));
  const ledgerPath = fileURLToPath(new URL('./slot-ledger.ts', import.meta.url));
  const script = `import { BaseSlotLedger } from ${JSON.stringify(ledgerPath)}; import { acquireCredentialRuntimeLease } from ${JSON.stringify(modulePath)}; try { const lease = await acquireCredentialRuntimeLease({credential: {secret:'offline-dedicated-secret'},stateDirectory:${JSON.stringify(state)},homeDirectory:${JSON.stringify(root)}}); const ledger = await BaseSlotLedger.open({path: lease.stateDirectory+'/base-slots.json'}); const slot = ledger.allocateProvisional(); await ledger.commit(slot); console.log('opened:${path}'); process.on('SIGTERM', async()=>{await lease.close();process.exit()}); setInterval(()=>{},1000); } catch(e) { console.log('refused:'+e.message); }`;
  const child = await launchScript(root,script);
  const result = await new Promise<string>((resolve, reject) => { child.stdout!.once('data', chunk => resolve(String(chunk).trim())); child.stderr!.once('data', chunk => reject(new Error(String(chunk)))); child.once('error', reject); });
  return { child, result };
}
test('competing sidecar and investigator subprocesses cannot open the same credential ledger', async () => {
 const root = await mkdtemp(join(tmpdir(),'runtime-owner-')); roots.push(root); const state = join(root,'state');
 const first = await launcher(root,state); expect(first.result).toBe('opened:sidecar');
 expect((await launcher(root,state,'investigator')).result).toMatch(/refused:.*owned/);
});
test('same imported credential refuses an alternate local state directory', async () => {
 const root = await mkdtemp(join(tmpdir(),'runtime-owner-')); roots.push(root);
 expect((await launcher(root,join(root,'state'))).result).toBe('opened:sidecar');
 expect((await launcher(root,join(root,'alternate'),'starter')).result).toMatch(/refused:.*alternate directories/);
});
test('live owner is never displaced and verified dead owner can be recovered', async () => {
 const root = await mkdtemp(join(tmpdir(),'runtime-owner-')); roots.push(root); const state = join(root,'state');
 const first = await launcher(root,state);
 expect((await launcher(root,state,'coding-launcher')).result).toMatch(/refused:.*live process/);
 await new Promise<void>(resolve => { first.child.once('exit',()=>resolve()); first.child.kill('SIGKILL'); });
 expect((await launcher(root,state,'investigator')).result).toBe('opened:investigator');
});
test('competing crash recovery never displaces the newly acquired owner', async () => {
 const root = await mkdtemp(join(tmpdir(),'runtime-owner-')); roots.push(root); const state = join(root,'state');
 const first = await launcher(root,state);
 await new Promise<void>(resolve => { first.child.once('exit',()=>resolve()); first.child.kill('SIGKILL'); });
 const recovered = await Promise.all([launcher(root,state,'starter'), launcher(root,state,'investigator')]);
 expect(recovered.filter(entry => entry.result.startsWith('opened:'))).toHaveLength(1);
 expect((await launcher(root,state,'coding-launcher')).result).toMatch(/refused:/);
});
test('unreadable existing ledger stops startup before any slot can be allocated', async () => {
 const root = await mkdtemp(join(tmpdir(),'runtime-owner-')); roots.push(root); const state = join(root,'state');
 const { mkdir } = await import('node:fs/promises');
 await mkdir(join(state,'base-slots.json'), {recursive:true});
 const ledgerPath = fileURLToPath(new URL('./slot-ledger.ts',import.meta.url));
 const script = `import { BaseSlotLedger } from ${JSON.stringify(ledgerPath)}; try {const ledger = await BaseSlotLedger.open({path:${JSON.stringify(join(state,'base-slots.json'))}});console.log('allocated:'+ledger.allocateProvisional())} catch(e) {console.log('refused:'+e.code)}`;
 const child = await launchScript(root,script);
 const result = await new Promise<string>(resolve=>child.stdout!.once('data',chunk=>resolve(String(chunk).trim())));
 expect(result).toBe('refused:EISDIR');
});
test('failed investigator startup releases ownership without losing retired ledger slots', async () => {
 const root = await mkdtemp(join(tmpdir(),'runtime-owner-')); roots.push(root); const state = join(root,'state');
 const { generateSecret, computeCommitment } = await import('@zk-credits/shared/base');
 const secret = generateSecret();
 const credential = {secret:secret.toString('base64url'),commitment:await computeCommitment(secret),tierId:0,expiry:Math.floor(Date.now()/1000)+3600,deploymentDomain:'84532'};
 const modulePath = fileURLToPath(new URL('./local-x402-agent.ts',import.meta.url));
 const ownerPath = fileURLToPath(new URL('./runtime-owner.ts',import.meta.url));
 const ledgerPath = fileURLToPath(new URL('./slot-ledger.ts',import.meta.url));
 const script = ` const {createLocalX402Agent}=await import(${JSON.stringify(modulePath)}); const {acquireCredentialRuntimeLease}=await import(${JSON.stringify(ownerPath)}); const {BaseSlotLedger}=await import(${JSON.stringify(ledgerPath)}); const credential=${JSON.stringify(credential)}; const options={credential,stateDirectory:${JSON.stringify(state)},homeDirectory:${JSON.stringify(root)}}; const initial=await acquireCredentialRuntimeLease(options);const ledger=await BaseSlotLedger.open({path:initial.stateDirectory+'/base-slots.json'});await ledger.commit(ledger.allocateProvisional());await initial.close();try{await createLocalX402Agent({...options,credentialStore:{read:async()=>JSON.stringify({version:1,credential}),write:async()=>{}},environment:{ZK_CREDITS_ARTIFACT_DIR:'offline-invalid-artifacts',ZK_CREDITS_WITNESS_PATH:'offline-missing-witness'}})}catch{} const reopened=await acquireCredentialRuntimeLease(options);const restored=await BaseSlotLedger.open({path:reopened.stateDirectory+'/base-slots.json'});console.log('next-slot:'+restored.allocateProvisional());await reopened.close();`;
 const child=await launchScript(root,script);
 const result=await new Promise<string>((resolve,reject)=>{child.stdout!.once('data',chunk=>resolve(String(chunk).trim()));child.stderr!.once('data',chunk=>reject(new Error(String(chunk))))});
 expect(result).toBe('next-slot:1');
});
test('canonical state directory aliases still contend for the same ownership', async () => {
 const root = await mkdtemp(join(tmpdir(),'runtime-owner-')); roots.push(root); const state = join(root,'state');
 const first = await launcher(root,state);expect(first.result).toBe('opened:sidecar');
 const {symlink} = await import('node:fs/promises');await symlink(state,join(root,'alias'),'dir');
 expect((await launcher(root,join(root,'alias'),'starter')).result).toMatch(/refused:.*owned/);
});
test('real sidecar and coding CLI launchers refuse a held credential before opening the ledger', async () => {
 const root = await mkdtemp(join(tmpdir(),'runtime-owner-')); roots.push(root); const state = join(root,'state');
 const credential={secret:'synthetic-native-store-credential',deploymentDomain:'84532',expiry:2000000000};
 const ownerPath=fileURLToPath(new URL('./runtime-owner.ts',import.meta.url));
 const cliPath=fileURLToPath(new URL('./cli.ts',import.meta.url));
 const {codexProfilePath}=await import('./codex-profile.js');const {mkdir,writeFile}=await import('node:fs/promises');await mkdir(join(root,'.codex'));await writeFile(codexProfilePath(join(root,'.codex')), '# offline test profile');
 for(const args of [['serve'],['codex','--task-evidence','exec','implement a task']]) {
  const script=`const {acquireCredentialRuntimeLease}=await import(${JSON.stringify(ownerPath)});const lease=await acquireCredentialRuntimeLease({credential:${JSON.stringify(credential)},stateDirectory:${JSON.stringify(state)},homeDirectory:${JSON.stringify(root)}});process.env.ZK_CREDITS_HOME=${JSON.stringify(state)};process.env.CODEX_HOME=${JSON.stringify(join(root,'.codex'))};process.argv=[process.execPath,'offline-cli',...${JSON.stringify(args)}];await import(${JSON.stringify(cliPath)});process.on('beforeExit',async()=>{await lease.close()});`;
  const child=await launchScript(root,script,credential);
  const result=await new Promise<string>((resolve,reject)=>{child.stderr!.once('data',chunk=>resolve(String(chunk).trim()));child.once('error',reject)});
  expect(result).toContain('already owned by a live process');
  await new Promise<void>(resolve=>child.exitCode!==null?resolve():child.once('exit',()=>resolve()));
 }
});
test('real request-aware starter/investigator launch refuses ownership held by another local runtime', async () => {
 const root=await mkdtemp(join(tmpdir(),'runtime-owner-'));roots.push(root);const state=join(root,'state');
 const credential={secret:'synthetic-native-store-credential',deploymentDomain:'84532',expiry:2000000000};
 const ownerPath=fileURLToPath(new URL('./runtime-owner.ts',import.meta.url));
 const localPath=fileURLToPath(new URL('./local-x402-agent.ts',import.meta.url));
 const script=`const {acquireCredentialRuntimeLease}=await import(${JSON.stringify(ownerPath)});const {createLocalX402Agent}=await import(${JSON.stringify(localPath)});const lease=await acquireCredentialRuntimeLease({credential:${JSON.stringify(credential)},stateDirectory:${JSON.stringify(state)},homeDirectory:${JSON.stringify(root)}});try{await createLocalX402Agent({stateDirectory:${JSON.stringify(state)},homeDirectory:${JSON.stringify(root)},environment:{ZK_CREDITS_ARTIFACT_DIR:'offline-invalid-artifacts'}})}catch(e){console.log('refused:'+e.message)}await lease.close();`;
 const child=await launchScript(root,script,credential);
 const result=await new Promise<string>((resolve,reject)=>{child.stdout!.once('data',chunk=>resolve(String(chunk).trim()));child.stderr!.once('data',chunk=>reject(new Error(String(chunk))))});
 expect(result).toBe('refused:Credential runtime is already owned by a live process');
});
