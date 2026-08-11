// Isomorphic crypto core — shared by the browser (web) and Node (gateway/CLI).
// Pure functions only: no `fs`/`path`/`createRequire`, no Node `Buffer`, no
// `globalThis`/`window` usage. `crypto.getRandomValues` is available in both
// modern browsers and Node 18+.
import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
// BLS12-381 Fr order (matches the Circom circuits and the v1 gateway).
export const FR_ORDER = '0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001';
const FIELD_ORDER = BigInt(FR_ORDER);
const MIMC_ROUNDS = 220;
let mimcConstantsPromise = null;
function toHexBytes(secretK) {
    return Array.from(secretK)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
export function generateSecretK() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return bytes;
}
export function deriveMnemonic(secretK) {
    return entropyToMnemonic(secretK, wordlist);
}
export function recoverSecretK(mnemonic) {
    return mnemonicToEntropy(mnemonic.trim(), wordlist);
}
// Reduce the 32-byte secret_k into the BLS12-381 Fr field as a decimal string.
export function skToField(secretK) {
    const val = BigInt('0x' + toHexBytes(secretK));
    return (val % FIELD_ORDER).toString();
}
function mod(value) {
    const reduced = value % FIELD_ORDER;
    return reduced < 0n ? reduced + FIELD_ORDER : reduced;
}
async function mimcConstants() {
    if (!mimcConstantsPromise) {
        const { buildMimcSponge } = await import('circomlibjs');
        mimcConstantsPromise = buildMimcSponge().then((mimc) => mimc.cts.map((constant) => BigInt(mimc.F.toObject(constant).toString())));
    }
    return mimcConstantsPromise;
}
function pow5(value) {
    const square = mod(value * value);
    return mod(mod(square * square) * value);
}
function mimcFeistel(leftInput, rightInput, constants) {
    let left = mod(leftInput);
    let right = mod(rightInput);
    for (let round = 0; round < MIMC_ROUNDS; round += 1) {
        const constant = round === 0 || round === MIMC_ROUNDS - 1 ? 0n : constants[round];
        const previousRight = right;
        const powered = pow5(left + constant);
        if (round < MIMC_ROUNDS - 1) {
            right = left;
            left = mod(previousRight + powered);
        }
        else {
            right = mod(previousRight + powered);
        }
    }
    return { left, right };
}
/** MiMCSponge with the same BLS12-381 Fr arithmetic as the Circom circuits. */
export async function mimcHash(inputs) {
    if (inputs.length === 0)
        throw new Error('MiMCSponge requires an input');
    const constants = await mimcConstants();
    let rate = 0n;
    let capacity = 0n;
    for (const input of inputs) {
        rate = mod(rate + input);
        const state = mimcFeistel(rate, capacity, constants);
        rate = state.left;
        capacity = state.right;
    }
    return rate.toString();
}
function normalizeForCanonicalJson(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return value;
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : null;
    if (Array.isArray(value))
        return value.map((item) => normalizeForCanonicalJson(item));
    if (value !== null && typeof value === 'object') {
        const object = value;
        return Object.fromEntries(Object.keys(object)
            .sort()
            .map((key) => [key, normalizeForCanonicalJson(object[key])]));
    }
    return null;
}
/** Stable JSON representation used as the exact request message M. */
export function canonicalizeRequest(request) {
    return JSON.stringify(normalizeForCanonicalJson(request));
}
export async function requestDigestToField(request) {
    const canonical = canonicalizeRequest(request);
    const digestBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)));
    const digest = Array.from(digestBytes)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    return { canonical, digest, field: mod(BigInt(`0x${digest}`)).toString() };
}
/** Derive one paper ticket and bind its share to the canonical API request. */
export async function deriveTicketSignals(secretK, ticketIndex, request) {
    if (!Number.isInteger(ticketIndex) || ticketIndex < 0 || ticketIndex >= 100) {
        throw new Error('ticket index must be an integer in the range 0..99');
    }
    const requestDigest = await requestDigestToField(request);
    const secretField = BigInt(skToField(secretK));
    const slope = await mimcHash([secretField, BigInt(ticketIndex)]);
    const nullifier = await mimcHash([BigInt(slope)]);
    const signalY = mod(secretField + BigInt(slope) * BigInt(requestDigest.field)).toString();
    return {
        ...requestDigest,
        ticketIndex,
        slope,
        nullifier,
        signalX: requestDigest.field,
        signalY,
    };
}
