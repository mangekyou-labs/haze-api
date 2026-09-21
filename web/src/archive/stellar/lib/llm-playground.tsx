'use client';

import { useEffect, useState } from 'react';
import { generateChatProof } from '@/lib/crypto';
import { TicketLedger } from '@/lib/ticket-ledger';

const GATEWAY_BASE =
  process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001';
const DEFAULT_PROMPT = 'Reply with exactly: ZK API Credits works.';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

type RequestState = 'idle' | 'proving' | 'sending' | 'success' | 'error';

interface ChatResponse {
  id?: string;
  model?: string;
  provider?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: string | { message?: string };
  message?: string;
}

type ProviderReceipt = {
  generationId?: string;
  model?: string;
  provider?: string;
  totalCost?: number;
  latencyMs?: number;
};

function readSecretK(): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const request = indexedDB.open('zk-credits-crypto', 1);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('keys', 'readonly');
      const getRequest = transaction.objectStore('keys').get('secret_k');
      getRequest.onsuccess = () => {
        const hex = getRequest.result;
        if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/i.test(hex)) {
          resolve(null);
          return;
        }
        resolve(
          new Uint8Array(
            hex.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16)),
          ),
        );
      };
      getRequest.onerror = () => resolve(null);
    };
    request.onerror = () => resolve(null);
  });
}

function encodeProofHeader(proof: object, publicSignals: string[]): string {
  return btoa(JSON.stringify({ proof, pubSignals: publicSignals }));
}

function responseMessage(data: ChatResponse): string {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) return content;
  if (typeof data.error === 'string') return data.error;
  if (data.error && typeof data.error.message === 'string') {
    return data.error.message;
  }
  return data.message || 'The gateway returned no assistant message.';
}

function userFacingError(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : '';
  if (/not an input of the circuit|invalid witness length|witness.*circuit/i.test(message)) {
    return 'Browser proof artifacts are out of sync. Refresh after the deployment finishes updating its circuit files.';
  }
  return message || 'The LLM request failed.';
}

export function LlmPlayground({ gatewayConfigured }: { gatewayConfigured: boolean }) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [response, setResponse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestState, setRequestState] = useState<RequestState>('idle');
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [ticketIndex, setTicketIndex] = useState<number | null>(null);
  const [providerReceipt, setProviderReceipt] = useState<ProviderReceipt | null>(null);

  useEffect(() => {
    const onApiKeyReady = (event: Event) => {
      const detail = (event as CustomEvent<{ apiKey?: unknown }>).detail;
      if (typeof detail?.apiKey === 'string') setApiKey(detail.apiKey);
    };
    window.addEventListener('zk-credits-api-key-ready', onApiKeyReady);
    return () =>
      window.removeEventListener('zk-credits-api-key-ready', onApiKeyReady);
  }, []);

  async function generateResponse() {
    if (!apiKey) {
      setError('Generate an API key above before using the playground.');
      setRequestState('error');
      return;
    }
    if (!prompt.trim()) {
      setError('Enter a prompt first.');
      setRequestState('error');
      return;
    }

    setError(null);
    setResponse(null);
    setProviderReceipt(null);
    setTicketIndex(null);
    setRequestState('proving');
    const startedAt = performance.now();
    let reservedIndex: number | null = null;
    const ledger = new TicketLedger();
    const requestBody = {
      model,
      messages: [{ role: 'user', content: prompt.trim() }],
      max_tokens: 256,
    };

    try {
      const secretK = await readSecretK();
      if (!secretK) {
        throw new Error('This browser has no ZK identity. Recover or generate one first.');
      }

      const allocation = await ledger.reserveNext();
      reservedIndex = allocation.index;
      setTicketIndex(reservedIndex);
      const proof = await generateChatProof(secretK, reservedIndex, requestBody);

      setRequestState('sending');
      const res = await fetch(`${GATEWAY_BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-ZK-Proof': encodeProofHeader(proof.proof, proof.publicSignals),
        },
        body: JSON.stringify(requestBody),
      });
      const data = (await res.json()) as ChatResponse;
      if (!res.ok) throw new Error(responseMessage(data));

      await ledger.consume(reservedIndex);
      setResponse(responseMessage(data));
      setElapsedMs(Math.round(performance.now() - startedAt));
      setProviderReceipt({
        generationId: data.id,
        model: data.model || model,
        provider: data.provider,
        latencyMs: Math.round(performance.now() - startedAt),
      });
      setRequestState('success');
      window.dispatchEvent(new Event('zk-credits-status-refresh'));
    } catch (caught) {
      if (reservedIndex !== null) await ledger.skip(reservedIndex).catch(() => undefined);
      setError(userFacingError(caught));
      setRequestState('error');
    }
  }

  const busy = requestState === 'proving' || requestState === 'sending';

  return (
    <section className="rounded-2xl border border-indigo-500/30 bg-indigo-950/20 p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">LLM Playground</h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            Send one real OpenRouter request from this browser. Your ZK proof is
            generated and self-verified locally before the gateway forwards it.
          </p>
        </div>
        <span className="rounded-full border border-indigo-400/30 bg-indigo-400/10 px-3 py-1 text-xs font-medium text-indigo-300">
          proof-backed
        </span>
      </div>

      {!gatewayConfigured && (
        <div className="mb-4 rounded-lg border border-amber-900/60 bg-amber-950/30 p-3 text-sm text-amber-300">
          The gateway integration is not configured on this deployment.
        </div>
      )}
      {!apiKey && gatewayConfigured && (
        <div className="mb-4 rounded-lg border border-zinc-700 bg-zinc-950/60 p-3 text-sm text-zinc-300">
          Generate an API key above to unlock the playground.
        </div>
      )}

      <div className="space-y-4">
        <label className="block text-sm font-medium text-zinc-300" htmlFor="llm-model">
          Model
          <select
            id="llm-model"
            aria-label="Model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            disabled={busy}
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none transition-colors focus:border-indigo-400"
          >
            <option value="openai/gpt-4o-mini">OpenAI · GPT-4o mini</option>
            <option value="anthropic/claude-sonnet-4">Anthropic · Claude Sonnet 4</option>
            <option value="google/gemini-2.5-flash">Google · Gemini 2.5 Flash</option>
          </select>
        </label>

        <label className="block text-sm font-medium text-zinc-300" htmlFor="llm-prompt">
          Prompt
          <textarea
            id="llm-prompt"
            aria-label="Prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={busy}
            rows={4}
            className="mt-2 w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm leading-6 text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-indigo-400"
            placeholder="Ask the model anything…"
          />
        </label>

        <button
          type="button"
          onClick={() => void generateResponse()}
          disabled={busy || !gatewayConfigured || !apiKey}
          className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {requestState === 'proving'
            ? 'Generating proof locally…'
            : requestState === 'sending'
              ? 'Sending to OpenRouter…'
              : 'Generate response'}
        </button>
      </div>

      {error && (
        <div role="alert" className="mt-4 rounded-lg border border-red-900/60 bg-red-950/50 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {response && (
        <div className="mt-5 rounded-xl border border-green-500/30 bg-green-950/20 p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-green-300">Assistant response</p>
            {elapsedMs !== null && (
              <span className="text-xs text-green-400/80">{elapsedMs}ms · self-verified proof</span>
            )}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-6 text-green-50">{response}</p>
          {ticketIndex !== null && (
            <p className="mt-3 text-xs text-green-400/70">Ticket {ticketIndex} consumed · fixed Starter balance refreshed above</p>
          )}
          {providerReceipt && (
            <p className="mt-2 text-xs text-green-400/70">
              OpenRouter generation {providerReceipt.generationId || 'recorded'}
              {providerReceipt.provider ? ` · ${providerReceipt.provider}` : ''}
              {providerReceipt.model ? ` · ${providerReceipt.model}` : ''}
            </p>
          )}
          <p className="mt-3 text-xs text-green-400/70">
            Usage above refreshes after each accepted request. Provider metadata is operational evidence, not a public cryptographic receipt.{' '}
            <a
              href="https://openrouter.ai/logs"
              target="_blank"
              rel="noreferrer"
              className="text-indigo-300 underline decoration-indigo-400/40 underline-offset-2 hover:text-indigo-200"
            >
              View OpenRouter Logs
            </a>
          </p>
        </div>
      )}
    </section>
  );
}
