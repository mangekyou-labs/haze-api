import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInvestigator } from './investigator.mjs';
async function setup(options = {}, attempt = {}, inferenceAttempts = []) {
 const stateDir = await mkdtemp(join(tmpdir(), 'owner-reconcile-'));
 await writeFile(join(stateDir,'journal.json'),JSON.stringify([{schemaVersion:1,investigationId:'existing',chainId:8453,transactionHash:'0x'+'11'.repeat(32),purchaseAttempts:[{attemptId:'purchase-1',state:'exposed',settlement:'unknown',delivery:'missing',terms:{amount:'1000'},reservedMinorUnits:1000,authorizationExposureMinorUnits:1000,...attempt}],inferenceAttempts,evidence:[]}]));
 return createInvestigator({stateDir,...options});
}
test('owner can confirm an existing purchase without restarting authorizing work or changing delivery',async()=>{
 let checks=0;
 const runtime=await setup({provider:{reconciliation:{nonauthorizing:true,documentation:'https://fixture.invalid/status'},reconcile:async request=>{checks++;return {settlementObservation:{attemptId:request.attemptId,terms:request.terms,outcome:'confirmed'}}}},inferenceFactory:async()=>{throw Error('must not open')}});
 try {
 const result=await runtime.reconcile({investigationId:'existing',attemptId:'purchase-1'});
 assert.equal(result.report.purchase.simulatedMinorUnits,1000);
 assert.equal(result.report.purchase.heldMinorUnits,0);
 assert.equal(result.report.purchaseAttempts[0].delivery,'missing');
 assert.equal(result.journal[0].purchaseAttempts[0].settlement,'confirmed');
 assert.equal(result.session.checks,1);assert.equal(checks,1);
 }finally{await runtime.close()}
});
test('unsupported status preserves held exposure and performs no checks',async()=>{
 const runtime=await setup({provider:{reconcile:async()=>{throw Error('forbidden')}}});
 try{const r=await runtime.reconcile({investigationId:'existing',attemptId:'purchase-1'});assert.equal(r.session.checks,0);assert.equal(r.report.purchase.heldMinorUnits,1000)}finally{await runtime.close()}
});
test('malformed and mismatched observations are bounded per session, not by previous task checks',async()=>{
 let checks=0;
 const runtime=await setup({provider:{reconciliation:{nonauthorizing:true,documentation:'https://fixture.invalid/status'},reconcile:async()=>{checks++;return {settlementObservation:{attemptId:'another',terms:{amount:'1000'},outcome:'failed'}}}}},{reconciliationChecks:3});
 try{for(let i=0;i<2;i++){const r=await runtime.reconcile({investigationId:'existing',attemptId:'purchase-1'});assert.equal(r.session.checks,3);assert.equal(r.session.toolInvocations,3);assert.equal(r.report.purchase.heldMinorUnits,1000)}assert.equal(checks,6)}finally{await runtime.close()}
});
test('definitive failure releases purchase hold without changing delivery or accepting contradictory later status',async()=>{
 let checks=0;
 const runtime=await setup({provider:{reconciliation:{nonauthorizing:true,documentation:'https://fixture.invalid/status'},reconcile:async request=>{checks++;return{settlementObservation:{...request,outcome:'failed'}}}}});
 try{const r=await runtime.reconcile({investigationId:'existing',attemptId:'purchase-1'});assert.equal(r.report.purchase.heldMinorUnits,0);assert.equal(r.report.purchaseAttempts[0].delivery,'missing');await runtime.reconcile({investigationId:'existing',attemptId:'purchase-1'});assert.equal(checks,1)}finally{await runtime.close()}
});
test('status crossing the deadline cannot release exposure',async()=>{
 let now=0;
 const runtime=await setup({clock:()=>now,provider:{reconciliation:{nonauthorizing:true,documentation:'https://fixture.invalid/status'},reconcile:async request=>{now=120000;return{settlementObservation:{...request,outcome:'failed'}}}}});
 try{const r=await runtime.reconcile({investigationId:'existing',attemptId:'purchase-1'});assert.equal(r.session.checks,1);assert.equal(r.session.stoppingReason,'deadline');assert.equal(r.report.purchase.heldMinorUnits,1000)}finally{await runtime.close()}
});
test('reconciliation excludes concurrent investigation, recovery and close',async()=>{
 let release;
 const runtime=await setup({provider:{reconciliation:{nonauthorizing:true,documentation:'https://fixture.invalid/status'},reconcile:request=>new Promise(resolve=>{release=()=>resolve({settlementObservation:{...request,outcome:'confirmed'}})})}});
 const pending=runtime.reconcile({investigationId:'existing',attemptId:'purchase-1'});
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(runtime.recover('existing'),/already_active/);
 await assert.rejects(runtime.investigate({}),/already_active/);
 await assert.rejects(runtime.close(),/already_active/);
 release();await pending;await runtime.close();
 await assert.rejects(runtime.reconcile({investigationId:'existing',attemptId:'purchase-1'}),/closed/);
});
for(const outcome of ['confirmed','failed'])test(`documented bound inference ${outcome} leaves the slot permanently retired`,async()=>{
 let checks=0;
 const inference={attemptId:'inference-1',state:'retired',outcome:'unknown',slot:2,requestDigest:'a'.repeat(64),terms:{asset:'fixed'},reservationId:'reservation-1'};
 const runtime=await setup({inferenceStatus:{reconciliation:{nonauthorizing:true,documentation:'https://fixture.invalid/status'},reconcile:async request=>{checks++;return {settlementObservation:{...request,outcome}}}},inferenceFactory:async()=>{throw Error('forbidden')}},{},[inference]);
 try{const result=await runtime.reconcile({investigationId:'existing',attemptId:'inference-1'});assert.equal(result.report.inference.locallyRetiredSlots,1);assert.equal(result.report.inference.confirmedCommitted,outcome==='confirmed'?1:0);assert.equal(result.report.inference.unknownOutcomes,0);assert.equal(result.journal[0].inferenceAttempts[0].state,'retired');await runtime.reconcile({investigationId:'existing',attemptId:'inference-1'});assert.equal(checks,1)}finally{await runtime.close()}
});
test('inference receipt must bind request digest, accepted terms and reservation identity',async()=>{
 const runtime=await setup({inferenceStatus:{reconciliation:{nonauthorizing:true,documentation:'https://fixture.invalid/status'},reconcile:async request=>({settlementObservation:{...request,requestDigest:'wrong',outcome:'confirmed'}})}},{},[{attemptId:'inference-1',state:'retired',outcome:'unknown',slot:2,requestDigest:'a'.repeat(64),terms:{asset:'fixed'},reservationId:'reservation-1'}]);
 try{const r=await runtime.reconcile({investigationId:'existing',attemptId:'inference-1'});assert.equal(r.session.checks,3);assert.equal(r.report.inference.confirmedCommitted,0);assert.equal(r.report.inference.unknownOutcomes,1)}finally{await runtime.close()}
});
test('durable status write failure cannot expose an uncommitted definitive outcome',async()=>{
 const { rm, mkdir }=await import('node:fs/promises');
 const stateDir=await mkdtemp(join(tmpdir(),'reconcile-write-'));
 await writeFile(join(stateDir,'journal.json'),JSON.stringify([{schemaVersion:1,investigationId:'existing',purchaseAttempts:[{attemptId:'purchase-1',settlement:'unknown',delivery:'missing',terms:{amount:'1000'},reservedMinorUnits:1000,authorizationExposureMinorUnits:1000}],inferenceAttempts:[],evidence:[]}]));
 const runtime=await createInvestigator({stateDir,provider:{reconciliation:{nonauthorizing:true,documentation:'https://fixture.invalid/status'},reconcile:async request=>{await rm(join(stateDir,'journal.json'));await mkdir(join(stateDir,'journal.json'));return{settlementObservation:{...request,outcome:'confirmed'}}}}});
 try{await assert.rejects(runtime.reconcile({investigationId:'existing',attemptId:'purchase-1'}),/local_persistence_failed/);assert.equal((await runtime.journal())[0].purchaseAttempts[0].settlement,'unknown')}finally{await runtime.close()}
});
