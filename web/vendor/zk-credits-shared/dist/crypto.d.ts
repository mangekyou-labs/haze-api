export declare const FR_ORDER = "0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001";
export declare function generateSecretK(): Uint8Array;
export declare function deriveMnemonic(secretK: Uint8Array): string;
export declare function recoverSecretK(mnemonic: string): Uint8Array;
export declare function skToField(secretK: Uint8Array): string;
/** MiMCSponge with the same BLS12-381 Fr arithmetic as the Circom circuits. */
export declare function mimcHash(inputs: readonly bigint[]): Promise<string>;
/** Stable JSON representation used as the exact request message M. */
export declare function canonicalizeRequest(request: unknown): string;
export interface RequestDigest {
    canonical: string;
    digest: string;
    field: string;
}
export declare function requestDigestToField(request: unknown): Promise<RequestDigest>;
export interface TicketSignals extends RequestDigest {
    ticketIndex: number;
    slope: string;
    nullifier: string;
    signalX: string;
    signalY: string;
}
/** Derive one paper ticket and bind its share to the canonical API request. */
export declare function deriveTicketSignals(secretK: Uint8Array, ticketIndex: number, request: unknown): Promise<TicketSignals>;
