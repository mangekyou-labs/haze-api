declare module 'circomlibjs' {
  export function buildMimcSponge(): Promise<{
    cts: Uint8Array[];
    F: { toObject(value: Uint8Array): bigint };
  }>;
  export function buildPoseidon(): Promise<{
    (inputs: bigint[]): Uint8Array;
    F: { toObject(value: Uint8Array): bigint };
  }>;
}
