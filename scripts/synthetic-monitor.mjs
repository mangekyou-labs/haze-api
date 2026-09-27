#!/usr/bin/env node

const TIMEOUT_MS = 90_000;
const RETRIES = 2;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeBaseUrl(value, fallback) {
  return (value || fallback).replace(/\/$/, '');
}

async function check(label, url) {
  let lastError = 'unknown_error';
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    const started = Date.now();
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const durationMs = Date.now() - started;
      if (!response.ok) {
        lastError = `http_${response.status}`;
      } else {
        return { label, ok: true, status: response.status, durationMs };
      }
    } catch (error) {
      lastError = error?.name === 'TimeoutError' ? 'timeout' : 'unavailable';
    }
    if (attempt < RETRIES) await sleep(Math.min(5_000, 250 * (2 ** attempt)));
  }
  return { label, ok: false, error: lastError };
}

async function main() {
  const frontend = normalizeBaseUrl(process.env.FRONTEND_URL, 'http://localhost:3000');
  const gateway = normalizeBaseUrl(process.env.GATEWAY_URL, 'http://localhost:3001');
  const feeSponsor = process.env.FEE_SPONSOR_URL
    ? normalizeBaseUrl(process.env.FEE_SPONSOR_URL, '')
    : null;
  // Probe independently so the 90-second per-endpoint timeout and two
  // bounded retries cannot multiply into an unnecessarily long serial run.
  const checkPromises = [
    check('frontend', frontend),
    check('gateway health', `${gateway}/health`),
    check('contract status', `${gateway}/v1/contract-status`),
  ];
  if (feeSponsor) {
    checkPromises.push(check('fee sponsor health', `${feeSponsor}${process.env.FEE_SPONSOR_HEALTH_PATH || '/health'}`));
  } else if (process.env.REQUIRE_FEE_SPONSOR === 'true') {
    checkPromises.push(Promise.resolve({ label: 'fee sponsor health', ok: false, error: 'missing_url' }));
  } else {
    checkPromises.push(Promise.resolve({ label: 'fee sponsor health', ok: true, skipped: true }));
  }
  const checks = await Promise.all(checkPromises);

  const result = { generatedAt: new Date().toISOString(), checks };
  console.log(JSON.stringify(result, null, 2));
  if (checks.some((item) => !item.ok)) process.exitCode = 1;
}

main().catch(() => {
  console.error(JSON.stringify({ ok: false, error: 'monitor_failed' }));
  process.exitCode = 1;
});
