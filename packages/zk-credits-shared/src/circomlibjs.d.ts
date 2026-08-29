declare module 'circomlibjs' {
  export function buildMimcSponge(): Promise<{
    cts: Uint8Array[];
    F: {
      toObject: (value: Uint8Array) => bigint;
    };
  }>;
}
