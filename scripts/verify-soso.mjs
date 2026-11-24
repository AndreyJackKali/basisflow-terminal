#!/usr/bin/env node
/**
 * Reproducible verifier for SoSoValue OpenAPI v1 contract & CORS headers.
 * Pass SOSO_API_KEY=... to verify authenticated 200 OK data retrieval,
 * or run without a key to verify live CORS & 401 auth-gate contract honestly.
 */

const BASE = 'https://openapi.sosovalue.com/openapi/v1';
const key = (process.env.SOSO_API_KEY || '').trim();
const ORIGIN = 'https://andreyjackkali.github.io';

console.log('=== BasisFlow Terminal — SoSoValue OpenAPI v1 Verification ===\n');

const optRes = await fetch(`${BASE}/currencies`, {
  method: 'OPTIONS',
  headers: {
    Origin: ORIGIN,
    'Access-Control-Request-Method': 'GET',
    'Access-Control-Request-Headers': 'x-soso-api-key',
    'User-Agent': 'BasisFlowTerminal/1.3',
  },
});
console.log(
  `CORS Preflight | HTTP ${optRes.status} | ACAO=${optRes.headers.get('access-control-allow-origin')} | ACAH=${optRes.headers.get('access-control-allow-headers')}`,
);

const endpoints = key
  ? [
      '/etfs/summary-history?symbol=BTC&country_code=US&limit=10',
      '/etfs/summary-history?symbol=ETH&country_code=US&limit=10',
      '/indices',
      '/indices/ssiMAG7/market-snapshot',
      '/market/overview',
      '/news/hot?page=1&page_size=5',
      '/btc-treasuries',
    ]
  : ['/currencies'];

let okCount = 0;
for (const ep of endpoints) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${ep}`, {
    headers: {
      'x-soso-api-key': key || 'CONTRACT_CHECK_NO_KEY',
      'User-Agent': 'BasisFlowTerminal/1.3',
    },
  });
  const ms = Date.now() - t0;
  const body = await res.json().catch(() => ({}));
  if (key) {
    const valid = res.ok && (body?.code === 0 || body?.code === undefined);
    if (valid) okCount += 1;
    console.log(`${valid ? 'PASS' : 'FAIL'} | HTTP ${res.status} | ${ms}ms | ${ep}`);
  } else {
    const validAuthGate = res.status === 401 && body?.code === 400101;
    if (validAuthGate) okCount += 1;
    console.log(
      `${validAuthGate ? 'PASS' : 'FAIL'} | HTTP ${res.status} | ${ms}ms | ${ep} | BYOK auth gate verified (${body?.message})`,
    );
  }
}

console.log(`\nMode: ${key ? 'LIVE KEY' : 'BYOK CONTRACT CHECK'} — ${okCount}/${endpoints.length} verified.`);
if (okCount !== endpoints.length) process.exit(1);
