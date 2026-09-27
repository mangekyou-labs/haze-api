declare module 'circomlibjs' {
  interface MimcSponge {
    F: {
      e(value: unknown): Uint8Array;
    };
    multiHash(values: bigint[]): unknown;
  }

  export function buildMimcSponge(): Promise<MimcSponge>;
}
