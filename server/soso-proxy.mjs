#!/usr/bin/env node
/**
 * BasisFlow Terminal — Zero-Dep SoSoValue OpenAPI v1 Secure Proxy
 *
 * Reads SOSO_API_KEY strictly from environment (never bundled into client code,
 * never logged, never returned in any HTTP response).
 *
 * Endpoints:
 *   GET /health                  -> Proxy liveness & cache status (no secrets)
 *   GET /api/soso/snapshot       -> Live aggregated ETF, SSI, Overview, News & Treasuries JSON (60s TTL cache)
 *   GET /api/soso/v1/<allowlist> -> Rate-limited, cached pass-through to https://openapi.sosovalue.com/openapi/v1/*
 *
 * Usage:
 *   SOSO_API_KEY=... node server/soso-proxy.mjs
 *   PORT=9105 SOSO_API_KEY=... npm run soso:proxy
 */

import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || process.env.SOSO_PROXY_PORT || 9105);
const HOST = process.env.HOST || '127.0.0.1';
const SOSO_BASE = 'https://openapi.sosovalue.com/openapi/v1';
const API_KEY = (process.env.SOSO_API_KEY || '').trim();
const CACHE_TTL_MS = Number(process.env.SOSO_CACHE_TTL_MS || 60_000);
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQ = Number(process.env.SOSO_RATE_LIMIT || 45);
const STARTED_AT = Date.now();

const ALLOWED_V1_PREFIXES = [
  '/etfs',
  '/indices',
  '/market',
  '/news',
  '/btc-treasuries',
  '/currencies',
];

const SSI_TRACKED = [
  'ssiMAG7',
  'ssiLayer1',
  'ssiDeFi',
  'ssiAI',
  'ssiRWA',
  'ssiMeme',
  'ssiLayer2',
  'ssiCeFi',
  'ssiDePIN',
  'ssiPayFi',
  'ssiGameFi',
  'ssiSocialFi',
  'ssiNFT',
];

/** @type {Map<string, { expiresAt: number; payload: unknown; status: number }>} */
const responseCache = new Map();
/** @type {Map<string, { count: number; resetAt: number }>} */
const rateBuckets = new Map();

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=30',
    ...extra,
  };
}

function sendJson(res, status, data, extraHeaders = {}) {
  let body = JSON.stringify(data);
  if (API_KEY && body.includes(API_KEY)) {
    body = body.split(API_KEY).join('[REDACTED]');
  }
  res.writeHead(status, corsHeaders(extraHeaders));
  res.end(body);
}

function checkRateLimit(clientKey) {
  const now = Date.now();
  let bucket = rateBuckets.get(clientKey);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateBuckets.set(clientKey, bucket);
  }
  bucket.count += 1;
  return {
    allowed: bucket.count <= RATE_LIMIT_MAX_REQ,
    remaining: Math.max(0, RATE_LIMIT_MAX_REQ - bucket.count),
    resetAt: bucket.resetAt,
  };
}

async function fetchSosoV1(pathAndQuery) {
  const cacheKey = `v1:${pathAndQuery}`;
  const now = Date.now();
  const cached = responseCache.get(cacheKey);
  if (cached && now < cached.expiresAt) {
    return { ...cached, cached: true };
  }
  if (!API_KEY) {
    return {
      status: 503,
      payload: { code: 503, message: 'SOSO_API_KEY not configured on proxy server' },
      cached: false,
    };
  }
  const upstreamUrl = `${SOSO_BASE}${pathAndQuery}`;
  const res = await fetch(upstreamUrl, {
    headers: {
      'x-soso-api-key': API_KEY,
      'User-Agent': 'BasisFlowTerminal-Proxy/1.3',
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { code: res.status, message: 'Upstream non-JSON response' };
  }
  if (res.ok) {
    responseCache.set(cacheKey, {
      expiresAt: now + CACHE_TTL_MS,
      payload,
      status: res.status,
    });
  }
  return { status: res.status, payload, cached: false };
}

function computeZScore(rows) {
  const flows = (rows || [])
    .slice(0, 30)
    .map((r) => Number(r?.total_net_inflow ?? r?.totalNetInflow ?? NaN))
    .filter((v) => Number.isFinite(v));
  if (flows.length < 5) return 0;
  const mean = flows.reduce((a, b) => a + b, 0) / flows.length;
  const std = Math.sqrt(flows.reduce((a, b) => a + (b - mean) ** 2, 0) / flows.length) || 1;
  return Number(Math.max(-3, Math.min(3, (flows[0] - mean) / std)).toFixed(2));
}

async function buildLiveSnapshot() {
  const cacheKey = 'snapshot:full';
  const now = Date.now();
  const cached = responseCache.get(cacheKey);
  if (cached && now < cached.expiresAt) {
    return { status: 200, payload: cached.payload, cached: true };
  }

  const [btcEtf, ethEtf, solEtf, xrpEtf, overview, idxList, news, treasuries, mag7Const, defiConst] =
    await Promise.all([
      fetchSosoV1('/etfs/summary-history?symbol=BTC&country_code=US&limit=30'),
      fetchSosoV1('/etfs/summary-history?symbol=ETH&country_code=US&limit=30'),
      fetchSosoV1('/etfs/summary-history?symbol=SOL&country_code=US&limit=15'),
      fetchSosoV1('/etfs/summary-history?symbol=XRP&country_code=US&limit=15'),
      fetchSosoV1('/market/overview'),
      fetchSosoV1('/indices'),
      fetchSosoV1('/news/hot?page=1&page_size=8'),
      fetchSosoV1('/btc-treasuries'),
      fetchSosoV1('/indices/ssiMAG7/constituents'),
      fetchSosoV1('/indices/ssiDeFi/constituents'),
    ]);

  const rawIndexTickers = Array.isArray(idxList.payload?.data) ? idxList.payload.data : SSI_TRACKED;
  const tickers = rawIndexTickers.filter((t) => typeof t === 'string').slice(0, 13);

  const snapshots = await Promise.all(
    tickers.map(async (ticker) => {
      const snap = await fetchSosoV1(`/indices/${encodeURIComponent(ticker)}/market-snapshot`);
      const d = snap.payload?.data || {};
      return {
        ticker,
        price: Number(d.price ?? 0),
        changePct24h: Number(d.change_pct_24h ?? 0),
        roi7d: Number(d.roi_7d ?? 0),
        roi1m: Number(d.roi_1m ?? 0),
        roi3m: Number(d.roi_3m ?? 0),
        roi1y: Number(d.roi_1y ?? 0),
        ytd: Number(d.ytd ?? 0),
        constituents:
          ticker === 'ssiMAG7' && Array.isArray(mag7Const.payload?.data)
            ? mag7Const.payload.data
            : ticker === 'ssiDeFi' && Array.isArray(defiConst.payload?.data)
              ? defiConst.payload.data
              : undefined,
      };
    }),
  );

  const normalizeEtf = (res) =>
    (Array.isArray(res.payload?.data) ? res.payload.data : []).map((r) => ({
      date: String(r.date ?? ''),
      totalNetInflow: Number(r.total_net_inflow ?? 0),
      totalValueTraded: Number(r.total_value_traded ?? 0),
      totalNetAssets: Number(r.total_net_assets ?? 0),
      cumNetInflow: Number(r.cum_net_inflow ?? 0),
    }));

  const btcHistory = normalizeEtf(btcEtf);
  const ethHistory = normalizeEtf(ethEtf);
  const solHistory = normalizeEtf(solEtf);
  const xrpHistory = normalizeEtf(xrpEtf);

  const ov = overview.payload?.data || {};
  const newsList = Array.isArray(news.payload?.data?.list)
    ? news.payload.data.list.slice(0, 8).map((n) => ({
        id: String(n.id ?? ''),
        title: String(n.title ?? ''),
        summary: String(n.content ?? '').slice(0, 220),
        sourceLink: String(n.source_link ?? ''),
        releaseTime: Number(n.release_time ?? 0),
      }))
    : [];
  const treasList = Array.isArray(treasuries.payload?.data)
    ? treasuries.payload.data.slice(0, 15).map((t) => ({
        ticker: String(t.ticker ?? ''),
        name: String(t.name ?? ''),
        listLocation: String(t.list_location ?? ''),
      }))
    : [];

  const payload = {
    schemaVersion: '1.3.0',
    source: 'SoSoValue OpenAPI v1 (Live Proxy)',
    fetchedAt: new Date().toISOString(),
    fetchedDateUtc: new Date().toISOString().slice(0, 10),
    endpointsVerified: 10 + tickers.length,
    marketOverview: {
      totalMarketCap: Number(ov.total_market_cap ?? 0),
      totalMarketCapChangePct: Number(ov.total_market_cap_change_pct ?? 0),
      totalVolume24h: Number(ov.total_volume_24h ?? 0),
      ethGasGwei: Number(ov.eth_gas_gwei ?? 0),
      btcGasSatVb: Number(ov.btc_gas_sat_vb ?? 0),
      asOf: Number(ov.as_of ?? Date.now()),
    },
    etfFlows: {
      BTC: btcHistory,
      ETH: ethHistory,
      SOL: solHistory,
      XRP: xrpHistory,
    },
    btcEtfFlowZScore: computeZScore(btcEtf.payload?.data),
    ethEtfFlowZScore: computeZScore(ethEtf.payload?.data),
    ssiIndices: snapshots.filter((s) => s.price > 0),
    hotNews: newsList,
    treasuries: treasList,
  };

  responseCache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, payload, status: 200 });
  return { status: 200, payload, cached: false };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  const clientIp = req.socket.remoteAddress || 'unknown';
  const rl = checkRateLimit(clientIp);
  if (!rl.allowed) {
    sendJson(
      res,
      429,
      { error: 'Rate limit exceeded. Retry shortly.' },
      { 'X-RateLimit-Remaining': '0' },
    );
    return;
  }

  const parsed = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const pathname = parsed.pathname;

  try {
    if (pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'basisflow-soso-proxy',
        version: '1.3.0',
        hasApiKey: Boolean(API_KEY),
        cacheEntries: responseCache.size,
        uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
      });
      return;
    }

    if (pathname === '/api/soso/snapshot') {
      if (!API_KEY) {
        sendJson(res, 503, { error: 'SOSO_API_KEY env var not set on proxy process' });
        return;
      }
      const snap = await buildLiveSnapshot();
      sendJson(res, snap.status, snap.payload, {
        'X-Cache': snap.cached ? 'HIT' : 'MISS',
        'X-RateLimit-Remaining': String(rl.remaining),
      });
      return;
    }

    if (pathname.startsWith('/api/soso/v1/')) {
      const subPath = pathname.slice('/api/soso/v1'.length);
      const allowed = ALLOWED_V1_PREFIXES.some(
        (prefix) => subPath === prefix || subPath.startsWith(`${prefix}/`),
      );
      if (!allowed) {
        sendJson(res, 403, { error: `Path not allowlisted: ${subPath}` });
        return;
      }
      const upstream = await fetchSosoV1(`${subPath}${parsed.search}`);
      sendJson(res, upstream.status, upstream.payload, {
        'X-Cache': upstream.cached ? 'HIT' : 'MISS',
        'X-RateLimit-Remaining': String(rl.remaining),
      });
      return;
    }

    sendJson(res, 404, {
      error: 'Not Found',
      routes: ['/health', '/api/soso/snapshot', '/api/soso/v1/*'],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Upstream error';
    sendJson(res, 502, { error: API_KEY ? msg.split(API_KEY).join('[REDACTED]') : msg });
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    `[basisflow-soso-proxy] listening on http://${HOST}:${PORT} | apiKey=${API_KEY ? 'CONFIGURED' : 'MISSING'} | cacheTtl=${CACHE_TTL_MS}ms`,
  );
});
