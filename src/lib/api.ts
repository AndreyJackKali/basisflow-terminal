import type {
  ApiProbeLog,
  BookTicker,
  KlineBar,
  NetworkMode,
  OrderbookData,
  PerpMarkPrice,
  PerpSymbolInfo,
  PerpTicker,
  SoSoEtfDayRow,
  SoSoSnapshotPayload,
  SoSoSsiIndexRow,
  SpotSymbolInfo,
  SpotTicker,
  TradeTick,
  ValueChainTelemetry,
} from '../types';
import { computeEtfFlowStats, safeNum } from './quant';

export const NETWORK_CONFIG: Record<
  NetworkMode,
  { sodexBase: string; wsPerpsUrl: string; valueChainRpc: string; label: string; tradeBaseUrl: string }
> = {
  mainnet: {
    sodexBase: 'https://mainnet-gw.sodex.dev',
    wsPerpsUrl: 'wss://mainnet-gw.sodex.dev/ws/perps',
    valueChainRpc: 'https://mainnet.valuechain.xyz',
    label: 'SoDEX Mainnet (ValueChain L1)',
    tradeBaseUrl: 'https://sodex.com/trade',
  },
  testnet: {
    sodexBase: 'https://testnet-gw.sodex.dev',
    wsPerpsUrl: 'wss://testnet-gw.sodex.dev/ws/perps',
    valueChainRpc: 'https://testnet.valuechain.xyz',
    label: 'SoDEX Testnet (ValueChain Testnet)',
    tradeBaseUrl: 'https://testnet.sodex.com/trade',
  },
};

export const SOSO_OPENAPI_BASE = 'https://openapi.sosovalue.com/openapi/v1';

async function trackedFetchJson<T>(
  source: ApiProbeLog['source'],
  url: string,
  init: RequestInit | undefined,
  onLog?: (log: ApiProbeLog) => void,
  note = '',
): Promise<{ ok: boolean; status: number; latencyMs: number; data: T | null; error?: string }> {
  const started = performance.now();
  try {
    const res = await fetch(url, init);
    const latencyMs = Math.round(performance.now() - started);
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text.slice(0, 200) };
    }

    const recordCount = Array.isArray((parsed as { data?: unknown })?.data)
      ? ((parsed as { data: unknown[] }).data.length)
      : undefined;

    onLog?.({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      source,
      endpoint: url,
      method: (init?.method as 'GET' | 'POST') || 'GET',
      status: res.status,
      ok: res.ok,
      latencyMs,
      timestamp: Date.now(),
      recordCount,
      note: note || (res.ok ? 'Live 200 OK' : `HTTP ${res.status}`),
      sampleJson: JSON.stringify(parsed).slice(0, 600),
    });

    if (!res.ok) {
      return { ok: false, status: res.status, latencyMs, data: parsed as T, error: `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status, latencyMs, data: parsed as T };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    const msg = err instanceof Error ? err.message : 'Network error';
    onLog?.({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      source,
      endpoint: url,
      method: (init?.method as 'GET' | 'POST') || 'GET',
      status: 0,
      ok: false,
      latencyMs,
      timestamp: Date.now(),
      note: msg,
      sampleJson: JSON.stringify({ error: msg }),
    });
    return { ok: false, status: 0, latencyMs, data: null, error: msg };
  }
}

export async function fetchAllSodexMarkets(
  network: NetworkMode,
  onLog?: (log: ApiProbeLog) => void,
): Promise<{
  perpSymbols: PerpSymbolInfo[];
  perpTickers: PerpTicker[];
  perpMarks: PerpMarkPrice[];
  perpBooks: BookTicker[];
  spotSymbols: SpotSymbolInfo[];
  spotTickers: SpotTicker[];
  perpsOk: boolean;
  spotOk: boolean;
}> {
  const base = NETWORK_CONFIG[network].sodexBase;

  const [symRes, tickRes, markRes, bookRes, spotSymRes, spotTickRes] = await Promise.all([
    trackedFetchJson<{ data: PerpSymbolInfo[] }>(
      'SoDEX Perps',
      `${base}/api/v1/perps/markets/symbols`,
      undefined,
      onLog,
      'Perp contract specs & margin tiers',
    ),
    trackedFetchJson<{ data: PerpTicker[] }>(
      'SoDEX Perps',
      `${base}/api/v1/perps/markets/tickers`,
      undefined,
      onLog,
      '24h perp tickers & volume',
    ),
    trackedFetchJson<{ data: PerpMarkPrice[] }>(
      'SoDEX Perps',
      `${base}/api/v1/perps/markets/mark-prices`,
      undefined,
      onLog,
      'Mark/Index prices, OI & funding rates',
    ),
    trackedFetchJson<{ data: BookTicker[] }>(
      'SoDEX Perps',
      `${base}/api/v1/perps/markets/bookTickers`,
      undefined,
      onLog,
      'Top-of-book bid/ask spreads',
    ),
    trackedFetchJson<{ data: SpotSymbolInfo[] }>(
      'SoDEX Spot',
      `${base}/api/v1/spot/markets/symbols`,
      undefined,
      onLog,
      'Spot market definitions for basis join',
    ),
    trackedFetchJson<{ data: SpotTicker[] }>(
      'SoDEX Spot',
      `${base}/api/v1/spot/markets/tickers`,
      undefined,
      onLog,
      'Live spot tickers for Spot-vs-Perp spread',
    ),
  ]);

  return {
    perpSymbols: symRes.data?.data ?? [],
    perpTickers: tickRes.data?.data ?? [],
    perpMarks: markRes.data?.data ?? [],
    perpBooks: bookRes.data?.data ?? [],
    spotSymbols: spotSymRes.data?.data ?? [],
    spotTickers: spotTickRes.data?.data ?? [],
    perpsOk: symRes.ok && markRes.ok,
    spotOk: spotSymRes.ok && spotTickRes.ok,
  };
}

export async function fetchSymbolMicrostructure(
  network: NetworkMode,
  symbol: string,
  interval: '15m' | '1h' | '4h' | '1d',
  onLog?: (log: ApiProbeLog) => void,
): Promise<{
  orderbook: OrderbookData | null;
  klines: KlineBar[];
  trades: TradeTick[];
}> {
  const base = NETWORK_CONFIG[network].sodexBase;
  const enc = encodeURIComponent(symbol);

  const [obRes, klRes, trRes] = await Promise.all([
    trackedFetchJson<{ data: OrderbookData }>(
      'SoDEX Perps',
      `${base}/api/v1/perps/markets/${enc}/orderbook?limit=20`,
      undefined,
      onLog,
      `${symbol} L2 orderbook (20 levels)`,
    ),
    trackedFetchJson<{ data: Record<string, unknown>[] }>(
      'SoDEX Perps',
      `${base}/api/v1/perps/markets/${enc}/klines?interval=${interval}&limit=72`,
      undefined,
      onLog,
      `${symbol} ${interval} OHLCV candles`,
    ),
    trackedFetchJson<{ data: Record<string, unknown>[] }>(
      'SoDEX Perps',
      `${base}/api/v1/perps/markets/${enc}/trades?limit=40`,
      undefined,
      onLog,
      `${symbol} recent trade tape`,
    ),
  ]);

  const klines: KlineBar[] = (klRes.data?.data ?? [])
    .map((k) => ({
      t: safeNum(k.t),
      o: safeNum(k.o),
      h: safeNum(k.h),
      l: safeNum(k.l),
      c: safeNum(k.c),
      v: safeNum(k.v),
      q: safeNum(k.q),
      n: safeNum(k.n),
    }))
    .filter((k) => k.c > 0)
    .sort((a, b) => a.t - b.t);

  const trades: TradeTick[] = (trRes.data?.data ?? []).map((t) => ({
    t: safeNum(t.t),
    T: safeNum(t.T),
    s: String(t.s ?? symbol),
    S: String(t.S).toUpperCase() === 'BUY' ? 'BUY' : 'SELL',
    p: safeNum(t.p),
    q: safeNum(t.q),
  }));

  return {
    orderbook: obRes.data?.data ?? null,
    klines,
    trades,
  };
}

export async function fetchSpotOrderbook(
  network: NetworkMode,
  spotSymbol: string,
  onLog?: (log: ApiProbeLog) => void,
): Promise<OrderbookData | null> {
  if (!spotSymbol) return null;
  const base = NETWORK_CONFIG[network].sodexBase;
  const enc = encodeURIComponent(spotSymbol);
  const res = await trackedFetchJson<{ data: OrderbookData }>(
    'SoDEX Spot',
    `${base}/api/v1/spot/markets/${enc}/orderbook?limit=20`,
    undefined,
    onLog,
    `${spotSymbol} Spot L2 orderbook (for 2-leg hedge slippage)`,
  );
  return res.data?.data ?? null;
}

export async function fetchValueChainTelemetry(
  network: NetworkMode,
  onLog?: (log: ApiProbeLog) => void,
): Promise<ValueChainTelemetry | null> {
  const rpcUrl = NETWORK_CONFIG[network].valueChainRpc;
  const [blockRes, chainRes] = await Promise.all([
    trackedFetchJson<{ result: string }>(
      'ValueChain RPC',
      rpcUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      },
      onLog,
      'ValueChain L1 live eth_blockNumber',
    ),
    trackedFetchJson<{ result: string }>(
      'ValueChain RPC',
      rpcUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_chainId', params: [] }),
      },
      onLog,
      'ValueChain L1 eth_chainId',
    ),
  ]);

  if (!blockRes.ok || !blockRes.data?.result) return null;
  const blockHex = blockRes.data.result;
  return {
    network,
    rpcUrl,
    blockNumber: parseInt(blockHex, 16),
    blockHex,
    chainIdHex: chainRes.data?.result ?? '0x0',
    latencyMs: blockRes.latencyMs,
    fetchedAt: Date.now(),
  };
}

export const DEFAULT_SOSO_PROXY_URL = 'http://127.0.0.1:9105';

function normalizeEtfRows(raw: unknown): SoSoEtfDayRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      date: String(row.date ?? ''),
      totalNetInflow: safeNum(row.totalNetInflow ?? row.total_net_inflow),
      totalValueTraded: safeNum(row.totalValueTraded ?? row.total_value_traded),
      totalNetAssets: safeNum(row.totalNetAssets ?? row.total_net_assets),
      cumNetInflow: safeNum(row.cumNetInflow ?? row.cum_net_inflow),
    };
  });
}

function normalizeSnapshotPayload(raw: Record<string, unknown>): SoSoSnapshotPayload {
  const etfFlowsRaw = (raw.etfFlows ?? {}) as Record<string, unknown>;
  const btc = normalizeEtfRows(etfFlowsRaw.BTC);
  const eth = normalizeEtfRows(etfFlowsRaw.ETH);
  const sol = normalizeEtfRows(etfFlowsRaw.SOL);
  const xrp = normalizeEtfRows(etfFlowsRaw.XRP);
  const btcStats = computeEtfFlowStats(btc);
  const ethStats = computeEtfFlowStats(eth);

  const ov = raw.marketOverview as Record<string, unknown> | null | undefined;
  const marketOverview =
    ov && typeof ov === 'object'
      ? {
          totalMarketCap: safeNum(ov.totalMarketCap ?? ov.total_market_cap),
          totalMarketCapChangePct: safeNum(
            ov.totalMarketCapChangePct ?? ov.total_market_cap_change_pct,
          ),
          totalVolume24h: safeNum(ov.totalVolume24h ?? ov.total_volume_24h),
          ethGasGwei: safeNum(ov.ethGasGwei ?? ov.eth_gas_gwei),
          btcGasSatVb: safeNum(ov.btcGasSatVb ?? ov.btc_gas_sat_vb),
          asOf: safeNum(ov.asOf ?? ov.as_of, Date.now()),
        }
      : null;

  const ssiIndices: SoSoSsiIndexRow[] = Array.isArray(raw.ssiIndices)
    ? (raw.ssiIndices as Record<string, unknown>[]).map((idx) => ({
        ticker: String(idx.ticker ?? ''),
        price: safeNum(idx.price),
        changePct24h: safeNum(idx.changePct24h ?? idx.change_pct_24h),
        roi7d: safeNum(idx.roi7d ?? idx.roi_7d),
        roi1m: safeNum(idx.roi1m ?? idx.roi_1m),
        roi3m: safeNum(idx.roi3m ?? idx.roi_3m),
        roi1y: safeNum(idx.roi1y ?? idx.roi_1y),
        ytd: safeNum(idx.ytd),
        constituents: Array.isArray(idx.constituents)
          ? (idx.constituents as Record<string, unknown>[]).map((c) => ({
              symbol: String(c.symbol ?? ''),
              weight: safeNum(c.weight),
            }))
          : undefined,
      }))
    : [];

  const hotNews = Array.isArray(raw.hotNews)
    ? (raw.hotNews as Record<string, unknown>[]).map((n) => ({
        id: String(n.id ?? ''),
        title: String(n.title ?? 'Market Update'),
        summary: String(n.summary ?? n.content ?? '').slice(0, 220),
        sourceLink: String(n.sourceLink ?? n.source_link ?? ''),
        releaseTime: safeNum(n.releaseTime ?? n.release_time),
      }))
    : [];

  const treasuries = Array.isArray(raw.treasuries)
    ? (raw.treasuries as Record<string, unknown>[]).map((t) => ({
        ticker: String(t.ticker ?? ''),
        name: String(t.name ?? ''),
        listLocation: String(t.listLocation ?? t.list_location ?? ''),
      }))
    : [];

  const btcEtfProducts = Array.isArray(raw.btcEtfProducts)
    ? (raw.btcEtfProducts as Record<string, unknown>[]).map((p) => ({
        ticker: String(p.ticker ?? ''),
        name: String(p.name ?? ''),
        exchange: String(p.exchange ?? ''),
      }))
    : [];

  return {
    schemaVersion: String(raw.schemaVersion ?? '1.3.0'),
    source: String(raw.source ?? 'SoSoValue OpenAPI v1'),
    fetchedAt: String(raw.fetchedAt ?? new Date().toISOString()),
    fetchedDateUtc: String(raw.fetchedDateUtc ?? new Date().toISOString().slice(0, 10)),
    endpointsVerified: safeNum(raw.endpointsVerified, ssiIndices.length + 6),
    marketOverview,
    etfFlows: { BTC: btc, ETH: eth, SOL: sol, XRP: xrp },
    btcEtfProducts,
    btcEtfFlowZScore: safeNum(raw.btcEtfFlowZScore, btcStats.zScore30d),
    ethEtfFlowZScore: safeNum(raw.ethEtfFlowZScore, ethStats.zScore30d),
    ssiIndices,
    hotNews,
    treasuries,
  };
}

export async function loadVerifiedSoSoSnapshot(
  onLog?: (log: ApiProbeLog) => void,
): Promise<{ ok: boolean; snapshot: SoSoSnapshotPayload | null; error: string | null }> {
  const res = await trackedFetchJson<Record<string, unknown>>(
    'SoSoValue OpenAPI',
    './data/soso-snapshot.json',
    undefined,
    onLog,
    'Verified live SoSoValue OpenAPI v1 snapshot (zero-secret static fallback)',
  );
  if (!res.ok || !res.data) {
    return {
      ok: false,
      snapshot: null,
      error: res.error || 'Could not load verified SoSoValue snapshot',
    };
  }
  return { ok: true, snapshot: normalizeSnapshotPayload(res.data), error: null };
}

export async function fetchSoSoFromProxy(
  proxyUrl: string,
  onLog?: (log: ApiProbeLog) => void,
): Promise<{ ok: boolean; snapshot: SoSoSnapshotPayload | null; error: string | null }> {
  const cleanBase = proxyUrl.trim().replace(/\/+$/, '');
  if (!cleanBase) {
    return { ok: false, snapshot: null, error: 'Proxy URL is empty.' };
  }
  const res = await trackedFetchJson<Record<string, unknown>>(
    'SoSoValue OpenAPI',
    `${cleanBase}/api/soso/snapshot`,
    undefined,
    onLog,
    'Live SoSoValue OpenAPI v1 via local/custom soso-proxy',
  );
  if (!res.ok || !res.data || !res.data.etfFlows) {
    return {
      ok: false,
      snapshot: null,
      error:
        res.error ||
        `Proxy at ${cleanBase} unavailable. Start locally with SOSO_API_KEY=... npm run soso:proxy, or use the verified live snapshot.`,
    };
  }
  return { ok: true, snapshot: normalizeSnapshotPayload(res.data), error: null };
}

export async function probeSoSoValueOpenApi(
  apiKey: string,
  onLog?: (log: ApiProbeLog) => void,
): Promise<{
  ok: boolean;
  status: number;
  error: string | null;
  snapshot: SoSoSnapshotPayload | null;
}> {
  const trimmed = apiKey.trim();
  const headers: Record<string, string> = {
    'x-soso-api-key': trimmed || 'UNCONFIGURED_PROBE',
  };

  if (!trimmed) {
    const probe = await trackedFetchJson<Record<string, unknown>>(
      'SoSoValue OpenAPI',
      `${SOSO_OPENAPI_BASE}/currencies`,
      { headers },
      onLog,
      'CORS + Auth-Gate live contract probe (expected 401 without key)',
    );
    return {
      ok: false,
      status: probe.status,
      error:
        probe.status === 401
          ? 'CORS & Auth Gate verified live (HTTP 401 without key). Connect a local soso-proxy or paste an in-memory x-soso-api-key for live polling.'
          : probe.error || `HTTP ${probe.status}`,
      snapshot: null,
    };
  }

  const [btcRes, ethRes, solRes, xrpRes, ovRes, idxListRes, newsRes, treasRes] = await Promise.all([
    trackedFetchJson<{ data?: unknown }>(
      'SoSoValue OpenAPI',
      `${SOSO_OPENAPI_BASE}/etfs/summary-history?symbol=BTC&country_code=US&limit=30`,
      { headers },
      onLog,
      'US Spot BTC ETF net-inflow history (30d)',
    ),
    trackedFetchJson<{ data?: unknown }>(
      'SoSoValue OpenAPI',
      `${SOSO_OPENAPI_BASE}/etfs/summary-history?symbol=ETH&country_code=US&limit=30`,
      { headers },
      onLog,
      'US Spot ETH ETF net-inflow history (30d)',
    ),
    trackedFetchJson<{ data?: unknown }>(
      'SoSoValue OpenAPI',
      `${SOSO_OPENAPI_BASE}/etfs/summary-history?symbol=SOL&country_code=US&limit=15`,
      { headers },
      onLog,
      'US Spot SOL ETF net-inflow history (15d)',
    ),
    trackedFetchJson<{ data?: unknown }>(
      'SoSoValue OpenAPI',
      `${SOSO_OPENAPI_BASE}/etfs/summary-history?symbol=XRP&country_code=US&limit=15`,
      { headers },
      onLog,
      'US Spot XRP ETF net-inflow history (15d)',
    ),
    trackedFetchJson<{ data?: unknown }>(
      'SoSoValue OpenAPI',
      `${SOSO_OPENAPI_BASE}/market/overview`,
      { headers },
      onLog,
      'SoSoValue Global Crypto Market Overview',
    ),
    trackedFetchJson<{ data?: unknown }>(
      'SoSoValue OpenAPI',
      `${SOSO_OPENAPI_BASE}/indices`,
      { headers },
      onLog,
      'SoSoValue SSI Crypto Indices roster',
    ),
    trackedFetchJson<{ data?: { list?: unknown[] } }>(
      'SoSoValue OpenAPI',
      `${SOSO_OPENAPI_BASE}/news/hot?page=1&page_size=8`,
      { headers },
      onLog,
      'SoSoValue Hot Institutional News',
    ),
    trackedFetchJson<{ data?: unknown }>(
      'SoSoValue OpenAPI',
      `${SOSO_OPENAPI_BASE}/btc-treasuries`,
      { headers },
      onLog,
      'Corporate BTC Treasuries',
    ),
  ]);

  const anyOk = btcRes.ok || ethRes.ok || idxListRes.ok || ovRes.ok;
  if (!anyOk) {
    return {
      ok: false,
      status: btcRes.status || idxListRes.status,
      error: `SoSoValue OpenAPI returned HTTP ${btcRes.status || idxListRes.status} — verify x-soso-api-key.`,
      snapshot: null,
    };
  }

  const tickers = (Array.isArray(idxListRes.data?.data) ? idxListRes.data.data : [])
    .filter((t): t is string => typeof t === 'string')
    .slice(0, 8);

  const ssiResults = await Promise.all(
    tickers.map(async (ticker) => {
      const snap = await trackedFetchJson<{ data?: Record<string, unknown> }>(
        'SoSoValue OpenAPI',
        `${SOSO_OPENAPI_BASE}/indices/${encodeURIComponent(ticker)}/market-snapshot`,
        { headers },
        onLog,
        `SSI ${ticker} market snapshot`,
      );
      const d = snap.data?.data ?? {};
      return {
        ticker,
        price: safeNum(d.price),
        changePct24h: safeNum(d.change_pct_24h),
        roi7d: safeNum(d.roi_7d),
        roi1m: safeNum(d.roi_1m),
        roi3m: safeNum(d.roi_3m),
        roi1y: safeNum(d.roi_1y),
        ytd: safeNum(d.ytd),
      };
    }),
  );

  const nowIso = new Date().toISOString();
  const snapshot = normalizeSnapshotPayload({
    schemaVersion: '1.3.0',
    source: 'SoSoValue OpenAPI v1 (Live In-Memory Direct Key)',
    fetchedAt: nowIso,
    fetchedDateUtc: nowIso.slice(0, 10),
    endpointsVerified: 8 + ssiResults.length,
    marketOverview: ovRes.data?.data ?? null,
    etfFlows: {
      BTC: btcRes.data?.data ?? [],
      ETH: ethRes.data?.data ?? [],
      SOL: solRes.data?.data ?? [],
      XRP: xrpRes.data?.data ?? [],
    },
    btcEtfProducts: [],
    ssiIndices: ssiResults.filter((s) => s.price > 0),
    hotNews: newsRes.data?.data?.list ?? [],
    treasuries: treasRes.data?.data ?? [],
  });

  return {
    ok: true,
    status: 200,
    error: null,
    snapshot,
  };
}
