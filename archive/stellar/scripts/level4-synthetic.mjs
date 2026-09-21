#!/usr/bin/env node

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REQUIRED_ENV = [
  'LEVEL4_FRONTEND_URL',
  'LEVEL4_GATEWAY_URL',
  'LEVEL4_FEE_SPONSOR_URL',
];

const TARGETS = [
  { name: 'frontend', env: 'LEVEL4_FRONTEND_URL', path: '/' },
  { name: 'gateway-health', env: 'LEVEL4_GATEWAY_URL', path: '/health' },
  { name: 'gateway-contract-status', env: 'LEVEL4_GATEWAY_URL', path: '/v1/contract-status' },
  { name: 'fee-sponsor-health', env: 'LEVEL4_FEE_SPONSOR_URL', path: '/health' },
];

const DEFAULT_PASSES = 3;
const DEFAULT_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAY_MS = 250;

export function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('A service URL is required');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Service URLs must be valid http or https URLs');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Service URLs must use http or https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Service URLs must not contain credentials');
  }
  return parsed.toString().replace(/\/+$/, '');
}

export function resolveMonitorConfig(env = process.env) {
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required Level 4 monitor variables: ${missing.join(', ')}`);
  }

  return Object.fromEntries(
    REQUIRED_ENV.map((name) => [name, normalizeBaseUrl(env[name])]),
  );
}

function safeErrorClass(error) {
  if (error?.name === 'AbortError') return 'timeout';
  if (error instanceof TypeError) return 'network_error';
  return 'request_error';
}

function shouldRetry(status, errorClass) {
  return errorClass !== undefined || status === 408 || status === 429 || status >= 500;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function probeEndpoint(
  baseUrl,
  endpointPath,
  {
    fetchImpl = fetch,
    retries = DEFAULT_RETRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  } = {},
) {
  const url = `${normalizeBaseUrl(baseUrl)}${endpointPath}`;
  const maxAttempts = Math.max(1, Math.floor(retries) + 1);
  let lastResult;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json, text/html' },
        redirect: 'manual',
        cache: 'no-store',
        signal: controller.signal,
      });
      const durationMs = Date.now() - startedAt;
      const ok = response.status >= 200 && response.status < 400;
      lastResult = {
        ok,
        status: response.status,
        attempts: attempt,
        durationMs,
        ...(ok || !shouldRetry(response.status) ? {} : { errorClass: `http_${response.status}` }),
      };
      if (ok || !shouldRetry(response.status)) return lastResult;
    } catch (error) {
      lastResult = {
        ok: false,
        attempts: attempt,
        durationMs: Date.now() - startedAt,
        errorClass: safeErrorClass(error),
      };
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < maxAttempts && retryDelayMs > 0) await wait(retryDelayMs);
  }

  return lastResult;
}

export async function runMonitor({
  env = process.env,
  passes = Number(env.LEVEL4_SYNTHETIC_PASSES ?? DEFAULT_PASSES),
  retries = Number(env.LEVEL4_SYNTHETIC_RETRIES ?? DEFAULT_RETRIES),
  timeoutMs = Number(env.LEVEL4_SYNTHETIC_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  retryDelayMs = Number(env.LEVEL4_SYNTHETIC_RETRY_DELAY_MS ?? DEFAULT_RETRY_DELAY_MS),
  fetchImpl = fetch,
} = {}) {
  const config = resolveMonitorConfig(env);
  const passCount = Math.max(1, Math.floor(Number.isFinite(passes) ? passes : DEFAULT_PASSES));
  const passResults = [];

  for (let index = 0; index < passCount; index += 1) {
    const checks = await Promise.all(TARGETS.map(async (target) => ({
      service: target.name,
      ...(await probeEndpoint(config[target.env], target.path, {
        fetchImpl,
        retries,
        timeoutMs,
        retryDelayMs,
      })),
    })));
    passResults.push({
      kind: index === 0 ? 'cold' : 'warm',
      ok: checks.every((check) => check.ok),
      checks,
    });
  }

  return {
    ok: passResults.every((pass) => pass.ok),
    passes: passResults,
  };
}

export function formatMonitorSummary(result) {
  return result.passes.map((pass, index) => {
    const checks = pass.checks.map((check) => {
      const state = check.ok ? `ok:${check.status}` : `failed:${check.errorClass ?? `http_${check.status}`}`;
      return `${check.service}=${state}/${check.durationMs}ms/${check.attempts} attempt(s)`;
    }).join(' ');
    return `pass ${index + 1} (${pass.kind}) ${pass.ok ? 'ok' : 'failed'} ${checks}`;
  }).join('\n');
}

async function main() {
  try {
    const result = await runMonitor();
    console.log(formatMonitorSummary(result));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Level 4 synthetic monitor failed');
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === entrypoint) void main();
