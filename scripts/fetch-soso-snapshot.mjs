#!/usr/bin/env node
/**
 * BasisFlow Terminal — Live SoSoValue OpenAPI v1 Snapshot Generator
 *
 * Reads SOSO_API_KEY from process.env.SOSO_API_KEY OR --key-file <path/to/json>
 * (reads strictly in memory; NEVER logs, echoes, or writes credentials anywhere).
 *
 * Fetches verified live SoSoValue OpenAPI v1 data:
 *   - Global Market Overview (/market/overview)
 *   - US Spot BTC, ETH, SOL, XRP ETF Flow History (/etfs/summary-history)
 *   - US Spot BTC ETF Product Roster (/etfs?symbol=BTC&country_code=US)
 *   - All 13 SoSoValue SSI Crypto Sector Indices + Live Market Snapshots + Constituents
 *   - Hot Institutional News (/news/hot)
 *   - Corporate BTC Treasuries (/btc-treasuries)
 *
 * Writes sanitized JSON to public/data/soso-snapshot.json after an automated
 * zero-credential self-audit check.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'public', 'data', 'soso-snapshot.json');
const SOSO_BASE = 'https://openapi.sosovalue.com/openapi/v1';

function loadApiKey() {
  const args = process.argv.slice(2);
  const keyFileIdx = args.indexOf('--key-file');
  if (keyFileIdx !== -1 && args[keyFileIdx + 1]) {
    const filePath = path.resolve(args[keyFileIdx + 1]);
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const k = String(parsed.api_key || parsed.apiKey || parsed.key || '').trim();
    if (!k) throw new Error('Key file did not contain api_key');
    return k;
  }
  const envKey = (process.env.SOSO_API_KEY || '').trim();
  if (!envKey) {
    throw new Error('Provide SOSO_API_KEY env var or --key-file <path/to/sosovalue.json>');
  }
  return envKey;
}

async function fetchJson(apiKey, endpoint) {
  const t0 = Date.now();
  const res = await fetch(`${SOSO_BASE}${endpoint}`, {
    headers: {
      'x-soso-api-key': apiKey,
      'User-Agent': 'BasisFlowTerminal-Snapshot/1.3',
      Accept: 'application/json',
    },
  });
  const ms = Date.now() - t0;
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${endpoint} (${ms}ms)`);
  }
  const json = await res.json();
  if (json.code !== undefined && json.code !== 0) {
    throw new Error(`SoSoValue API error code ${json.code} on ${endpoint}: ${json.message}`);
  }
  console.log(`PASS | HTTP ${res.status} | ${ms}ms | ${endpoint}`);
  return json.data;
}

function computeZScore(rows) {
  const flows = (rows || [])
    .slice(0, 30)
    .map((r) => Number(r?.total_net_inflow ?? NaN))
    .filter((v) => Number.isFinite(v));
  if (flows.length < 5) return 0;
  const mean = flows.reduce((a, b) => a + b, 0) / flows.length;
  const std = Math.sqrt(flows.reduce((a, b) => a + (b - mean) ** 2, 0) / flows.length) || 1;
  return Number(Math.max(-3, Math.min(3, (flows[0] - mean) / std)).toFixed(2));
}

function normalizeEtfRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    date: String(r.date ?? ''),
    totalNetInflow: Number(r.total_net_inflow ?? 0),
    totalValueTraded: Number(r.total_value_traded ?? 0),
    totalNetAssets: Number(r.total_net_assets ?? 0),
    cumNetInflow: Number(r.cum_net_inflow ?? 0),
  }));
}

async function main() {
  const apiKey = loadApiKey();
  console.log('=== BasisFlow Terminal — Fetching Live SoSoValue OpenAPI v1 Snapshot ===\n');

  const [
    btcEtfRaw,
    ethEtfRaw,
    solEtfRaw,
    xrpEtfRaw,
    btcProductsRaw,
    overviewRaw,
    indicesListRaw,
    newsRaw,
    treasuriesRaw,
    mag7ConstRaw,
    defiConstRaw,
  ] = await Promise.all([
    fetchJson(apiKey, '/etfs/summary-history?symbol=BTC&country_code=US&limit=30'),
    fetchJson(apiKey, '/etfs/summary-history?symbol=ETH&country_code=US&limit=30'),
    fetchJson(apiKey, '/etfs/summary-history?symbol=SOL&country_code=US&limit=15'),
    fetchJson(apiKey, '/etfs/summary-history?symbol=XRP&country_code=US&limit=15'),
    fetchJson(apiKey, '/etfs?symbol=BTC&country_code=US'),
    fetchJson(apiKey, '/market/overview'),
    fetchJson(apiKey, '/indices'),
    fetchJson(apiKey, '/news/hot?page=1&page_size=8'),
    fetchJson(apiKey, '/btc-treasuries'),
    fetchJson(apiKey, '/indices/ssiMAG7/constituents'),
    fetchJson(apiKey, '/indices/ssiDeFi/constituents'),
  ]);

  const indexTickers = (Array.isArray(indicesListRaw) ? indicesListRaw : [])
    .filter((t) => typeof t === 'string')
    .slice(0, 13);

  const ssiIndices = [];
  for (const ticker of indexTickers) {
    try {
      const snap = await fetchJson(apiKey, `/indices/${encodeURIComponent(ticker)}/market-snapshot`);
      ssiIndices.push({
        ticker,
        price: Number(snap?.price ?? 0),
        changePct24h: Number(snap?.change_pct_24h ?? 0),
        roi7d: Number(snap?.roi_7d ?? 0),
        roi1m: Number(snap?.roi_1m ?? 0),
        roi3m: Number(snap?.roi_3m ?? 0),
        roi1y: Number(snap?.roi_1y ?? 0),
        ytd: Number(snap?.ytd ?? 0),
        constituents:
          ticker === 'ssiMAG7' && Array.isArray(mag7ConstRaw)
            ? mag7ConstRaw.map((c) => ({ symbol: String(c.symbol ?? ''), weight: Number(c.weight ?? 0) }))
            : ticker === 'ssiDeFi' && Array.isArray(defiConstRaw)
              ? defiConstRaw.map((c) => ({ symbol: String(c.symbol ?? ''), weight: Number(c.weight ?? 0) }))
              : undefined,
      });
    } catch (err) {
      console.warn(`WARN | Skipping ${ticker}: ${err instanceof Error ? err.message : 'failed'}`);
    }
  }

  const nowIso = new Date().toISOString();
  const snapshot = {
    schemaVersion: '1.3.0',
    source: 'SoSoValue OpenAPI v1 (Live Verified Snapshot)',
    fetchedAt: nowIso,
    fetchedDateUtc: nowIso.slice(0, 10),
    endpointsVerified: 11 + ssiIndices.length,
    marketOverview: {
      totalMarketCap: Number(overviewRaw?.total_market_cap ?? 0),
      totalMarketCapChangePct: Number(overviewRaw?.total_market_cap_change_pct ?? 0),
      totalVolume24h: Number(overviewRaw?.total_volume_24h ?? 0),
      ethGasGwei: Number(overviewRaw?.eth_gas_gwei ?? 0),
      btcGasSatVb: Number(overviewRaw?.btc_gas_sat_vb ?? 0),
      asOf: Number(overviewRaw?.as_of ?? Date.now()),
    },
    etfFlows: {
      BTC: normalizeEtfRows(btcEtfRaw),
      ETH: normalizeEtfRows(ethEtfRaw),
      SOL: normalizeEtfRows(solEtfRaw),
      XRP: normalizeEtfRows(xrpEtfRaw),
    },
    btcEtfProducts: (Array.isArray(btcProductsRaw) ? btcProductsRaw : []).slice(0, 12).map((p) => ({
      ticker: String(p.ticker ?? ''),
      name: String(p.name ?? ''),
      exchange: String(p.exchange ?? ''),
    })),
    btcEtfFlowZScore: computeZScore(btcEtfRaw),
    ethEtfFlowZScore: computeZScore(ethEtfRaw),
    ssiIndices,
    hotNews: (Array.isArray(newsRaw?.list) ? newsRaw.list : []).slice(0, 8).map((n) => ({
      id: String(n.id ?? ''),
      title: String(n.title ?? ''),
      summary: String(n.content ?? '').slice(0, 220),
      sourceLink: String(n.source_link ?? ''),
      releaseTime: Number(n.release_time ?? 0),
    })),
    treasuries: (Array.isArray(treasuriesRaw) ? treasuriesRaw : []).slice(0, 15).map((t) => ({
      ticker: String(t.ticker ?? ''),
      name: String(t.name ?? ''),
      listLocation: String(t.list_location ?? ''),
    })),
  };

  const serialized = JSON.stringify(snapshot, null, 2) + '\n';

  // Hard security self-audit: refuse to write if any secret substring appears
  if (serialized.includes(apiKey) || serialized.includes(apiKey.slice(0, 10))) {
    throw new Error('SECURITY ABORT: API key substring detected in serialized output!');
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, serialized, 'utf8');

  console.log(`\nWrote sanitized snapshot to ${path.relative(ROOT, OUT_FILE)} (${serialized.length} bytes)`);
  console.log(
    `Summary: BTC ETF=${snapshot.etfFlows.BTC.length}d (z=${snapshot.btcEtfFlowZScore}), ETH ETF=${snapshot.etfFlows.ETH.length}d (z=${snapshot.ethEtfFlowZScore}), SOL ETF=${snapshot.etfFlows.SOL.length}d, XRP ETF=${snapshot.etfFlows.XRP.length}d, SSI=${snapshot.ssiIndices.length}, News=${snapshot.hotNews.length}, Treasuries=${snapshot.treasuries.length}`,
  );
}

main().catch((err) => {
  console.error('Snapshot fetch failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
