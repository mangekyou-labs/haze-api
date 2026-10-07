import { it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCredential, generateSecret } from "@zk-credits/shared/base";
import {
  buildPaymentRequired,
  encodeHeader,
  PAYMENT_RESPONSE_HEADER,
} from "@zk-credits/x402-zk-prepaid";
import { createBasePrepaidClient } from "./base-sidecar.js";
import { BaseSlotLedger } from "./slot-ledger.js";
// The controller is an example-local interface, not a published SDK export.
import { build } from "esbuild";
const hash = "0x" + "11".repeat(32),
  blockHash = "0x" + "22".repeat(32),
  gateway = "https://api.test/v1/chat/completions";

it("investigator uses real request-bound prepaid transport and validated commit observations without buying a trace", async () => {
  await build({
    entryPoints: [
      new URL("../../../ts/service-class.ts", import.meta.url).pathname,
    ],
    outfile: new URL(
      "../../../examples/base-transaction-investigator/.generated/service-class.mjs",
      import.meta.url,
    ).pathname,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
  });
  const { createInvestigator } =
    await import("../../../examples/base-transaction-investigator/investigator.mjs");
  const now = Date.now();
  const requirements = {
    scheme: "zk-prepaid" as const,
    network: "eip155:84532" as const,
    amount: "1" as const,
    asset: "coding-deepseek-v4-flash-v1",
    payTo: "0x00000000000000000000000000000000000000b2",
    maxTimeoutSeconds: 300,
    extra: {
      assetTransferMethod: "prepaid-claim" as const,
      paymentFlow: "escrow" as const,
      circuit: "private-credit-spend-bn254-v1",
      verifyingKey: "dev-sepolia-v1",
      deploymentDomain: "84532",
      contract: "0x00000000000000000000000000000000000000a1",
      requirementsVersion: "zk-prepaid-v1",
      issuedAt: Math.floor(now / 1000),
    },
  };
  const fixture = JSON.parse(
    await readFile(
      new URL(
        "../../../examples/base-transaction-investigator/fixtures/recorded-revert.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const stateDir = await mkdtemp(join(tmpdir(), "controller-transport-"));
  const ledger = await BaseSlotLedger.open({});
  let proofs = 0,
    paid = 0;
  let firstBody = "";
  const credential = await createCredential(
    generateSecret(),
    0,
    Math.floor(now / 1000) + 3600,
    "84532",
  );
  const runtime = await createInvestigator({
    stateDir,
    clock: () => now,
    policy: {
      executionDataPaymentChain: 84532,
      inference: {
        gateway,
        deploymentDomain: "84532",
        contract: requirements.extra.contract,
        recipient: requirements.payTo,
        serviceClass: requirements.asset,
        circuit: requirements.extra.circuit,
        verifyingKey: requirements.extra.verifyingKey,
        credentialExpiry: credential.expiry,
      },
    },
    rpc: {
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
      revert: async () => ({
        kind: "original_execution",
        atBlock: "0x1",
        transactionHash: hash,
        chainId: 8453,
        blockHash,
        data: fixture.replay.data,
      }),
    },
    inferenceFactory: async ({ authorization }: any) => {
      const prepaid = createBasePrepaidClient({
        credential,
        slotLedger: ledger,
        authorization,
        witnessProvider: {
          witnessForCredential: async () => ({
            root: "123",
            pathElements: Array(20).fill("0"),
            pathIndices: Array(20).fill(0),
            expiry: credential.expiry,
          }),
        },
        prove: async (_input, context) => {
          proofs++;
          const journal = JSON.parse(
            await readFile(join(stateDir, "journal.json"), "utf8"),
          );
          expect(journal.at(-1).inferenceAttempts[0].state).toBe("provisional");
          expect(context.requirements).toEqual(requirements);
          return {
            proof: {},
            publicSignals: [...context.expectedPublicSignals],
          };
        },
        fetch: async (_url, init) => {
          const body =
            typeof init?.body === "string"
              ? init.body
              : Buffer.from(init?.body as Uint8Array).toString();
          if (!new Headers(init?.headers).has("PAYMENT-SIGNATURE")) {
            firstBody = body;
            return new Response(null, {
              status: 402,
              headers: {
                "PAYMENT-REQUIRED": encodeHeader(
                  buildPaymentRequired(gateway, requirements),
                ),
              },
            });
          }
          paid++;
          expect(body).toBe(firstBody);
          expect(JSON.parse(body).model).toBe("deepseek/deepseek-v4-flash");
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      schemaVersion: 1,
                      observedFacts: [],
                      supportedDiagnoses: [
                        {
                          text: "arbitrary prose never trusted",
                          evidenceIds: ["e4"],
                          field: "data",
                          value: fixture.replay.data,
                        },
                      ],
                      hypotheses: [],
                      suggestedChecks: [],
                    }),
                  },
                },
              ],
            }),
            {
              headers: {
                [PAYMENT_RESPONSE_HEADER]: encodeHeader({
                  success: true,
                  transaction: "",
                  network: requirements.network,
                  reservationId: "committed-1",
                }),
              },
            },
          );
        },
      });
      return { client: prepaid.client, close: async () => {} };
    },
  });
  const report = await runtime.investigate({
    schemaVersion: 1,
    chainId: 8453,
    transactionHash: hash,
  });
  expect(proofs).toBe(1);
  expect(paid).toBe(1);
  expect(report.diagnosis).toBe("supported");
  expect(report.inference).toMatchObject({
    authorizedAllocation: 1,
    locallyRetiredSlots: 1,
    confirmedCommitted: 1,
    unknownOutcomes: 0,
  });
  expect(report.purchase.authorizedExposureMinorUnits).toBe(0);
  expect(ledger.committedSlots()).toEqual([0]);
});
