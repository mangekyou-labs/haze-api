import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore, getDefaultStore, setDefaultStore } from './storage.js';

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it('returns null for missing key', async () => {
    expect(await store.get('nonexistent')).toBeNull();
  });

  it('stores and retrieves values', async () => {
    await store.set('secret_k', '0x1234');
    expect(await store.get('secret_k')).toBe('0x1234');
  });

  it('overwrites existing values', async () => {
    await store.set('key', 'old');
    await store.set('key', 'new');
    expect(await store.get('key')).toBe('new');
  });

  it('deletes values', async () => {
    await store.set('key', 'value');
    await store.delete('key');
    expect(await store.get('key')).toBeNull();
  });

  it('handles multiple keys', async () => {
    await store.set('a', '1');
    await store.set('b', '2');
    expect(await store.get('a')).toBe('1');
    expect(await store.get('b')).toBe('2');
  });
});

describe('default store', () => {
  it('returns a MemoryStore in non-browser env', () => {
    const store = getDefaultStore();
    expect(store.constructor.name).toBe('MemoryStore');
  });

  it('can be overridden', async () => {
    const custom = new MemoryStore();
    await custom.set('test', 'value');
    setDefaultStore(custom);
    expect(await getDefaultStore().get('test')).toBe('value');
  });
});
