import { describe, expect, it } from 'vitest';
import { createCipheriv, publicEncrypt, randomBytes } from 'node:crypto';
import { buildPaymentRequired, CODING_DEEPSEEK_V4_FLASH_V1, decodeHeader, encodeHeader, PAYMENT_RESPONSE_HEADER, type PaymentPayload } from '@zk-credits/x402-zk-prepaid';
import { createCredential, generateSecret } from '@zk-credits/shared/base';
import { createBasePrepaidClient } from './base-sidecar.js';
import { BaseSlotLedger } from './slot-ledger.js';

const requirements = {
  scheme: 'zk-prepaid' as const,
  network: 'eip155:84532' as const,
  amount: '1' as const,
  asset: CODING_DEEPSEEK_V4_FLASH_V1,
  payTo: '0x00000000000000000000000000000000000000b2',
  maxTimeoutSeconds: 300,
  extra: {
    assetTransferMethod: 'prepaid-claim' as const,
    paymentFlow: 'escrow' as const,
    circuit: 'private-credit-spend-bn254-v1',
    verifyingKey: 'dev-sepolia-v1',
    deploymentDomain: '84532',
    contract: '0x00000000000000000000000000000000000000a1',
    requirementsVersion: 'zk-prepaid-v1',
    issuedAt: Math.floor(Date.now() / 1000),
  },
};

const witnessProvider = {
  witnessForCredential: async () => ({
    root: '123',
    pathElements: Array.from({ length: 20 }, () => '0'),
    pathIndices: Array.from({ length: 20 }, () => 0),
    expiry: 1_800_000_000,
  }),
};

function encryptReplay(responseKey: string, body: string): string {
  const aesKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(body), cipher.final()]);
  const encryptedKey = publicEncrypt({ key: responseKey, oaepHash: 'sha256' }, aesKey);
  return JSON.stringify({
    version: 1,
    algorithm: 'RSA-OAEP-256/AES-256-GCM',
    key: encryptedKey.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    expiresAt: Date.now() + 60_000,
    contentType: 'application/json',
    status: 200,
  });
}

async function credential() {
  return createCredential(generateSecret(), 0, Math.floor(Date.now() / 1000) + 3600, '84532');
}

describe('Base x402 sidecar adapter', () => {
  it('generates request-bound proof payloads without identifying fields', async () => {
    const ledger = await BaseSlotLedger.open({});
    let proofInput: Record<string, unknown> | undefined;
    let expectedSignals: readonly string[] | undefined;
    let call = 0;
    const prepaid = createBasePrepaidClient({
      credential: await credential(),
      slotLedger: ledger,
      witnessProvider,
      prove: async (input, context) => {
        proofInput = input as unknown as Record<string, unknown>;
        expectedSignals = context.expectedPublicSignals;
        return { proof: { pi_a: ['1', '2'] }, publicSignals: [...context.expectedPublicSignals] };
      },
      fetch: async (_input, init) => {
        call += 1;
        if (call === 1) return new Response(null, { status: 402, headers: { 'PAYMENT-REQUIRED': encodeHeader(buildPaymentRequired('https://api.test/v1/chat/completions', requirements)) } });
        const header = new Headers(init?.headers).get('PAYMENT-SIGNATURE');
        expect(header).toBeTruthy();
        const payment = decodeHeader<PaymentPayload>(header!);
        expect(payment.payload).not.toHaveProperty('commitment');
        expect(payment.payload).not.toHaveProperty('secret');
        expect(payment.payload.publicSignals).toHaveLength(6);
        expect(payment.payload.publicSignals).toEqual(expectedSignals);
        return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    await expect(prepaid.client.fetch('https://api.test/v1/chat/completions', { method: 'POST', body: '{"model":"stub"}' })).resolves.toMatchObject({ status: 200 });
    expect(call).toBe(2);
    expect(proofInput?.tier_id).toBe('0');
    expect(proofInput?.expiry).toBe('1800000000');
    expect(proofInput?.merkle_path_elements).toHaveLength(20);
    expect(proofInput?.slot).toBe('0');
    expect(ledger.committedSlots()).toEqual([0]);
    expect(ledger.snapshot()).toMatchObject({ committed: 1, provisional: 0 });
  });

  it('refuses a payment whose prover returns non-canonical signals and reuses the slot', async () => {
    const ledger = await BaseSlotLedger.open({});
    const prepaid = createBasePrepaidClient({
      credential: await credential(),
      slotLedger: ledger,
      witnessProvider,
      prove: async (_input, context) => ({
        proof: { pi_a: ['1'] },
        publicSignals: [...context.expectedPublicSignals].reverse(),
      }),
      fetch: async () => new Response(null, { status: 402, headers: { 'PAYMENT-REQUIRED': encodeHeader(buildPaymentRequired('https://api.test/v1/chat/completions', requirements)) } }),
    });

    await expect(prepaid.client.fetch('https://api.test/v1/chat/completions', { method: 'POST', body: '{"model":"stub"}' }))
      .rejects.toThrow('Proof public signals do not match the canonical statement');
    expect(ledger.committedSlots()).toEqual([]);
    expect(ledger.allocateProvisional()).toBe(0);
  });

  it('leaves a slot reusable when the local prove fails', async () => {
    const ledger = await BaseSlotLedger.open({});
    let attempt = 0;
    const prepaid = createBasePrepaidClient({
      credential: await credential(),
      slotLedger: ledger,
      witnessProvider,
      prove: async (input, context) => {
        attempt += 1;
        if (attempt === 1) throw new Error('proof miss');
        return { proof: { pi_a: ['1'] }, publicSignals: [...context.expectedPublicSignals] };
      },
      fetch: async (_input, init) => {
        if (!init?.headers || !new Headers(init.headers).get('PAYMENT-SIGNATURE')) {
          return new Response(null, { status: 402, headers: { 'PAYMENT-REQUIRED': encodeHeader(buildPaymentRequired('https://api.test/v1/chat/completions', requirements)) } });
        }
        return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    await expect(prepaid.client.fetch('https://api.test/v1/chat/completions', { method: 'POST', body: '{"model":"stub"}' })).rejects.toThrow('proof miss');
    expect(ledger.snapshot()).toMatchObject({ committed: 0, provisional: 0 });

    await expect(prepaid.client.fetch('https://api.test/v1/chat/completions', { method: 'POST', body: '{"model":"stub"}' })).resolves.toMatchObject({ status: 200 });
    expect(ledger.committedSlots()).toEqual([0]);
  });

  it('decrypts a committed replay through the local proxy without server plaintext', async () => {
    const ledger = await BaseSlotLedger.open({});
    let calls = 0;
    let replayPayload: PaymentPayload | undefined;
    const prepaid = createBasePrepaidClient({
      credential: await credential(),
      slotLedger: ledger,
      witnessProvider,
      prove: async (_input, context) => ({ proof: {}, publicSignals: [...context.expectedPublicSignals] }),
      fetch: async (input, init) => {
        calls += 1;
        if (calls === 1) return new Response(null, { status: 402, headers: { 'PAYMENT-REQUIRED': encodeHeader(buildPaymentRequired('https://api.test/v1/chat/completions', requirements)) } });
        if (calls === 2) return new Response('first', { status: 200 });
        if (typeof input === 'string' && input.endsWith('/x402/replay')) {
          const encryptedReplay = encryptReplay(replayPayload!.payload.responseKey, '{"replayed":true}');
          return new Response(JSON.stringify({ encryptedReplay }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        replayPayload = decodeHeader<PaymentPayload>(new Headers(init?.headers).get('PAYMENT-SIGNATURE')!);
        return new Response(JSON.stringify({ replay: true }), { status: 409, headers: { [PAYMENT_RESPONSE_HEADER]: encodeHeader({ success: true, transaction: '', network: requirements.network }) } });
      },
    });

    await prepaid.client.fetch('https://api.test/v1/chat/completions', { method: 'POST', body: '{"model":"stub"}' });
    const replay = await prepaid.client.fetch('https://api.test/v1/chat/completions', { method: 'POST', body: '{"model":"stub"}' });
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual({ replayed: true });
    expect(calls).toBe(4);
    expect(ledger.committedSlots()).toEqual([0]);
  });

  it('coalesces an exact pending retry and allocates a fresh slot after completion', async () => {
    const ledger = await BaseSlotLedger.open({});
    const nonces: string[] = [];
    const slots: string[] = [];
    let calls = 0;
    const prepaid = createBasePrepaidClient({
      credential: await credential(),
      slotLedger: ledger,
      witnessProvider,
      prove: async (input, context) => {
        slots.push(String(input.slot));
        return { proof: {}, publicSignals: [...context.expectedPublicSignals] };
      },
      fetch: async (_input, init) => {
        calls += 1;
        if (calls === 1) return new Response(null, { status: 402, headers: { 'PAYMENT-REQUIRED': encodeHeader(buildPaymentRequired('https://api.test/v1/chat/completions', requirements)) } });
        nonces.push(decodeHeader<PaymentPayload>(new Headers(init?.headers).get('PAYMENT-SIGNATURE')!).payload.nonce);
        return new Response(JSON.stringify({ calls }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    await prepaid.client.fetch('https://api.test/v1/chat/completions', { method: 'POST', body: '{"model":"stub"}' });
    const retry = await prepaid.client.fetch('https://api.test/v1/chat/completions', { method: 'POST', body: '{"model":"stub"}' });
    await retry.text();
    const fresh = await prepaid.client.fetch('https://api.test/v1/chat/completions', { method: 'POST', body: '{"model":"stub"}' });
    await fresh.text();

    expect(nonces).toHaveLength(3);
    expect(nonces[0]).toBe(nonces[1]);
    expect(nonces[2]).not.toBe(nonces[1]);
    expect(slots).toEqual(['0', '1']);
    expect(ledger.committedSlots()).toEqual([0, 1]);
  });

  it('derives a depth-20 witness from an explicitly supplied local public tree', async () => {
    const ledger = await BaseSlotLedger.open({});
    const { computeCreditLeaf, deriveSparseCreditWitness, poseidonHash } = await import('@zk-credits/shared/base');
    const { createFileWitnessProvider } = await import('./base-sidecar.js');
    const subject = await credential();
    const other = await computeCreditLeaf('12345', 0, 1_900_000_000);
    const leaf = await computeCreditLeaf(subject.commitment, subject.tierId, subject.expiry);
    const expected = await deriveSparseCreditWitness(new Map([[3, other], [7, leaf]]), 7);
    const artifact = {
      root: expected.root,
      leaves: [
        { index: 3, leaf: other },
        { index: 7, leaf, expiry: 1_900_000_000 },
      ],
    };

    const provider = createFileWitnessProvider(artifact);
    const witness = await provider.witnessForCredential(subject);
    expect(witness.root).toBe(expected.root);
    expect(witness.pathElements).toHaveLength(20);
    expect(witness.pathIndices.every((index) => index === 0 || index === 1)).toBe(true);
    expect(witness.expiry).toBe(1_900_000_000);

    const mismatched = createFileWitnessProvider({ ...artifact, root: (BigInt(expected.root) + 1n).toString() });
    await expect(mismatched.witnessForCredential(subject)).rejects.toThrow('does not match the derived membership root');
    const missing = createFileWitnessProvider({ leaves: [{ index: 1, leaf: await poseidonHash(['1']) }] });
    await expect(missing.witnessForCredential(subject)).rejects.toThrow('No funded Base bundle was found');
  });
});
