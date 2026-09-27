import { describe, expect, it } from 'vitest';
import { createEvaluationStore } from './evaluation-store-factory.js';

describe('evaluation store selection', () => {
  it('keeps local/test environments on the deterministic memory adapter', () => {
    expect(createEvaluationStore({ NODE_ENV: 'test' }).persistence).toBe('memory');
  });

  it('fails fast in production when durable evaluation storage is missing', () => {
    expect(() => createEvaluationStore({ NODE_ENV: 'production' })).toThrow(
      'Evaluation persistence is required in production',
    );
  });

  it('allows an explicit memory override for isolated smoke environments', () => {
    expect(createEvaluationStore({ NODE_ENV: 'production', EVALUATION_STORE: 'memory' }).persistence)
      .toBe('memory');
  });
});
