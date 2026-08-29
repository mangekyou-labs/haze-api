import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  anthropicErrorType,
  createAnthropicStreamTransformer,
  translateAnthropicToOpenAi,
  translateOpenAiToAnthropic,
  type AnthropicMessagesRequest,
  type OpenAiChatResponse,
} from './anthropic-messages.js';
import { codexModelsResponse } from './codex-profile.js';
import { TicketLedger } from './ticket-ledger.js';
const MAX_REQUEST_BYTES = 2_000_000;

export interface ProofGeneratorInput {
  ticketIndex: number;
  request: unknown;
}

export type ProofGenerator = (input: ProofGeneratorInput) => Promise<{
  proof: object;
  pubSignals: string[];
}>;

export type GatewayFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface SidecarOptions {
  localToken: string;
  gatewayBaseUrl: string;
  compatibilityKey: string;
  ledger: TicketLedger;
  proofGenerator: ProofGenerator;
  gatewayFetch?: GatewayFetch;
}

export interface RunningSidecar {
  listen(port?: number): Promise<string>;
  close(): Promise<void>;
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function extractLocalToken(req: IncomingMessage): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const apiKeyHeader = req.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string') {
    return apiKeyHeader.trim();
  }
  return null;
}
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<{ raw: string; parsed: unknown }> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_REQUEST_BYTES) throw new Error('OpenAI request exceeds the loopback size limit');
    chunks.push(bytes);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) throw new Error('OpenAI request body is required');
  try {
    return { raw, parsed: JSON.parse(raw) as unknown };
  } catch {
    throw new Error('OpenAI request body must be valid JSON');
  }
}

async function relayGatewayResponse(res: ServerResponse, upstream: Response): Promise<void> {
  const contentType = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
  res.writeHead(upstream.status, { 'Content-Type': contentType });
  if (!upstream.body) {
    res.end();
    return;
  }
  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } finally {
    reader.releaseLock();
  }
}

function proofHeader(proof: { proof: object; pubSignals: string[] }): string {
  return Buffer.from(JSON.stringify(proof)).toString('base64');
}

/**
 * Creates a loopback-only OpenAI-compatible proxy. The local bearer never
 * reaches Render; only the shared compatibility bearer and a fresh proof do.
 */
export function createSidecarServer(options: SidecarOptions): RunningSidecar {
  const gatewayBaseUrl = options.gatewayBaseUrl.replace(/\/$/, '');
  const gatewayFetch = options.gatewayFetch ?? fetch;
  let server: Server | null = null;
  const inFlight = new Set<Promise<void>>();

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      sendJson(res, 403, { error: 'loopback_only' });
      return;
    }
    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, { service: 'zk-credits-sidecar', status: 'ok' });
      return;
    }
    const token = extractLocalToken(req);

    if (req.method === 'GET' && pathname === '/v1/models') {
      if (token !== options.localToken) {
        sendJson(res, 401, { error: 'invalid_local_token' });
        return;
      }
      sendJson(res, 200, codexModelsResponse());
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/messages') {
      if (token !== options.localToken) {
        sendJson(res, 401, { error: 'invalid_local_token' });
        return;
      }
      try {
        const body = await readJsonBody(req);
        const anthropicReq = body.parsed as AnthropicMessagesRequest;
        const openAiReq = translateAnthropicToOpenAi(anthropicReq);
        const rawOpenAiBody = JSON.stringify(openAiReq);

        const reservation = await options.ledger.reserve(openAiReq);
        const proof = await options.proofGenerator({
          ticketIndex: reservation.index,
          request: openAiReq,
        });
        const upstream = await gatewayFetch(`${gatewayBaseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.compatibilityKey}`,
            'Content-Type': 'application/json',
            'X-ZK-Proof': proofHeader(proof),
          },
          body: rawOpenAiBody,
        });

        if (upstream.status >= 200 && upstream.status < 300 && upstream.status !== 202) {
          await options.ledger.consume(reservation.requestDigest);
        }

        if (!upstream.ok) {
          const rawText = await upstream.text();
          let errorMsg =
            rawText.trim() || `Gateway returned HTTP ${upstream.status}`;
          try {
            const errJson: unknown = JSON.parse(rawText);
            if (errJson && typeof errJson === 'object') {
              if ('error' in errJson && typeof errJson.error === 'string') {
                errorMsg = errJson.error;
              } else if (
                'error' in errJson &&
                errJson.error &&
                typeof errJson.error === 'object' &&
                'message' in errJson.error &&
                typeof errJson.error.message === 'string'
              ) {
                errorMsg = errJson.error.message;
              } else if (
                'message' in errJson &&
                typeof errJson.message === 'string'
              ) {
                errorMsg = errJson.message;
              }
            }
          } catch {
            // rawText is preserved as errorMsg
          }
          sendJson(res, upstream.status, {
            type: 'error',
            error: {
              type: anthropicErrorType(upstream.status),
              message: errorMsg,
            },
          });
          return;
        }

        if (openAiReq.stream) {
          res.writeHead(upstream.status, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          if (!upstream.body) {
            res.end();
            return;
          }
          const transformer = createAnthropicStreamTransformer({
            model: openAiReq.model,
          });
          const reader = upstream.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('data: ')) {
                const dataStr = trimmed.slice(6);
                if (dataStr === '[DONE]') continue;
                try {
                  const parsedChunk = JSON.parse(dataStr);
                  const sseEvents = transformer.transformChunk(parsedChunk);
                  for (const evt of sseEvents) res.write(evt);
                } catch {
                  // ignore non-JSON chunk
                }
              }
            }
          }
          const finishEvents = transformer.finish();
          for (const evt of finishEvents) res.write(evt);
          res.end();
        } else {
          const openAiRes = (await upstream.json()) as OpenAiChatResponse;
          const anthropicRes = translateOpenAiToAnthropic(openAiRes);
          sendJson(res, upstream.status, anthropicRes);
        }
      } catch (error: unknown) {
        if (!res.headersSent) {
          const message = error instanceof Error ? error.message : 'Loopback request failed';
          sendJson(res, 502, { error: 'sidecar_request_failed', message });
        } else if (!res.writableEnded) {
          res.end();
        }
      }
      return;
    }

    if (req.method !== 'POST' || (pathname !== '/v1/chat/completions' && pathname !== '/v1/responses')) {
      sendJson(res, 404, { error: 'unsupported_openai_path' });
      return;
    }
    if (token !== options.localToken) {
      sendJson(res, 401, { error: 'invalid_local_token' });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const reservation = await options.ledger.reserve(body.parsed);
      const proof = await options.proofGenerator({
        ticketIndex: reservation.index,
        request: body.parsed,
      });
      const upstream = await gatewayFetch(`${gatewayBaseUrl}${pathname}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.compatibilityKey}`,
          'Content-Type': 'application/json',
          'X-ZK-Proof': proofHeader(proof),
        },
        body: body.raw,
      });
      await relayGatewayResponse(res, upstream);
      if (upstream.status >= 200 && upstream.status < 300 && upstream.status !== 202) {
        await options.ledger.consume(reservation.requestDigest);
      }
    } catch (error: unknown) {
      if (!res.headersSent) {
        const message = error instanceof Error ? error.message : 'Loopback request failed';
        sendJson(res, 502, { error: 'sidecar_request_failed', message });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  };

  return {
    async listen(port = 0): Promise<string> {
      if (server) throw new Error('ZK Credits sidecar is already running');
      server = createServer((req, res) => {
        const request = handler(req, res).finally(() => inFlight.delete(request));
        inFlight.add(request);
      });
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(port, '127.0.0.1', () => {
          server!.off('error', reject);
          resolve();
        });
      });
      const address = server.address() as AddressInfo;
      return `http://127.0.0.1:${address.port}`;
    },
    async close(): Promise<void> {
      if (!server) return;
      const activeServer = server;
      server = null;
      await new Promise<void>((resolve, reject) => activeServer.close((error) => {
        if (error) reject(error);
        else resolve();
      }));
      await Promise.all(inFlight);
    },
  };
}
