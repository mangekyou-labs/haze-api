import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveRpc, runLiveInvestigation, formatLiveReport } from './live.mjs';

test('installed investigation refuses malformed input before accessing credentials or network', async () => {
  let accessed = false;
  for (const args of [[], ['--chain', 'ethereum', '0x' + '11'.repeat(32)], ['--chain', 'base', 'bad'], ['--chain', 'base', '0x' + '11'.repeat(32), '--gateway', 'evil']]) {
    await assert.rejects(runLiveInvestigation(args, { prepare: async () => { accessed = true; }, fetch: async () => { accessed = true; } }), /Usage/);
  }
  assert.equal(accessed, false);
});

test('live RPC verifies chain and bounds responses without reading fixture files', async () => {
  const calls = [];
  const rpc = createLiveRpc(8453, async (url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    return Response.json({ jsonrpc: '2.0', id: body.id, result: body.method === 'eth_chainId' ? '0x2105' : { hash: 'live' } });
  });
  assert.deepEqual(await rpc.transaction('0x' + '11'.repeat(32)), { hash: 'live' });
  assert.deepEqual(calls.map(c => c.method), ['eth_chainId', 'eth_getTransactionByHash']);
  assert.equal(rpc.provenance, 'live_rpc');
  const wrong = createLiveRpc(84532, async (_url, init) => Response.json({ jsonrpc: '2.0', id: JSON.parse(init.body).id, result: '0x2105' }));
  await assert.rejects(wrong.transaction('x'), /RPC chain/);
});

test('report distinguishes failed and unknown credits from confirmed paid consumption', () => {
  const output = formatLiveReport({ chainId: 8453, transactionHash: 'tx', investigationId: 'task', completion: 'partial', stoppingReason: 'insufficient_evidence', observedFacts: [{text:'Receipt records failed execution.',evidenceIds:['e1']}], supportedDiagnoses:[], hypotheses:[], suggestedChecks:[], missingEvidence:['original trace'], uncertainty:[], evidence:[], inference:{requests:1,confirmedCommitted:0,locallyRetiredSlots:1,unknownOutcomes:1}, paymentEvidence:{confirmed:0,failed:0,unknown:1,retired:1,challengeObserved:1,modelDeliveryObserved:false} });
  assert.match(output, /Confirmed consumed credits: 0/);
  assert.match(output, /Unknown outcomes: 1/);
  assert.match(output, /Base mainnet/);
  assert.match(output, /Base Sepolia/);
  assert.match(output, /e1/);
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIVE_DEFAULTS } from './.generated/live-defaults.mjs';

test('unknown paid outcome stops repair from authorizing another credit in the installed flow', async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'live-command-'));
  const hash = '0x' + '11'.repeat(32), blockHash = '0x' + '22'.repeat(32);
  let authorized = 0, closed = false;
  const fetcher = async (_url, init) => {
    if (init?.body) {
      const body = JSON.parse(init.body);
      const results = { eth_chainId:'0x2105', eth_getTransactionByHash:{hash,chainId:'0x2105',blockHash,blockNumber:'0x1'}, eth_getTransactionReceipt:{transactionHash:hash,blockHash,blockNumber:'0x1',status:'0x0',logs:[]},eth_getBlockByNumber:{hash:blockHash,number:'0x1'} };
      return Response.json({jsonrpc:'2.0',id:body.id,result:results[body.method]});
    }
    return new Response('',{status:404});
  };
  const terms = { scheme:'zk-prepaid',network:'eip155:84532',amount:'1',asset:'coding-deepseek-v4-flash-v1',payTo:LIVE_DEFAULTS.inference.recipient,maxTimeoutSeconds:300,
    extra:{deploymentDomain:'84532',contract:LIVE_DEFAULTS.inference.contract,circuit:LIVE_DEFAULTS.inference.circuit,verifyingKey:LIVE_DEFAULTS.inference.verifyingKey,issuedAt:Math.floor(Date.now()/1000),assetTransferMethod:'prepaid-claim',paymentFlow:'escrow',requirementsVersion:'zk-prepaid-v1'} };
  try {
    const report = await runLiveInvestigation(['--chain','base',hash], {stateDirectory,fetch:fetcher,
      prepare:async () => ({credentialExpiry:2000000000,lease:{stateDirectory,close:async()=>{}},
        open:async authorization=>({close:async()=>{closed=true;},client:{fetch:async (url,init)=>{
          const attemptId='attempt-'+authorized;
          await authorization.beforeProof({attemptId,url,method:'POST',body:Buffer.from(init.body),requirements:terms});
          authorized++;
          await authorization.observe({type:'retired',attemptId,slot:authorized-1});
          await authorization.observe({type:'settlement',attemptId,slot:authorized-1,outcome:'unknown'});
          return Response.json({choices:[{message:{content:'invalid JSON'}}]});
        }}})}) });
    assert.equal(authorized,1);
    assert.equal(report.paymentEvidence.confirmed,0);
    assert.equal(report.paymentEvidence.unknown,1);
    assert.equal(closed,true);
  } finally {await rm(stateDirectory,{recursive:true,force:true});}
});

test('live original revert uses the failed root rather than a caught child error', async () => {
  const transactionHash = '0x' + '33'.repeat(32), blockHash = '0x' + '44'.repeat(32);
  const rootData = '0x08c379a0' + '00'.repeat(64), childData = '0x08c379a0' + '11'.repeat(64);
  let call_trace = [{error:'execution reverted',output:rootData}, {trace_address:[0],error:'execution reverted',output:childData}];
  const rpc = createLiveRpc(8453, async () => Response.json({hash:transactionHash,block_hash:blockHash,block_number:1,network_id:8453,status:false,call_trace}));
  const binding = {transactionHash,blockHash,blockNumber:'0x1'};
  assert.equal((await rpc.revert(binding)).data, rootData);
  call_trace = [{output:'0x'}, {trace_address:[0],error:'execution reverted',output:childData}];
  await assert.rejects(rpc.revert(binding), /Original .*evidence unavailable/);
});


test('recovered unknown and live RPC failures retain actionable report guidance', () => {
  const report = {chainId:8453,transactionHash:'tx',investigationId:'task',completion:'partial',stoppingReason:'rpc_unavailable',inference:{authorizedAllocation:1,confirmedCommitted:0,unknownOutcomes:1},paymentEvidence:{confirmed:0,failed:0,unknown:0,retired:0,recoveredPriorTask:true}};
  const output = formatLiveReport(report);
  assert.match(output, /check transaction availability/i);
  assert.match(output, /resolve the unknown outcome/i);
  assert.match(output, /prior unknown outcomes: 1/i);
  report.stoppingReason = 'inference_unavailable';
  report.paymentEvidence.confirmed = 1;
  assert.doesNotMatch(formatLiveReport(report), /No confirmed payment/);
});
