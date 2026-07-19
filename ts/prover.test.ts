import { describe, it, expect, beforeEach } from 'vitest';

interface ProofResult {
  proof: object;
  publicSignals: string[];
}

class ProofCache {
  private cache = new Map<string, Promise<ProofResult>>();
  hits = 0;
  misses = 0;
  sets = 0;

  getKey(input: unknown): string {
    return JSON.stringify(input);
  }

  async getOrCompute(
    key: string,
    generator: () => Promise<ProofResult>,
  ): Promise<ProofResult> {
    const existing = this.cache.get(key);
    if (existing) {
      this.hits++;
      return existing;
    }
    this.misses++;
    const promise = generator().then((result) => {
      this.sets++;
      return result;
    });
    this.cache.set(key, promise);
    return promise;
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.sets = 0;
  }

  get size(): number {
    return this.cache.size;
  }
}

describe('ProofCache', () => {
  let cache: ProofCache;

  beforeEach(() => {
    cache = new ProofCache();
  });

  it('starts empty', () => {
    expect(cache.size).toBe(0);
    expect(cache.hits).toBe(0);
    expect(cache.misses).toBe(0);
  });

  it('returns generated value on miss', async () => {
    const result = await cache.getOrCompute('key1', async () => ({
      proof: { a: '1' },
      publicSignals: ['1', '2'],
    }));
    expect(result.proof).toEqual({ a: '1' });
    expect(cache.misses).toBe(1);
    expect(cache.hits).toBe(0);
    expect(cache.size).toBe(1);
  });

  it('returns cached value on subsequent call', async () => {
    const generator = async () => ({
      proof: { a: '1' },
      publicSignals: ['1', '2'],
    });

    const first = await cache.getOrCompute('key1', generator);
    const second = await cache.getOrCompute('key1', generator);

    expect(first).toBe(second);
    expect(cache.misses).toBe(1);
    expect(cache.hits).toBe(1);
    expect(cache.sets).toBe(1);
  });

  it('generates separate entries for different keys', async () => {
    const results = await Promise.all([
      cache.getOrCompute('key1', async () => ({
        proof: { a: '1' },
        publicSignals: ['1'],
      })),
      cache.getOrCompute('key2', async () => ({
        proof: { a: '2' },
        publicSignals: ['2'],
      })),
    ]);

    expect(results[0].proof).toEqual({ a: '1' });
    expect(results[1].proof).toEqual({ a: '2' });
    expect(cache.misses).toBe(2);
    expect(cache.hits).toBe(0);
    expect(cache.size).toBe(2);
  });

  it('caches based on JSON-stable key', () => {
    const key1 = cache.getKey({ secret_k: '0x1', epoch: '100' });
    const key2 = cache.getKey({ secret_k: '0x1', epoch: '100' });
    expect(key1).toBe(key2);
    expect(key1).toContain('secret_k');
    expect(key1).toContain('epoch');
  });

  it('clear removes all entries', async () => {
    await cache.getOrCompute('key1', async () => ({
      proof: {},
      publicSignals: [],
    }));
    await cache.getOrCompute('key2', async () => ({
      proof: {},
      publicSignals: [],
    }));
    expect(cache.size).toBe(2);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.hits).toBe(0);
    expect(cache.misses).toBe(0);
  });

  it('does not call generator again for in-flight promise', async () => {
    let callCount = 0;
    const slowGen = async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 10));
      return { proof: { result: callCount }, publicSignals: [] };
    };

    const [r1, r2] = await Promise.all([
      cache.getOrCompute('slow', slowGen),
      cache.getOrCompute('slow', slowGen),
    ]);

    expect(r1).toBe(r2);
    expect(callCount).toBe(1);
    expect(cache.hits).toBe(1);
    expect(cache.misses).toBe(1);
  });
});
