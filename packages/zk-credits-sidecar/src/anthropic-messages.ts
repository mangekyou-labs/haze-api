export interface AnthropicContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicMessagesRequest {
  model?: string;
  system?: string | AnthropicContentBlock[];
  messages: AnthropicMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
  [key: string]: unknown;
}

export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAiChatRequest {
  model: string;
  messages: OpenAiMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream?: boolean;
  [key: string]: unknown;
}

export interface OpenAiChatResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index?: number;
    message?: {
      role?: string;
      content?: string | null;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface AnthropicMessageResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: Array<{ type: 'text'; text: string }>;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

function normalizeContent(content: string | AnthropicContentBlock[] | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (block && typeof block.text === 'string') return block.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function resolveModel(requestedModel?: string): string {
  if (!requestedModel) return 'openai/gpt-4o-mini';
  if (requestedModel.includes('/')) return requestedModel;
  return 'openai/gpt-4o-mini';
}

function mapFinishReason(
  reason: string | null | undefined,
): 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null {
  if (!reason || reason === 'stop') return 'end_turn';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'tool_calls' || reason === 'function_call') return 'tool_use';
  return 'end_turn';
}

export function anthropicErrorType(status: number): string {
  switch (status) {
    case 400:
      return 'invalid_request_error';
    case 401:
      return 'authentication_error';
    case 403:
      return 'permission_error';
    case 404:
      return 'not_found_error';
    case 413:
      return 'request_too_large';
    case 429:
      return 'rate_limit_error';
    case 529:
      return 'overloaded_error';
    default:
      return status >= 500 ? 'api_error' : 'invalid_request_error';
  }
}

export function translateAnthropicToOpenAi(
  request: AnthropicMessagesRequest,
): OpenAiChatRequest {
  const messages: OpenAiMessage[] = [];

  const systemContent = normalizeContent(request.system);
  if (systemContent) {
    messages.push({ role: 'system', content: systemContent });
  }

  for (const msg of request.messages || []) {
    const content = normalizeContent(msg.content);
    messages.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content,
    });
  }

  const openAiRequest: OpenAiChatRequest = {
    model: resolveModel(request.model),
    messages,
  };

  if (request.max_tokens !== undefined) {
    openAiRequest.max_tokens = request.max_tokens;
  }
  if (request.temperature !== undefined) {
    openAiRequest.temperature = request.temperature;
  }
  if (request.top_p !== undefined) {
    openAiRequest.top_p = request.top_p;
  }
  if (request.stop_sequences && request.stop_sequences.length > 0) {
    openAiRequest.stop = request.stop_sequences;
  }
  if (request.stream) {
    openAiRequest.stream = true;
  }

  return openAiRequest;
}

export function translateOpenAiToAnthropic(
  response: OpenAiChatResponse,
): AnthropicMessageResponse {
  const choice = response.choices?.[0];
  const text = choice?.message?.content ?? '';
  const stopReason = mapFinishReason(choice?.finish_reason);

  return {
    id: response.id?.startsWith('msg_')
      ? response.id
      : `msg_${response.id || 'zk_' + Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: response.model || 'openai/gpt-4o-mini',
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
    },
  };
}

export interface StreamTransformerOptions {
  model: string;
  id?: string;
}

export interface AnthropicStreamTransformer {
  transformChunk(chunk: unknown): string[];
  finish(): string[];
}

export function createAnthropicStreamTransformer(
  options: StreamTransformerOptions,
): AnthropicStreamTransformer {
  const messageId = options.id || `msg_zk_${Date.now()}`;
  const model = options.model;
  let started = false;
  let blockStarted = false;
  let blockIndex = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let finalStopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null = null;

  function sse(event: string, data: object): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  return {
    transformChunk(rawChunk: unknown): string[] {
      const chunk = rawChunk as {
        id?: string;
        choices?: Array<{
          index?: number;
          delta?: { content?: string; role?: string };
          finish_reason?: string | null;
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const out: string[] = [];

      if (!started) {
        started = true;
        out.push(
          sse('message_start', {
            type: 'message_start',
            message: {
              id: messageId,
              type: 'message',
              role: 'assistant',
              model,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 },
            },
          }),
        );
      }

      if (chunk.usage) {
        if (chunk.usage.prompt_tokens) promptTokens = chunk.usage.prompt_tokens;
        if (chunk.usage.completion_tokens)
          completionTokens = chunk.usage.completion_tokens;
      }

      const choice = chunk.choices?.[0];
      const deltaContent = choice?.delta?.content;

      if (deltaContent) {
        if (!blockStarted) {
          blockStarted = true;
          out.push(
            sse('content_block_start', {
              type: 'content_block_start',
              index: blockIndex,
              content_block: { type: 'text', text: '' },
            }),
          );
        }
        out.push(
          sse('content_block_delta', {
            type: 'content_block_delta',
            index: blockIndex,
            delta: { type: 'text_delta', text: deltaContent },
          }),
        );
      }

      if (choice?.finish_reason) {
        finalStopReason = mapFinishReason(choice.finish_reason);
      }

      return out;
    },

    finish(): string[] {
      const out: string[] = [];
      if (blockStarted) {
        out.push(
          sse('content_block_stop', {
            type: 'content_block_stop',
            index: blockIndex,
          }),
        );
      }
      out.push(
        sse('message_delta', {
          type: 'message_delta',
          delta: {
            stop_reason: finalStopReason || 'end_turn',
            stop_sequence: null,
          },
          usage: { output_tokens: completionTokens },
        }),
      );
      out.push(
        sse('message_stop', {
          type: 'message_stop',
        }),
      );
      return out;
    },
  };
}
