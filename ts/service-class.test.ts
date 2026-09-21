/**
 * Service-class boundary: one credit buys one bounded request from
 * `deepseek/deepseek-v4-flash`. Every rejection here happens before a credit
 * is reserved, so an accepted request always has bounded upstream cost.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_COMPLETION_PRICE_PER_MILLION_USD,
  MAX_DISPATCH_COST_MICRO_USD,
  MAX_INPUT_TOKEN_UNITS,
  MAX_OUTPUT_TOKENS,
  MAX_PROMPT_PRICE_PER_MILLION_USD,
  MAX_REQUEST_BYTES,
  normalizeServiceClassRequest,
  SERVICE_CLASS_MODEL,
} from './service-class.js';

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { model: 'some-other/model', messages: [{ role: 'user', content: 'hello' }], ...overrides };
}

function errorOf(value: unknown): string | undefined {
  const result = normalizeServiceClassRequest(value);
  return result.ok ? undefined : result.error;
}

function requestOf(value: unknown) {
  const result = normalizeServiceClassRequest(value);
  if (!result.ok) throw new Error(`expected success, got ${result.error}`);
  return result;
}

describe('service class limits', () => {
  it('matches the approved class ceilings', () => {
    expect(MAX_REQUEST_BYTES).toBe(256 * 1024);
    expect(MAX_INPUT_TOKEN_UNITS).toBe(16_000);
    expect(MAX_OUTPUT_TOKENS).toBe(4_000);
    expect(MAX_PROMPT_PRICE_PER_MILLION_USD).toBe(0.9);
    expect(MAX_COMPLETION_PRICE_PER_MILLION_USD).toBe(1.8);
    // $0.025 per dispatch, in micro-USD.
    expect(MAX_DISPATCH_COST_MICRO_USD).toBe(25_000n);
  });

  it('keeps the class ceiling beneath the dispatch debit', () => {
    // Worst case at both ceilings, plus the 5.5% OpenRouter platform fee.
    const listed = (MAX_INPUT_TOKEN_UNITS / 1_000_000) * MAX_PROMPT_PRICE_PER_MILLION_USD
      + (MAX_OUTPUT_TOKENS / 1_000_000) * MAX_COMPLETION_PRICE_PER_MILLION_USD;
    const withFee = listed * 1.055;
    expect(withFee).toBeLessThan(Number(MAX_DISPATCH_COST_MICRO_USD) / 1_000_000);
  });
});

describe('request normalization', () => {
  it('forces the class model and never forwards a client model', () => {
    const { request } = requestOf(body({ model: 'openai/gpt-4o-mini' }));
    expect(request.model).toBe(SERVICE_CLASS_MODEL);
    expect(JSON.stringify(request)).not.toContain('gpt-4o-mini');
  });

  it('allows an OpenAI-compatible client that omits the model', () => {
    const { request } = requestOf({ messages: [{ role: 'user', content: 'hello' }] });
    expect(request.model).toBe(SERVICE_CLASS_MODEL);
  });

  it('pins the routing ceiling and forbids fallbacks', () => {
    const { request } = requestOf(body());
    expect(request.provider).toEqual({
      max_price: { prompt: MAX_PROMPT_PRICE_PER_MILLION_USD, completion: MAX_COMPLETION_PRICE_PER_MILLION_USD },
      allow_fallbacks: false,
      require_parameters: true,
    });
    expect(request.stream).toBe(false);
  });

  it('forwards text messages, tool definitions, and tool calls', () => {
    const { request } = requestOf(body({
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"a"}' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: 'file body' },
        { role: 'user', content: [{ type: 'text', text: 'now summarise' }] },
      ],
      tools: [{ type: 'function', function: { name: 'read', description: 'read a file', parameters: { type: 'object' } } }],
      tool_choice: { type: 'function', function: { name: 'read' } },
      temperature: 0.2,
    }));
    expect(request.messages).toHaveLength(4);
    expect(request.tools).toHaveLength(1);
    expect(request.temperature).toBe(0.2);
    expect(request.tool_choice).toEqual({ type: 'function', function: { name: 'read' } });
  });

  it('defaults output to the ceiling and honors a smaller request', () => {
    expect(requestOf(body()).request.max_completion_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(requestOf(body({ max_completion_tokens: 256 })).request.max_completion_tokens).toBe(256);
    expect(requestOf(body({ max_tokens: 256 })).request.max_completion_tokens).toBe(256);
  });

  it('accepts exactly one generated choice', () => {
    expect(requestOf(body({ n: 1 })).request).toBeDefined();
    expect(errorOf(body({ n: 2 }))).toBe('invalid_choice_count');
  });
});

describe('rejected request surface', () => {
  it.each([
    ['streaming', { stream: true }, 'streaming_not_supported'],
    ['stream options', { stream_options: { include_usage: true } }, 'streaming_not_supported'],
    ['camel stream options', { streamOptions: {} }, 'streaming_not_supported'],
    ['model fallback list', { models: ['a', 'b'] }, 'model_fallback_forbidden'],
    ['provider routing', { provider: { order: ['x'] } }, 'provider_routing_forbidden'],
    ['route', { route: 'fallback' }, 'provider_routing_forbidden'],
    ['transforms', { transforms: ['middle-out'] }, 'provider_routing_forbidden'],
    ['plugins', { plugins: [{ id: 'web' }] }, 'provider_routing_forbidden'],
    ['web search', { web_search_options: {} }, 'web_search_forbidden'],
    ['modalities', { modalities: ['image'] }, 'unsupported_modalities'],
    ['audio', { audio: { voice: 'alloy' } }, 'unsupported_modalities'],
    ['service tier', { service_tier: 'flex' }, 'unsupported_service_tier'],
    ['reasoning controls', { reasoning_effort: 'high' }, 'unsupported_reasoning_controls'],
    ['legacy functions', { functions: [{ name: 'x' }] }, 'legacy_function_calling_unsupported'],
    ['unknown field', { top_k: 5 }, 'unsupported_request_field'],
    ['smuggled media field', { input_image: 'data:...' }, 'unsupported_request_field'],
  ])('rejects %s', (_name, override, expected) => {
    expect(errorOf(body(override as Record<string, unknown>))).toBe(expected);
  });

  it.each([
    ['image part', [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://x/y.png' } }] }]],
    ['audio part', [{ role: 'user', content: [{ type: 'input_audio', input_audio: {} }] }]],
    ['file part', [{ role: 'user', content: [{ type: 'file', file: { file_id: 'f' } }] }]],
  ])('rejects a %s', (_name, messages) => {
    expect(errorOf(body({ messages }))).toBe('unsupported_content_type');
  });

  it('rejects malformed bodies and messages', () => {
    expect(errorOf(undefined)).toBe('invalid_request_body');
    expect(errorOf([])).toBe('invalid_request_body');
    expect(errorOf({ messages: [] })).toBe('invalid_messages');
    expect(errorOf(body({ messages: [{ role: 'root', content: 'x' }] }))).toBe('invalid_messages');
    expect(errorOf(body({ messages: [{ role: 'user', content: 'x', unexpected: 1 }] }))).toBe('invalid_messages');
    expect(errorOf(body({ messages: [{ role: 'user' }] }))).toBe('invalid_messages');
  });

  it('rejects non-function tools', () => {
    expect(errorOf(body({ tools: [{ type: 'code_interpreter' }] }))).toBe('invalid_tools');
    expect(errorOf(body({ tools: 'nope' }))).toBe('invalid_tools');
  });

  it('rejects unsupported response formats and output ceilings', () => {
    expect(errorOf(body({ response_format: { type: 'video' } }))).toBe('unsupported_response_format');
    expect(errorOf(body({ max_completion_tokens: MAX_OUTPUT_TOKENS + 1 }))).toBe('invalid_max_output_tokens');
    expect(errorOf(body({ max_completion_tokens: 0 }))).toBe('invalid_max_output_tokens');
    expect(errorOf(body({ max_completion_tokens: -1 }))).toBe('invalid_max_output_tokens');
    expect(errorOf(body({ max_tokens: 1.5 }))).toBe('invalid_max_output_tokens');
  });
});

describe('conservative input counting', () => {
  it('counts UTF-8 bytes, so the count is never below the real token count', () => {
    const content = 'héllo wörld';
    const { inputTokenUnits } = requestOf(body({ messages: [{ role: 'user', content }] }));
    // Content bytes plus the role and the per-message structural allowance.
    expect(inputTokenUnits).toBeGreaterThanOrEqual(Buffer.byteLength(content, 'utf8'));
  });

  it('admits an input at the limit and rejects one over it', () => {
    const atLimit = 'a'.repeat(MAX_INPUT_TOKEN_UNITS - 100);
    expect(normalizeServiceClassRequest(body({ messages: [{ role: 'user', content: atLimit }] })).ok).toBe(true);

    const overLimit = 'a'.repeat(MAX_INPUT_TOKEN_UNITS);
    expect(errorOf(body({ messages: [{ role: 'user', content: overLimit }] }))).toBe('input_too_large');
  });

  it('counts tool definitions toward the input budget', () => {
    const big = 'x'.repeat(MAX_INPUT_TOKEN_UNITS);
    expect(errorOf(body({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'read', description: big, parameters: {} } }],
    }))).toBe('input_too_large');
  });

  it('rejects the body limit enforced by the JSON parser', () => {
    expect(MAX_REQUEST_BYTES).toBeLessThan(1_000_000);
  });
});
