import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { codexModelsResponse } from './codex-profile.js';
import type { BaseProofMetricsSnapshot } from './proof-metrics.js';
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
} from '@zk-credits/x402-zk-prepaid';

const MAX_REQUEST_BYTES = 2_000_000;
const PAYMENT_HEADERS = [PAYMENT_REQUIRED_HEADER, PAYMENT_RESPONSE_HEADER, 'cache-control'] as const;

export interface PrepaidTransport {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export interface SidecarOptions {
  localToken: string;
  gatewayBaseUrl: string;
  prepaidClient: PrepaidTransport;
  /** Aggregate-only proof metrics served to the authenticated local operator. */
  metrics?: () => BaseProofMetricsSnapshot;
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
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7).trim();
  const apiKeyHeader = req.headers['x-api-key'];
  return typeof apiKeyHeader === 'string' ? apiKeyHeader.trim() : null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const STREAM_KEYS = ['stream', 'stream_options', 'streamOptions', 'stream-options'] as const;

/**
 * Rejects every request the pilot cannot serve before a single proof is
 * attempted: streaming, an absent model, and any non-completion body.
 */
function completionRejection(body: unknown): string | undefined {
  if (!isRecord(body)) return 'invalid_request_body';
  if (STREAM_KEYS.some((key) => Object.prototype.hasOwnProperty.call(body, key))) return 'streaming_not_supported';
  if (typeof body.model !== 'string' || body.model.length === 0) return 'model_required';
  return undefined;
}

async function relayGatewayResponse(res: ServerResponse, upstream: Response): Promise<void> {
  const contentType = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
  const headers: Record<string, string> = { 'Content-Type': contentType };
  for (const name of PAYMENT_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }
  res.writeHead(upstream.status, headers);
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

/** Creates a loopback-only proxy whose sole spend path is x402 zk-prepaid. */
export function createSidecarServer(options: SidecarOptions): RunningSidecar {
  const gatewayBaseUrl = options.gatewayBaseUrl.replace(/\/$/u, '');
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
    if (req.method === 'GET' && pathname === '/metrics') {
      if (token !== options.localToken) {
        sendJson(res, 401, { error: 'invalid_local_token' });
        return;
      }
      if (!options.metrics) {
        sendJson(res, 404, { error: 'metrics_unavailable' });
        return;
      }
      sendJson(res, 200, options.metrics());
      return;
    }
    if (req.method !== 'POST' || pathname !== '/v1/chat/completions') {
      sendJson(res, 404, { error: 'unsupported_openai_path' });
      return;
    }
    if (token !== options.localToken) {
      sendJson(res, 401, { error: 'invalid_local_token' });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const rejection = completionRejection(body.parsed);
      if (rejection) {
        sendJson(res, 400, { error: rejection });
        return;
      }
      const upstream = await options.prepaidClient.fetch(`${gatewayBaseUrl}${pathname}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body.raw,
      });
      await relayGatewayResponse(res, upstream);
    } catch (error: unknown) {
      if (!res.headersSent) {
        sendJson(res, 502, {
          error: 'sidecar_request_failed',
          message: error instanceof Error ? error.message : 'Loopback request failed',
        });
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
