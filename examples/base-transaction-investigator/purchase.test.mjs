import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInvestigator } from "./investigator.mjs";
const hash = "0x" + "11".repeat(32),
  blockHash = "0x" + "22".repeat(32);
const input = { schemaVersion: 1, chainId: 8453, transactionHash: hash };
const trace = {
  type: "CALL",
  from: "0x" + "33".repeat(20),
  to: "0x" + "44".repeat(20),
  input: "0x",
  output: "0x",
  error: "execution reverted",
  calls: [
    {
      type: "CALL",
      from: "0x" + "44".repeat(20),
      to: "0x" + "55".repeat(20),
      input: "0x",
      output: "0x",
      error: "execution reverted",
    },
  ],
};
async function setup({
  quote = {},
  result = {},
  traceValue = trace,
  rpcExtra = {},
  policyExtra = {},
  acquire,
  quoteRequest,
  clock,
  reconciliation,
} = {}) {
  const counts = { quotes: 0, acquires: 0, signatures: 0 };
  const terms = {
    endpoint: "https://fixture.invalid/trace",
    method: "POST",
    scheme: "exact",
    network: "eip155:84532",
    asset: "0x" + "66".repeat(20),
    payTo: "0x" + "77".repeat(20),
    amount: "1000",
    assetTransferMethod: "eip3009",
    expiresAt: Math.floor(Date.now() / 1000) + 60,
    ...quote,
  };
  const runtime = await createInvestigator({
    stateDir: await mkdtemp(join(tmpdir(), "trace-")),
    ...(clock ? { clock } : {}),
    rpc: {
      transaction: async () => ({
        hash,
        chainId: 8453,
        blockHash,
        blockNumber: "0x1",
      }),
      receipt: async () => ({
        transactionHash: hash,
        blockHash,
        blockNumber: "0x1",
        status: "0x0",
        logs: [],
      }),
      block: async () => ({ hash: blockHash, number: "0x1" }),
      ...rpcExtra,
    },
    policy: {
      executionDataPaymentChain: 84532,
      trace: {
        endpoint: "https://fixture.invalid/trace",
        method: "POST",
        asset: "0x" + "66".repeat(20),
        payee: "0x" + "77".repeat(20),
        ...policyExtra,
      },
    },
    provider: {
      paymentMode: "simulated",
      provenance: "synthetic",
      quote: async (request) => {
        counts.quotes++;
        if (quoteRequest) return quoteRequest({ ...terms, request });
        return { ...terms, request };
      },
      ...(reconciliation ?? {}),
      acquire: async ({ attemptId, terms }) => {
        counts.acquires++;
        if (acquire) return acquire({ attemptId, terms });
        return {
          settlementObservation: { attemptId, terms, outcome: "confirmed" },
          trace: traceValue,
          ...result,
        };
      },
    },
    signer: () => {
      counts.signatures++;
      throw Error("real signing forbidden");
    },
  });
  return { runtime, counts };
}
test("one bounded simulated trace establishes a cited nested failure without claiming its cause", async () => {
  const { runtime, counts } = await setup();
  const r = await runtime.investigate(input);
  assert.equal(r.purchase.simulatedMinorUnits, 1000);
  assert.equal(r.purchase.liveMinorUnits, 0);
  assert.equal(r.purchaseAttempts[0].delivery, "validated");
  assert.equal(r.purchaseAttempts[0].settlement, "confirmed");
  assert.ok(r.purchaseAttempts[0].rationale.question);
  assert.equal(r.failingCall.reference, "calls.0");
  assert.equal(r.diagnosis, "supported");
  assert.match(r.text, /underlying cause/);
  assert.deepEqual(counts, { quotes: 1, acquires: 1, signatures: 0 });
  assert.equal(
    (await runtime.journal())[0].purchaseAttempts[0].delivery,
    "validated",
  );
});
for (const [name, quote, policyExtra] of [
  ["wrong chain", { network: "eip155:8453" }, {}],
  ["wrong token", { asset: "0x" + "99".repeat(20) }, {}],
  ["wrong payee", { payTo: "0x" + "99".repeat(20) }, {}],
  ["Permit2", { assetTransferMethod: "permit2" }, {}],
  ["extensions", { extensions: {} }, {}],
  ["oversized quote", { amount: "5001" }, {}],
  ["insufficient budget", { amount: "1000" }, { maxExposureMinorUnits: 999 }],
  ["expired quote", { expiresAt: 1 }, {}],
  ["redirect", { redirected: true }, {}],
  ["changed method", { method: "GET" }, {}],
  ["changed endpoint", { endpoint: "https://evil.invalid/trace" }, {}],
])
  test(`refused ${name} produces no acquisition or authorization`, async () => {
    const { runtime, counts } = await setup({ quote, policyExtra });
    const r = await runtime.investigate(input);
    assert.equal(counts.acquires, 0);
    assert.equal(counts.signatures, 0);
    assert.equal(r.purchase.authorizedExposureMinorUnits, 0);
    assert.equal(
      (await runtime.journal())[0].purchaseAttempts[0]
        .authorizationExposureMinorUnits,
      0,
    );
  });
for (const [name, traceValue] of [
  ["wrong transaction", { ...trace, transactionHash: "0x" + "99".repeat(32) }],
  ["wrong block", { ...trace, blockHash: "0x" + "99".repeat(32) }],
  ["malformed trace", { type: "CALL" }],
  [
    "invalid decode",
    { ...trace, output: "0x08c379a0", decodedError: "forged" },
  ],
])
  test(`${name} cannot support a diagnosis after confirmed simulated payment`, async () => {
    const { runtime, counts } = await setup({ traceValue });
    const r = await runtime.investigate(input);
    assert.equal(counts.acquires, 1);
    assert.equal(r.purchaseAttempts[0].settlement, "confirmed");
    assert.equal(r.purchaseAttempts[0].delivery, "invalid");
    assert.equal(r.supportedDiagnoses.length, 0);
    assert.equal(r.purchase.simulatedMinorUnits, 1000);
  });
test("validated original public error skips trace purchase", async () => {
  const data =
    "0x08c379a0" +
    "0".repeat(62) +
    "20" +
    "0".repeat(63) +
    "1" +
    "61" +
    "0".repeat(62);
  const { runtime, counts } = await setup({
    rpcExtra: {
      revert: async () => ({
        kind: "original_execution",
        transactionHash: hash,
        chainId: 8453,
        blockHash,
        atBlock: "0x1",
        data,
      }),
    },
  });
  await runtime.investigate(input);
  assert.equal(counts.quotes, 0);
  assert.equal(counts.acquires, 0);
});
test("duplicate completed investigation reuses validated trace without a second purchase", async () => {
  const { runtime, counts } = await setup();
  const first = await runtime.investigate(input);
  const second = await runtime.investigate(input);
  assert.equal(counts.acquires, 1);
  assert.equal(
    second.evidence.find((e) => e.operation === "call_trace").contentDigest,
    first.evidence.find((e) => e.operation === "call_trace").contentDigest,
  );
  assert.equal(second.purchase.authorizedExposureMinorUnits, 0);
});
test("unbound settlement cannot confirm spend or release exposed budget", async () => {
  const { runtime } = await setup({
    result: {
      settlement: "failed",
      settlementObservation: { attemptId: "another", outcome: "failed" },
    },
  });
  const r = await runtime.investigate(input);
  assert.equal(r.purchaseAttempts[0].settlement, "unknown");
  assert.equal(r.purchase.authorizedExposureMinorUnits, 1000);
  assert.equal(r.purchase.simulatedMinorUnits, 0);
  assert.equal((await runtime.journal())[0].resolved, false);
});
test("provider errors are redacted from reports and durable journal", async () => {
  const { runtime } = await setup({
    traceValue: { ...trace, error: { secret: "credential-secret" } },
  });
  const r = await runtime.investigate(input);
  assert.equal(JSON.stringify(r).includes("credential-secret"), false);
  assert.equal(
    JSON.stringify(await runtime.journal()).includes("credential-secret"),
    false,
  );
});
test("recorded authentic Sepolia failures preserve identities and remain partial without original execution", async () => {
  const { readFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const manifest = JSON.parse(
    await readFile(
      new URL("./fixtures/owner-rpc-manifest.json", import.meta.url),
      "utf8",
    ),
  );
  for (const item of manifest.fixtures) {
    const bytes = await readFile(
      new URL(`./fixtures/${item.artifact}`, import.meta.url),
    );
    assert.equal(createHash("sha256").update(bytes).digest("hex"), item.sha256);
    const f = JSON.parse(bytes);
    const tx = f.transaction.response.result,
      receipt = f.receipt.response.result,
      block = f.block.response.result;
    const runtime = await createInvestigator({
      stateDir: await mkdtemp(join(tmpdir(), "authentic-")),
      rpc: {
        provenance: "recorded_authentic",
        transaction: async () => tx,
        receipt: async () => receipt,
        block: async () => block,
        ...(f.historicalReplay?.response?.error?.data
          ? {
              revert: async () => ({
                kind: "historical_replay",
                atBlock: tx.blockNumber,
                transactionHash: tx.hash,
                chainId: 84532,
                blockHash: tx.blockHash,
                data: f.historicalReplay.response.error.data,
              }),
            }
          : {}),
      },
    });
    const r = await runtime.investigate({
      schemaVersion: 1,
      chainId: 84532,
      transactionHash: item.transactionHash,
    });
    assert.equal(r.observedFacts[0].value, "failed");
    assert.equal(r.diagnosis, "insufficient_evidence");
    assert.equal(r.evidence[0].provenance, "recorded_authentic");
    assert.equal(f.trace.response.error.code, -32601);
    if (item.artifact === "sepolia-authentic-1.json")
      assert.equal(r.observedFacts.at(-1).value, "RO#7");
  }
});
for (const [name, traceValue] of [
  [
    "depth limit",
    (() => {
      let value = trace;
      for (let i = 0; i < 128; i++) value = { ...trace, calls: [value] };
      return value;
    })(),
  ],
  [
    "node limit",
    {
      ...trace,
      calls: Array.from({ length: 10000 }, () => ({ ...trace, calls: [] })),
    },
  ],
  ["response byte limit", { ...trace, input: "0x" + "00".repeat(2097152) }],
])
  test(`${name} rejects evidence instead of silently truncating`, async () => {
    const { runtime, counts } = await setup({ traceValue });
    const r = await runtime.investigate(input);
    assert.equal(counts.acquires, 1);
    assert.equal(r.supportedDiagnoses.length, 0);
    assert.equal(r.purchaseAttempts[0].delivery === "validated", false);
    assert.ok(
      r.validationFailures.some((x) =>
        ["trace_resource_limit", "evidence_size_limit"].includes(x),
      ),
    );
  });

test("ambiguous purchase remains held and repeated transaction cannot authorize replacement", async () => {
  const { runtime, counts } = await setup({ acquire: async () => { throw Error("timeout"); } });
  const first = await runtime.investigate(input);
  const second = await runtime.investigate(input);
  assert.equal(first.purchase.authorizedExposureMinorUnits, 1000);
  assert.equal(first.purchase.heldMinorUnits, 1000);
  assert.equal(second.stoppingReason, "unresolved_purchase");
  assert.equal(second.purchase.heldMinorUnits, 1000);
  assert.equal(counts.acquires, 1);
  assert.equal(counts.quotes, 1);
  assert.equal((await runtime.journal())[0].purchaseAttempts[0].settlement, "unknown");
});
test("documented nonauthorizing status checks are bounded and can confirm paid but missing delivery", async () => {
  let checks = 0;
  const { runtime, counts } = await setup({
    acquire: async () => { throw Error("timeout"); },
    reconciliation: {
      reconciliation: { nonauthorizing: true, documentation: "https://fixture.invalid/status-contract" },
      reconcile: async ({ attemptId, terms }) => {
        checks++;
        return { settlementObservation: { attemptId, terms, outcome: "confirmed" } };
      },
    },
  });
  const r = await runtime.investigate(input);
  assert.equal(checks, 1);
  assert.equal(counts.acquires, 1);
  assert.equal(r.purchase.simulatedMinorUnits, 1000);
  assert.equal(r.purchase.heldMinorUnits, 0);
  assert.equal(r.purchaseAttempts[0].delivery, "missing");
  assert.equal(r.stoppingReason, "paid_but_unusable");
  assert.equal((await runtime.journal())[0].purchaseAttempts[0].settlement, "confirmed");
});
test("unbound reconciliation stays unknown within remaining tool budget and reserves canonical recheck", async () => {
  let checks = 0;
  const { runtime, counts } = await setup({
    acquire: async () => { throw Error("timeout"); },
    reconciliation: {
      reconciliation: { nonauthorizing: true, documentation: "https://fixture.invalid/status-contract" },
      reconcile: async () => { checks++; return { settlementObservation: { attemptId: "wrong", outcome: "failed" } }; },
    },
  });
  const r = await runtime.investigate(input);
  assert.equal(checks, 2);
  assert.equal(r.toolInvocations, 8);
  assert.equal(r.purchase.heldMinorUnits, 1000);
  assert.equal(r.purchaseAttempts[0].settlement, "unknown");
  assert.equal(r.evidence.every(e => e.validation === "valid"), true);
  assert.equal(counts.acquires, 1);
});
test("undocumented provider status support is never called", async () => {
  let checks = 0;
  const { runtime } = await setup({ acquire: async () => { throw Error("aborted"); }, reconciliation: {
    reconcile: async () => { checks++; throw Error("must not run"); },
  }});
  const r = await runtime.investigate(input);
  assert.equal(checks, 0);
  assert.equal(r.purchase.heldMinorUnits, 1000);
  assert.equal(r.purchaseAttempts[0].settlement, "unknown");
});
test("definitive failed settlement releases held reservation without erasing historical exposure", async () => {
  const { runtime } = await setup({ acquire: async ({ attemptId, terms }) => ({
    settlementObservation: { attemptId, terms, outcome: "failed" },
  })});
  const r = await runtime.investigate(input);
  assert.equal(r.purchase.heldMinorUnits, 0);
  assert.equal(r.purchase.simulatedMinorUnits, 0);
  assert.equal(r.purchase.authorizedExposureMinorUnits, 0);
  assert.equal(r.purchaseAttempts[0].reservedMinorUnits, 0);
  assert.equal(r.purchaseAttempts[0].authorizationExposureMinorUnits, 1000);
});

test("deadline before exposure releases unsigned reservation without an acquisition", async () => {
  let now = Date.now();
  const { runtime, counts } = await setup({ clock: () => now, quoteRequest: async terms => {
    now += 120000;
    return terms;
  }});
  const r = await runtime.investigate(input);
  assert.equal(counts.acquires, 0);
  assert.equal(r.purchase.authorizedExposureMinorUnits, 0);
  assert.equal(r.purchaseAttempts[0].reservedMinorUnits, 0);
});
test("abort after possible authorization exposure does not release held spend", async () => {
  let now = Date.now(), checks = 0;
  const { runtime, counts } = await setup({ clock: () => now, acquire: async () => {
    now += 120000;
    throw Error("HTTP aborted");
  }, reconciliation: {
    reconciliation: { nonauthorizing: true, documentation: "https://fixture.invalid/status-contract" },
    reconcile: async () => { checks++; return {}; },
  }});
  const r = await runtime.investigate(input);
  assert.equal(counts.acquires, 1);
  assert.equal(checks, 0);
  assert.equal(r.purchase.heldMinorUnits, 1000);
  assert.equal(r.purchaseAttempts[0].settlement, "unknown");
  assert.equal((await runtime.journal())[0].resolved, false);
});
test("bound confirmed settlement remains paid when delivery redirects or changes", async () => {
  const { runtime } = await setup({ result: { redirected: true } });
  const r = await runtime.investigate(input);
  assert.equal(r.purchase.simulatedMinorUnits, 1000);
  assert.equal(r.purchase.heldMinorUnits, 0);
  assert.equal(r.purchaseAttempts[0].settlement, "confirmed");
  assert.equal(r.purchaseAttempts[0].delivery, "invalid");
  assert.equal(r.stoppingReason, "paid_but_unusable");
});
test("paid unusable trace never authorizes a replacement on the same transaction", async () => {
  const { runtime, counts } = await setup({ traceValue: undefined, acquire: async ({ attemptId, terms }) => ({
    settlementObservation: { attemptId, terms, outcome: "confirmed" },
  }) });
  const first = await runtime.investigate(input);
  const second = await runtime.investigate(input);
  assert.equal(first.stoppingReason, "paid_but_unusable");
  assert.equal(second.stoppingReason, "paid_but_unusable");
  assert.equal(second.purchase.simulatedMinorUnits, 1000);
  assert.equal(second.purchase.heldMinorUnits, 0);
  assert.equal(counts.acquires, 1);
});
test("partial explanation includes separate simulated held cost and delivery status", async () => {
  const { runtime } = await setup({ acquire: async () => { throw Error("timeout"); } });
  const r = await runtime.investigate(input);
  assert.match(r.text, /1000 simulated USDC minor units held/);
  assert.match(r.text, /settlement unknown; delivery missing/);
  assert.equal(r.inference.locallyRetiredSlots, 0);
});
