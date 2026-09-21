/**
 * The single pilot service class.
 *
 * One credit purchases one successfully committed response from
 * `deepseek/deepseek-v4-flash` through the OpenRouter Chat Completions
 * endpoint. Everything the class permits is decided here, before a credit is
 * reserved, so an accepted request always has bounded upstream cost.
 *
 * The class is the only way a request reaches the provider: the gateway
 * normalizes every accepted body into the exact upstream envelope below and
 * never forwards a client-selected model, route, fallback list, media part, or
 * unknown cost-affecting field.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { CODING_DEEPSEEK_V4_FLASH_V1 } from '@zk-credits/x402-zk-prepaid';

/** Versioned class identifier carried by the challenge `asset` field. */
export const SERVICE_CLASS_ID = CODING_DEEPSEEK_V4_FLASH_V1;

/** The only model this gateway dispatches. Client model fields are ignored. */
export const SERVICE_CLASS_MODEL = 'deepseek/deepseek-v4-flash';

/** Request-body ceiling enforced by the JSON parser. */
export const MAX_REQUEST_BYTES = 256 * 1024;

/**
 * Conservative input ceiling, counted in UTF-8 bytes.
 *
 * The gateway cannot run the provider tokenizer before reserving a credit, so
 * it counts byte-pair units instead: a byte-level BPE never emits more than one
 * token per byte, therefore an accepted body always holds at most
 * `MAX_INPUT_TOKEN_UNITS` real tokens. This is deliberately stricter than
 * counting model tokens and never under-counts.
 */
export const MAX_INPUT_TOKEN_UNITS = 16_000;

/** Maximum output tokens the class will ever request from the provider. */
export const MAX_OUTPUT_TOKENS = 4_000;

/** Upstream dispatch timeout for one class request. */
export const PROVIDER_TIMEOUT_MS = 120_000;

/** OpenRouter routing ceiling, in USD per million tokens. */
export const MAX_PROMPT_PRICE_PER_MILLION_USD = 0.9;
export const MAX_COMPLETION_PRICE_PER_MILLION_USD = 1.8;

/**
 * Conservative cost of one dispatch, in micro-USD, including the OpenRouter
 * platform fee. A class request at both ceilings lists $0.0216 of token cost,
 * or $0.022788 after the fee, beneath this cap. The gateway debits it before
 * dispatch and retains it once the request has left the process.
 */
export const MAX_DISPATCH_COST_MICRO_USD = 25_000n;

/** Chat Completions fields the class forwards unchanged. */
const FORWARDED_FIELDS = new Set([
  'temperature',
  'top_p',
  'stop',
  'seed',
  'presence_penalty',
  'frequency_penalty',
  'logit_bias',
  'parallel_tool_calls',
]);

/** Cost-affecting or routing fields the class refuses by name. */
const REJECTED_FIELDS: Record<string, string> = {
  stream: 'streaming_not_supported',
  stream_options: 'streaming_not_supported',
  streamOptions: 'streaming_not_supported',
  models: 'model_fallback_forbidden',
  route: 'provider_routing_forbidden',
  provider: 'provider_routing_forbidden',
  transforms: 'provider_routing_forbidden',
  plugins: 'provider_routing_forbidden',
  web_search_options: 'web_search_forbidden',
  modalities: 'unsupported_modalities',
  audio: 'unsupported_modalities',
  service_tier: 'unsupported_service_tier',
  reasoning: 'unsupported_reasoning_controls',
  reasoning_effort: 'unsupported_reasoning_controls',
  verbosity: 'unsupported_reasoning_controls',
  functions: 'legacy_function_calling_unsupported',
  function_call: 'legacy_function_calling_unsupported',
};

const MESSAGE_ROLES = new Set(['system', 'developer', 'user', 'assistant', 'tool']);

/** Structural slack charged per message and per tool definition. */
const MESSAGE_OVERHEAD_UNITS = 16;
const TOOL_OVERHEAD_UNITS = 32;

export interface NormalizedServiceClassRequest {
  model: typeof SERVICE_CLASS_MODEL;
  stream: false;
  max_completion_tokens: number;
  provider: {
    max_price: { prompt: number; completion: number };
    allow_fallbacks: false;
    require_parameters: true;
  };
  [key: string]: unknown;
}

export type ServiceClassResult =
  | { ok: true; request: NormalizedServiceClassRequest; inputTokenUnits: number }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function has(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** Counts UTF-8 bytes of the content the provider will actually receive. */
class UnitCounter {
  units = 0;

  add(value: string): void {
    this.units += Buffer.byteLength(value, 'utf8');
  }

  addJson(value: unknown): void {
    this.add(JSON.stringify(value) ?? '');
  }
}

function countTextParts(parts: unknown, counter: UnitCounter): string | undefined {
  if (!Array.isArray(parts)) return 'invalid_messages';
  for (const part of parts) {
    if (!isRecord(part) || part.type !== 'text' || typeof part.text !== 'string') {
      return 'unsupported_content_type';
    }
    counter.add(part.text);
  }
  return undefined;
}

function countToolCalls(calls: unknown, counter: UnitCounter): string | undefined {
  if (!Array.isArray(calls)) return 'invalid_messages';
  for (const call of calls) {
    if (!isRecord(call) || call.type !== 'function' || !isRecord(call.function)) return 'invalid_messages';
    if (typeof call.function.name !== 'string') return 'invalid_messages';
    if (call.function.arguments !== undefined && typeof call.function.arguments !== 'string') return 'invalid_messages';
    counter.add(call.function.name);
    counter.addJson(call.function.arguments ?? '');
  }
  return undefined;
}

function countMessage(message: unknown, counter: UnitCounter): string | undefined {
  if (!isRecord(message)) return 'invalid_messages';
  if (typeof message.role !== 'string' || !MESSAGE_ROLES.has(message.role)) return 'invalid_messages';
  counter.add(message.role);
  counter.units += MESSAGE_OVERHEAD_UNITS;

  for (const key of Object.keys(message)) {
    if (!['role', 'content', 'name', 'tool_calls', 'tool_call_id'].includes(key)) return 'invalid_messages';
  }

  if (typeof message.name === 'string') counter.add(message.name);
  if (typeof message.tool_call_id === 'string') counter.add(message.tool_call_id);

  if (typeof message.content === 'string') counter.add(message.content);
  else if (Array.isArray(message.content)) {
    const error = countTextParts(message.content, counter);
    if (error) return error;
  } else if (message.content !== null) {
    // A missing or non-text content field is outside the class. Null is legal
    // only for an assistant turn that carries tool calls.
    return 'invalid_messages';
  }

  if (has(message, 'tool_calls')) {
    const error = countToolCalls(message.tool_calls, counter);
    if (error) return error;
  }
  if (message.content === null && !has(message, 'tool_calls')) return 'invalid_messages';
  return undefined;
}

function countTools(tools: unknown, counter: UnitCounter): string | undefined {
  if (!Array.isArray(tools)) return 'invalid_tools';
  for (const tool of tools) {
    if (!isRecord(tool) || tool.type !== 'function' || !isRecord(tool.function)) return 'invalid_tools';
    const definition = tool.function;
    if (typeof definition.name !== 'string' || definition.name.length === 0) return 'invalid_tools';
    counter.add(definition.name);
    counter.units += TOOL_OVERHEAD_UNITS;
    if (definition.description !== undefined) {
      if (typeof definition.description !== 'string') return 'invalid_tools';
      counter.add(definition.description);
    }
    if (definition.parameters !== undefined) counter.addJson(definition.parameters);
  }
  return undefined;
}

function validateToolChoice(choice: unknown): string | undefined {
  if (choice === 'none' || choice === 'auto' || choice === 'required') return undefined;
  if (!isRecord(choice) || choice.type !== 'function' || !isRecord(choice.function)) return 'invalid_tool_choice';
  if (typeof choice.function.name !== 'string') return 'invalid_tool_choice';
  return undefined;
}

function validateResponseFormat(format: unknown): string | undefined {
  if (!isRecord(format)) return 'unsupported_response_format';
  if (format.type === 'text' || format.type === 'json_object') return undefined;
  if (format.type === 'json_schema' && isRecord(format.json_schema)) return undefined;
  return 'unsupported_response_format';
}

/**
 * Normalizes one client body into the exact upstream envelope for the class.
 * Returns an error code instead of a request whenever any field falls outside
 * the class, so the caller rejects before a credit is ever reserved.
 */
export function normalizeServiceClassRequest(body: unknown): ServiceClassResult {
  if (!isRecord(body)) return { ok: false, error: 'invalid_request_body' };
  if (!Array.isArray(body.messages) || body.messages.length === 0) return { ok: false, error: 'invalid_messages' };

  const forwarded: Record<string, unknown> = {};
  let maxCompletionTokens = MAX_OUTPUT_TOKENS;

  for (const [key, value] of Object.entries(body)) {
    if (key === 'messages' || key === 'tools' || key === 'tool_choice') continue;
    // The class fixes the model. A client-supplied name is ignored, never
    // forwarded, so an OpenAI-compatible client cannot select another model.
    if (key === 'model') continue;
    if (key === 'n') {
      if (value !== 1) return { ok: false, error: 'invalid_choice_count' };
      continue;
    }
    if (key === 'max_completion_tokens' || key === 'max_tokens') {
      if (!Number.isInteger(value) || (value as number) <= 0) return { ok: false, error: 'invalid_max_output_tokens' };
      if ((value as number) > MAX_OUTPUT_TOKENS) return { ok: false, error: 'invalid_max_output_tokens' };
      maxCompletionTokens = value as number;
      continue;
    }
    if (key === 'response_format') {
      const error = validateResponseFormat(value);
      if (error) return { ok: false, error };
      forwarded.response_format = value;
      continue;
    }
    const rejection = REJECTED_FIELDS[key];
    if (rejection) return { ok: false, error: rejection };
    if (!FORWARDED_FIELDS.has(key)) return { ok: false, error: 'unsupported_request_field' };
    forwarded[key] = value;
  }

  const counter = new UnitCounter();
  const messages: Record<string, unknown>[] = [];
  for (const message of body.messages) {
    const error = countMessage(message, counter);
    if (error) return { ok: false, error };
    messages.push(message as Record<string, unknown>);
  }

  if (has(body, 'tools')) {
    const error = countTools(body.tools, counter);
    if (error) return { ok: false, error };
    forwarded.tools = body.tools;
  }
  if (has(body, 'tool_choice')) {
    const error = validateToolChoice(body.tool_choice);
    if (error) return { ok: false, error };
    forwarded.tool_choice = body.tool_choice;
  }

  if (counter.units > MAX_INPUT_TOKEN_UNITS) return { ok: false, error: 'input_too_large' };

  return {
    ok: true,
    inputTokenUnits: counter.units,
    request: {
      ...forwarded,
      model: SERVICE_CLASS_MODEL,
      stream: false,
      max_completion_tokens: maxCompletionTokens,
      provider: {
        max_price: {
          prompt: MAX_PROMPT_PRICE_PER_MILLION_USD,
          completion: MAX_COMPLETION_PRICE_PER_MILLION_USD,
        },
        allow_fallbacks: false,
        require_parameters: true,
      },
      messages,
    },
  };
}
