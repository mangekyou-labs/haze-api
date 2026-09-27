import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createClaimLifecycle, type PaymentPayload } from '@zk-credits/x402-zk-prepaid';
import { LocalClaimStore } from './claim-store.js';
import { createClaimCompletion } from './claim-completion.js';
import { normalizeServiceClassRequest } from './service-class.js';
import type { ProviderAdapter } from './providerAdapter.js';

const NOW = 1_700_000_000_000;
const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const responseKey = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const normalized = normalizeServiceClassRequest({ messages: [{ role: 'user', content: 'hello' }] });
if (!normalized.ok) throw new Error(normalized.error);
const payment = { payload: { responseKey } } as PaymentPayload;

function setup(provider: ProviderAdapter) {
  const store = new LocalClaimStore();
  const completion = createClaimCompletion({
    lifecycle: createClaimLifecycle(store, { now: () => NOW }),
    provider,
    providerConfigured: true,
    providerAuth: '',
    providerTimeoutMs: 1000,
    now: () => NOW,
  });
  const input = { payment, nullifier: '4', signalHash: 'abc', request: normalized.request };
  return { store, completion, input };
}

describe('claim completion', () => {
  it('coalesces exact retries and commits before returning plaintext', async () => {
    let calls = 0;
    let release!: (response: Response) => void;
    const provider: ProviderAdapter = {
      id: 'mock',
      forwardRequest: () => { calls++; return new Promise<Response>((resolve) => { release = resolve; }); },
    };
    const { store, completion, input } = setup(provider);
    const first = completion.complete(input);
    // Let the first reservation and dispatch reach the provider.
    while (!release) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const second = completion.complete(input);
    release(new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }));
    const [one, two] = await Promise.all([first, second]);
    expect(one.kind).toBe('response');
    expect(two).toEqual(one);
    expect(calls).toBe(1);
    expect((await store.lookup('4', 'abc'))?.state).toBe('committed');
    expect((await completion.complete(input)).kind).toBe('committed');
  });

  it('cancels a reservation when the provider fails after dispatch', async () => {
    const { store, completion, input } = setup({
      id: 'mock',
      async forwardRequest() { throw new Error('upstream_down'); },
    });
    await expect(completion.complete(input)).rejects.toThrow('provider_request_failed');
    expect((await store.lookup('4', 'abc'))?.state).toBe('cancelled');
  });
});
