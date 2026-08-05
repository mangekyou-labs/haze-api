// Browser-side crypto: re-exports the isomorphic core from @zk-credits/shared.
// DI: circuit resources are the browser-served static URLs (`/circuits/*`),
// matching how the shared package is consumed in Node (filesystem paths).

import {
  generateSecretK,
  recoverSecretK,
  deriveMnemonic,
  skToField,
  computeDepositCommitment,
  type DepositCircuitResources,
} from '@zk-credits/shared';

const browserDepositResources: DepositCircuitResources = {
  depositWasm: '/circuits/deposit_membership.wasm',
  depositZkey: '/circuits/deposit_membership_final.zkey',
};

export { generateSecretK, recoverSecretK, deriveMnemonic };

// Keep the v1 alias for compatibility.
export const secretKToField = skToField;

// deposit_membership outputs: [root, commitment] → returns the commitment.
export async function computeCommitment(secretK: Uint8Array): Promise<string> {
  return computeDepositCommitment(secretK, browserDepositResources);
}
