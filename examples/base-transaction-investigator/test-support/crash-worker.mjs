import { createInvestigator } from "../investigator.mjs";
import { BaseSlotLedger } from "../.generated/slot-ledger.mjs";
import { join } from "node:path";
const [stateDir, stage] = process.argv.slice(2);
const hash = "0x" + "11".repeat(32),
  blockHash = "0x" + "22".repeat(32);
const pause = async (at) => {
  if (stage === at) {
    process.send({ stage: at });
    await new Promise(() => {});
  }
};
const policy = {
  inference: {
    gateway: "https://gateway.invalid/v1/chat/completions",
    deploymentDomain: "84532",
    contract: "bond",
    recipient: "treasury",
    serviceClass: "coding-deepseek-v4-flash-v1",
    circuit: "circuit",
    verifyingKey: "key",
    credentialExpiry: 2000000000,
  },
};
const terms = {
  scheme: "zk-prepaid",
  network: "eip155:84532",
  amount: "1",
  asset: policy.inference.serviceClass,
  payTo: "treasury",
  maxTimeoutSeconds: 300,
  extra: {
    deploymentDomain: "84532",
    contract: "bond",
    circuit: "circuit",
    verifyingKey: "key",
    issuedAt: 1700000000,
    assetTransferMethod: "prepaid-claim",
    paymentFlow: "escrow",
    requirementsVersion: "zk-prepaid-v1",
  },
};
const rpc = {
  transaction: async () => ({
    hash,
    chainId: 8453,
    blockNumber: "0x1",
    blockHash,
  }),
  receipt: async () => ({
    transactionHash: hash,
    status: "0x0",
    blockNumber: "0x1",
    blockHash,
    logs: [],
  }),
  block: async () => ({ number: "0x1", hash: blockHash }),
};
if (stage === "purchase_exposure") {
  const endpoint = "https://fixture.invalid/trace",
    asset = "0x" + "66".repeat(20),
    payee = "0x" + "77".repeat(20);
  const runtime = await createInvestigator({
    stateDir,
    rpc,
    policy: {
      executionDataPaymentChain: 84532,
      trace: { endpoint, method: "POST", asset, payee },
    },
    provider: {
      paymentMode: "simulated",
      quote: async (request) => ({
        endpoint,
        method: "POST",
        request,
        scheme: "exact",
        network: "eip155:84532",
        asset,
        payTo: payee,
        amount: "1000",
        assetTransferMethod: "eip3009",
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      }),
      acquire: async () => {
        await pause("purchase_exposure");
      },
    },
  });
  await runtime.investigate({
    schemaVersion: 1,
    chainId: 8453,
    transactionHash: hash,
  });
  process.exit(0);
}
const runtime = await createInvestigator({
  stateDir,
  rpc,
  policy,
  clock: () => 1700000000000,
  inferenceFactory: async ({ authorization }) => {
    const ledger = await BaseSlotLedger.open({
      path: join(stateDir, "base-slots.json"),
    });
    return {
      close: async () => {},
      client: {
        fetch: async (url, init) => {
          await pause("before_reservation");
          await authorization.beforeProof({
            attemptId: "offline-attempt",
            url,
            method: init.method,
            body: Buffer.from(init.body),
            requirements: terms,
          });
          await pause("after_reservation");
          const slot = ledger.allocateProvisional();
          await authorization.observe({
            attemptId: "offline-attempt",
            type: "provisional",
            slot,
          });
          // Injected offline proof boundary. No cryptographic proof, credential or network call.
          await pause("after_proof");
          await ledger.commit(slot);
          await pause("after_retirement");
          await authorization.observe({
            attemptId: "offline-attempt",
            type: "retired",
            slot,
          });
          await pause("after_authorization");
          await authorization.observe({
            attemptId: "offline-attempt",
            type: "settlement",
            outcome: "confirmed",
          });
          await pause("after_outcome");
          throw Error("unreachable");
        },
      },
    };
  },
});
process.send({ ready: true });
await runtime.investigate({
  schemaVersion: 1,
  chainId: 8453,
  transactionHash: hash,
});
