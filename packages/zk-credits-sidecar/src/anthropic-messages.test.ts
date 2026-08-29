import { describe, it, expect } from 'vitest';
import {
  anthropicErrorType,
  translateAnthropicToOpenAi,
  translateOpenAiToAnthropic,
  createAnthropicStreamTransformer,
} from './anthropic-messages.js';

describe('Anthropic Messages to OpenAI Chat Completions translator', () => {
  it('translates simple user message and string system prompt', () => {
    const anthropicReq = {
      model: 'claude-3-5-sonnet-20241022',
      system: 'You are a helpful assistant.',
      messages: [{ role: 'user', content: 'Hello!' }],
      max_tokens: 1024,
      temperature: 0.7,
    };

    const openAiReq = translateAnthropicToOpenAi(anthropicReq);

    expect(openAiReq.model).toBe('openai/gpt-4o-mini');
    expect(openAiReq.messages).toEqual([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello!' },
    ]);
    expect(openAiReq.max_tokens).toBe(1024);
    expect(openAiReq.temperature).toBe(0.7);
  });

  it('translates array system blocks and array content blocks', () => {
    const anthropicReq = {
      model: 'openai/gpt-4o-mini',
      system: [{ type: 'text', text: 'System instruction 1.' }],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'First part.' },
            { type: 'text', text: 'Second part.' },
          ],
        },
      ],
      stream: true,
    };

    const openAiReq = translateAnthropicToOpenAi(anthropicReq);

    expect(openAiReq.messages).toEqual([
      { role: 'system', content: 'System instruction 1.' },
      { role: 'user', content: 'First part.\nSecond part.' },
    ]);
    expect(openAiReq.stream).toBe(true);
  });

  it('translates stop_sequences to stop', () => {
    const anthropicReq = {
      model: 'claude-3-haiku',
      messages: [{ role: 'user', content: 'Hi' }],
      stop_sequences: ['STOP', 'END'],
      max_tokens: 100,
    };

    const openAiReq = translateAnthropicToOpenAi(anthropicReq);
    expect(openAiReq.stop).toEqual(['STOP', 'END']);
  });
});

describe('OpenAI Chat Completions to Anthropic Messages response translator', () => {
  it('translates standard completion response to Anthropic message format', () => {
    const openAiRes = {
      id: 'chatcmpl-12345',
      object: 'chat.completion',
      created: 1700000000,
      model: 'openai/gpt-4o-mini',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Hello, I am Claude Code over ZK Credits!',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 25,
        completion_tokens: 12,
        total_tokens: 37,
      },
    };

    const anthropicRes = translateOpenAiToAnthropic(openAiRes);

    expect(anthropicRes.id).toBe('msg_chatcmpl-12345');
    expect(anthropicRes.type).toBe('message');
    expect(anthropicRes.role).toBe('assistant');
    expect(anthropicRes.model).toBe('openai/gpt-4o-mini');
    expect(anthropicRes.content).toEqual([
      {
        type: 'text',
        text: 'Hello, I am Claude Code over ZK Credits!',
      },
    ]);
    expect(anthropicRes.stop_reason).toBe('end_turn');
    expect(anthropicRes.stop_sequence).toBeNull();
    expect(anthropicRes.usage).toEqual({
      input_tokens: 25,
      output_tokens: 12,
    });
  });

  it('maps finish_reason length to max_tokens and tool_calls to tool_use', () => {
    const openAiResLength = {
      id: 'chatcmpl-len',
      model: 'test',
      choices: [{ message: { content: 'cut off' }, finish_reason: 'length' }],
    };
    expect(translateOpenAiToAnthropic(openAiResLength).stop_reason).toBe(
      'max_tokens',
    );

    const openAiResTool = {
      id: 'chatcmpl-tool',
      model: 'test',
      choices: [{ message: { content: '' }, finish_reason: 'tool_calls' }],
    };
    expect(translateOpenAiToAnthropic(openAiResTool).stop_reason).toBe(
      'tool_use',
    );
  });
});

describe('Anthropic Error Type Mapping', () => {
  it('maps HTTP status codes to Anthropic error types', () => {
    expect(anthropicErrorType(400)).toBe('invalid_request_error');
    expect(anthropicErrorType(401)).toBe('authentication_error');
    expect(anthropicErrorType(403)).toBe('permission_error');
    expect(anthropicErrorType(404)).toBe('not_found_error');
    expect(anthropicErrorType(413)).toBe('request_too_large');
    expect(anthropicErrorType(429)).toBe('rate_limit_error');
    expect(anthropicErrorType(500)).toBe('api_error');
    expect(anthropicErrorType(502)).toBe('api_error');
    expect(anthropicErrorType(529)).toBe('overloaded_error');
  });
});

describe('Anthropic SSE Stream Transformer', () => {
  it('transforms OpenAI stream chunks into valid Anthropic SSE events', () => {
    const transformer = createAnthropicStreamTransformer({
      model: 'openai/gpt-4o-mini',
      id: 'msg_test_stream',
    });

    const events: string[] = [];

    // First chunk with initial content
    const chunk1 = {
      id: 'chatcmpl-s1',
      choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
    };
    events.push(...transformer.transformChunk(chunk1));

    // Second chunk
    const chunk2 = {
      id: 'chatcmpl-s1',
      choices: [{ index: 0, delta: { content: ' world' }, finish_reason: null }],
    };
    events.push(...transformer.transformChunk(chunk2));

    // Final chunk
    const chunk3 = {
      id: 'chatcmpl-s1',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    };
    events.push(...transformer.transformChunk(chunk3));
    events.push(...transformer.finish());

    const combined = events.join('\n');
    expect(combined).toContain('event: message_start');
    expect(combined).toContain('event: content_block_start');
    expect(combined).toContain('event: content_block_delta');
    expect(combined).toContain('Hello');
    expect(combined).toContain('world');
    expect(combined).toContain('event: content_block_stop');
    expect(combined).toContain('event: message_delta');
    expect(combined).toContain('event: message_stop');
  });
});
