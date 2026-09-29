import { randomUUID } from 'node:crypto';

type JsonRecord = Record<string, unknown>;

export type ResponsesTranslation =
  | { ok: true; chatRequest: JsonRecord; responseModel: string }
  | { ok: false; error: string };

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonRecord, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function textContent(value: unknown): string | Array<{ type: 'text'; text: string }> | undefined {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return undefined;
  const parts: Array<{ type: 'text'; text: string }> = [];
  for (const part of value) {
    if (!isRecord(part) || !hasOnlyKeys(part, ['type', 'text'])
      || (part.type !== 'input_text' && part.type !== 'output_text')
      || typeof part.text !== 'string') return undefined;
    parts.push({ type: 'text', text: part.text });
  }
  return parts.length === 1 ? parts[0]!.text : parts;
}

function responseInputMessages(input: unknown): JsonRecord[] | undefined {
  if (typeof input === 'string') return [{ role: 'user', content: input }];
  if (!Array.isArray(input)) return undefined;
  const messages: JsonRecord[] = [];
  for (const item of input) {
    if (!isRecord(item) || typeof item.type !== 'string') return undefined;
    if (item.type === 'message') {
      if (!hasOnlyKeys(item, ['type', 'id', 'role', 'content'])
        || (item.id !== undefined && typeof item.id !== 'string')
        || !['system', 'developer', 'user', 'assistant'].includes(String(item.role))) return undefined;
      const content = textContent(item.content);
      if (content === undefined) return undefined;
      messages.push({ role: item.role, content });
      continue;
    }
    if (item.type === 'function_call') {
      if (!hasOnlyKeys(item, ['type', 'id', 'status', 'call_id', 'name', 'arguments'])
        || typeof item.call_id !== 'string' || typeof item.name !== 'string'
        || typeof item.arguments !== 'string'
        || (item.id !== undefined && typeof item.id !== 'string')
        || (item.status !== undefined && typeof item.status !== 'string')) return undefined;
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [{ id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } }],
      });
      continue;
    }
    if (item.type === 'function_call_output') {
      if (!hasOnlyKeys(item, ['type', 'id', 'status', 'call_id', 'output'])
        || typeof item.call_id !== 'string' || typeof item.output !== 'string'
        || (item.id !== undefined && typeof item.id !== 'string')
        || (item.status !== undefined && typeof item.status !== 'string')) return undefined;
      messages.push({ role: 'tool', tool_call_id: item.call_id, content: item.output });
      continue;
    }
    return undefined;
  }
  return messages;
}

function responseTools(value: unknown): JsonRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tools: JsonRecord[] = [];
  for (const tool of value) {
    if (!isRecord(tool) || typeof tool.type !== 'string') return undefined;
    if (tool.type === 'function') {
      if (!hasOnlyKeys(tool, ['type', 'name', 'description', 'parameters', 'strict'])
        || typeof tool.name !== 'string' || tool.name.length === 0
        || (tool.description !== undefined && typeof tool.description !== 'string')
        || (tool.parameters !== undefined && !isRecord(tool.parameters))
        || (tool.strict !== undefined && typeof tool.strict !== 'boolean')) return undefined;
      const definition: JsonRecord = { name: tool.name };
      if (tool.description !== undefined) definition.description = tool.description;
      if (tool.parameters !== undefined) definition.parameters = tool.parameters;
      if (tool.strict !== undefined) definition.strict = tool.strict;
      tools.push({ type: 'function', function: definition });
      continue;
    }
    // Codex sends its local freeform apply_patch tool with every Responses
    // request. Chat Completions cannot execute that tool, so validate this
    // known declaration and omit it from the provider request.
    if (tool.type === 'custom') {
      if (!hasOnlyKeys(tool, ['type', 'name', 'description', 'format'])
        || tool.name !== 'apply_patch'
        || (tool.description !== undefined && typeof tool.description !== 'string')
        || !isRecord(tool.format)
        || !hasOnlyKeys(tool.format, ['type', 'syntax', 'definition'])
        || tool.format.type !== 'grammar'
        || tool.format.syntax !== 'lark'
        || typeof tool.format.definition !== 'string') return undefined;
      continue;
    }
    // Codex includes these tool declarations in each Responses request. The
    // fixed service class has no web-search executor and accepts only direct
    // function tools, so validate their known shape and drop them.
    if (tool.type === 'web_search') {
      if (!hasOnlyKeys(tool, ['type', 'external_web_access'])
        || (tool.external_web_access !== undefined && typeof tool.external_web_access !== 'boolean')) return undefined;
      continue;
    }
    if (tool.type === 'namespace') {
      if (!hasOnlyKeys(tool, ['type', 'name', 'description', 'tools'])
        || typeof tool.name !== 'string'
        || (tool.description !== undefined && typeof tool.description !== 'string')
        || !Array.isArray(tool.tools)
        || tool.tools.some((nested) => !isRecord(nested) || nested.type !== 'function' || typeof nested.name !== 'string')) return undefined;
      continue;
    }
    return undefined;
  }
  return tools;
}

function translatedToolChoice(value: unknown): unknown | undefined {
  if (value === 'none' || value === 'auto' || value === 'required') return value;
  if (!isRecord(value) || value.type !== 'function' || !hasOnlyKeys(value, ['type', 'name'])
    || typeof value.name !== 'string') return undefined;
  return { type: 'function', function: { name: value.name } };
}

/** Converts the small Responses surface emitted by Codex into the fixed Chat Completions request. */
export function translateResponsesRequest(body: unknown): ResponsesTranslation {
  if (!isRecord(body)) return { ok: false, error: 'invalid_request_body' };
  const allowed = [
    'model', 'instructions', 'input', 'stream', 'tools', 'tool_choice', 'max_output_tokens',
    'parallel_tool_calls', 'store', 'client_metadata', 'prompt_cache_key', 'include', 'reasoning',
    'temperature', 'top_p', 'stop', 'seed', 'presence_penalty', 'frequency_penalty', 'logit_bias',
  ] as const;
  if (!hasOnlyKeys(body, allowed)) return { ok: false, error: 'unsupported_request_field' };
  if (typeof body.model !== 'string' || body.model.length === 0) return { ok: false, error: 'model_required' };
  if (body.stream !== true) return { ok: false, error: 'streaming_required' };
  if (body.store !== undefined && body.store !== false) return { ok: false, error: 'stored_responses_unsupported' };
  if (body.instructions !== undefined && typeof body.instructions !== 'string') return { ok: false, error: 'invalid_instructions' };
  if (body.prompt_cache_key !== undefined && typeof body.prompt_cache_key !== 'string') return { ok: false, error: 'invalid_prompt_cache_key' };
  if (body.client_metadata !== undefined
    && (!isRecord(body.client_metadata) || Object.values(body.client_metadata).some((value) => typeof value !== 'string'))) {
    return { ok: false, error: 'invalid_client_metadata' };
  }
  if (body.include !== undefined
    && (!Array.isArray(body.include) || body.include.some((value) => value !== 'reasoning.encrypted_content'))) {
    return { ok: false, error: 'unsupported_include' };
  }
  if (body.reasoning !== undefined
    && (!isRecord(body.reasoning) || !hasOnlyKeys(body.reasoning, ['effort', 'summary'])
      || (body.reasoning.effort !== undefined && body.reasoning.effort !== 'none')
      || (body.reasoning.summary !== undefined && !['none', 'auto', 'concise', 'detailed'].includes(String(body.reasoning.summary))))) {
    return { ok: false, error: 'unsupported_reasoning_controls' };
  }
  if (body.parallel_tool_calls !== undefined && typeof body.parallel_tool_calls !== 'boolean') {
    return { ok: false, error: 'invalid_parallel_tool_calls' };
  }

  const messages: JsonRecord[] = [];
  if (body.instructions !== undefined) messages.push({ role: 'developer', content: body.instructions });
  const inputMessages = responseInputMessages(body.input);
  if (!inputMessages) return { ok: false, error: 'unsupported_input_item' };
  messages.push(...inputMessages);

  // The incoming stream:true is a Codex wire contract. The gateway service
  // class fixes stream=false in its normalized provider request.
  const chatRequest: JsonRecord = { model: body.model, messages };
  if (body.tools !== undefined) {
    const tools = responseTools(body.tools);
    if (!tools) return { ok: false, error: 'unsupported_tool' };
    if (tools.length) chatRequest.tools = tools;
  }
  if (body.tool_choice !== undefined) {
    const toolChoice = translatedToolChoice(body.tool_choice);
    if (toolChoice === undefined) return { ok: false, error: 'invalid_tool_choice' };
    chatRequest.tool_choice = toolChoice;
  }
  if (body.max_output_tokens !== undefined) {
    if (!Number.isInteger(body.max_output_tokens) || (body.max_output_tokens as number) <= 0) {
      return { ok: false, error: 'invalid_max_output_tokens' };
    }
    chatRequest.max_completion_tokens = body.max_output_tokens;
  }
  // Codex sends this optional hint even when its model catalog disables the
  // capability. The pinned provider does not advertise the parameter under
  // the gateway's require_parameters route, so forwarding it prevents dispatch.
  for (const key of ['temperature', 'top_p', 'stop', 'seed', 'presence_penalty', 'frequency_penalty', 'logit_bias']) {
    if (body[key] !== undefined) chatRequest[key] = body[key];
  }
  return { ok: true, chatRequest, responseModel: body.model };
}

interface StreamEvent {
  event: string;
  data: JsonRecord;
}

function usageFor(chat: JsonRecord): JsonRecord | null {
  if (!isRecord(chat.usage)) return null;
  const promptTokens = chat.usage.prompt_tokens;
  const completionTokens = chat.usage.completion_tokens;
  const totalTokens = chat.usage.total_tokens;
  if (![promptTokens, completionTokens, totalTokens].every((value) => Number.isInteger(value) && (value as number) >= 0)) return null;
  return {
    input_tokens: promptTokens,
    output_tokens: completionTokens,
    total_tokens: totalTokens,
  };
}

/** Builds the Responses SSE event sequence from one committed Chat Completions result. */
export function responsesEventStream(chatValue: unknown, model: string): string {
  if (!isRecord(chatValue) || !Array.isArray(chatValue.choices) || !isRecord(chatValue.choices[0])) {
    throw new Error('Gateway returned an invalid chat completion');
  }
  const choice = chatValue.choices[0];
  if (!isRecord(choice.message)) throw new Error('Gateway returned an invalid chat message');
  const message = choice.message;
  const responseSuffix = randomUUID().replaceAll('-', '');
  const responseId = `resp_${responseSuffix}`;
  const events: StreamEvent[] = [];
  let sequence = 0;
  const add = (event: string, data: JsonRecord): void => {
    events.push({ event, data: { ...data, sequence_number: sequence++ } });
  };
  const createdAt = Number.isInteger(chatValue.created) ? chatValue.created as number : Math.floor(Date.now() / 1000);
  const usage = usageFor(chatValue);
  const base: JsonRecord = {
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status: 'in_progress',
    completed_at: null,
    error: null,
    incomplete_details: null,
    model,
    output: [],
    parallel_tool_calls: true,
    metadata: {},
    usage: null,
  };
  add('response.created', { type: 'response.created', response: base });
  add('response.in_progress', { type: 'response.in_progress', response: base });

  const output: JsonRecord[] = [];
  const text = message.content;
  const refusal = message.refusal;
  if (text !== null && text !== undefined && typeof text !== 'string') {
    throw new Error('Gateway returned an unsupported chat content value');
  }
  if (refusal !== undefined && refusal !== null && typeof refusal !== 'string') {
    throw new Error('Gateway returned an invalid refusal value');
  }
  if (typeof text === 'string' || typeof refusal === 'string') {
    const itemId = `msg_${randomUUID().replaceAll('-', '')}`;
    const isRefusal = typeof refusal === 'string';
    const part: JsonRecord = isRefusal
      ? { type: 'refusal', refusal }
      : { type: 'output_text', text: text ?? '', annotations: [] };
    const item: JsonRecord = { id: itemId, type: 'message', status: 'completed', role: 'assistant', content: [part] };
    add('response.output_item.added', {
      type: 'response.output_item.added', output_index: output.length,
      item: { id: itemId, type: 'message', status: 'in_progress', role: 'assistant', content: [] },
    });
    add('response.content_part.added', {
      type: 'response.content_part.added', output_index: output.length, content_index: 0,
      part: isRefusal ? { type: 'refusal', refusal: '' } : { type: 'output_text', text: '', annotations: [] },
    });
    if (isRefusal) {
      add('response.refusal.delta', { type: 'response.refusal.delta', item_id: itemId, output_index: output.length, content_index: 0, delta: refusal });
      add('response.refusal.done', { type: 'response.refusal.done', item_id: itemId, output_index: output.length, content_index: 0, refusal });
    } else {
      add('response.output_text.delta', { type: 'response.output_text.delta', item_id: itemId, output_index: output.length, content_index: 0, delta: text });
      add('response.output_text.done', { type: 'response.output_text.done', item_id: itemId, output_index: output.length, content_index: 0, text });
    }
    add('response.content_part.done', { type: 'response.content_part.done', output_index: output.length, content_index: 0, part });
    add('response.output_item.done', { type: 'response.output_item.done', output_index: output.length, item });
    output.push(item);
  }

  if (message.tool_calls !== undefined) {
    if (!Array.isArray(message.tool_calls)) throw new Error('Gateway returned invalid tool calls');
    for (const callValue of message.tool_calls) {
      if (!isRecord(callValue) || callValue.type !== 'function' || !isRecord(callValue.function)
        || typeof callValue.function.name !== 'string' || typeof callValue.function.arguments !== 'string') {
        throw new Error('Gateway returned an invalid function call');
      }
      const callId = typeof callValue.id === 'string' ? callValue.id : `call_${randomUUID().replaceAll('-', '')}`;
      const itemId = `fc_${randomUUID().replaceAll('-', '')}`;
      const item: JsonRecord = {
        id: itemId,
        type: 'function_call',
        status: 'completed',
        call_id: callId,
        name: callValue.function.name,
        arguments: callValue.function.arguments,
      };
      add('response.output_item.added', {
        type: 'response.output_item.added', output_index: output.length,
        item: { ...item, status: 'in_progress', arguments: '' },
      });
      add('response.function_call_arguments.delta', {
        type: 'response.function_call_arguments.delta', item_id: itemId, output_index: output.length,
        delta: callValue.function.arguments,
      });
      add('response.function_call_arguments.done', {
        type: 'response.function_call_arguments.done', item_id: itemId, output_index: output.length,
        arguments: callValue.function.arguments,
      });
      add('response.output_item.done', { type: 'response.output_item.done', output_index: output.length, item });
      output.push(item);
    }
  }

  const incomplete = choice.finish_reason === 'length';
  const final: JsonRecord = {
    ...base,
    status: incomplete ? 'incomplete' : 'completed',
    completed_at: Math.floor(Date.now() / 1000),
    incomplete_details: incomplete ? { reason: 'max_output_tokens' } : null,
    output,
    ...(usage ? { usage } : {}),
  };
  add(incomplete ? 'response.incomplete' : 'response.completed', {
    type: incomplete ? 'response.incomplete' : 'response.completed', response: final,
  });
  return events.map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
}
