// Gateway Node crypto module — isomorphic core re-exported from
// @zk-credits/shared. DI: circuit resources are Node filesystem paths
// resolved from CIRCUITS_DIR (the browser passes /circuits/* URLs instead).

import { resolve } from 'path';
import {
  generateSecretK,
  deriveMnemonic,
  recoverSecretK,
  skToField,
  computeDepositCommitment,
  type DepositCircuitResources,
} from '@zk-credits/shared';

const CIRCUITS_DIR = process.env.CIRCUITS_DIR || resolve(import.meta.dirname!, '..', '..', 'circuits');

function nodeDepositResources(): DepositCircuitResources {
  return {
    depositWasm: resolve(CIRCUITS_DIR, 'deposit_membership.wasm'),
    depositZkey: resolve(CIRCUITS_DIR, 'deposit_membership_final.zkey'),
  };
}

export { generateSecretK, deriveMnemonic, recoverSecretK, skToField };

// deposit_membership publicSignals: [root, commitment] → returns the commitment.
export async function computeCommitment(secretK: Uint8Array): Promise<string> {
  return computeDepositCommitment(secretK, nodeDepositResources());
}
