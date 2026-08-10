export declare const FR_ORDER = "0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001";
export declare function generateSecretK(): Uint8Array;
export declare function deriveMnemonic(secretK: Uint8Array): string;
export declare function recoverSecretK(mnemonic: string): Uint8Array;
export declare function skToField(secretK: Uint8Array): string;
