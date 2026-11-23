import type {
  ApiProbeLog,
  BookTicker,
  KlineBar,
  NetworkMode,
  OrderbookData,
  PerpMarkPrice,
  PerpSymbolInfo,
  PerpTicker,
  SpotSymbolInfo,
  SpotTicker,
  TradeTick,
  ValueChainTelemetry,
} from '../types';
import { safeNum } from './quant';

export const NETWORK_CONFIG: Record<
  NetworkMode,
  { sodexBase: string; valueChainRpc: string; label: string; tradeBaseUrl: string }
> = {
  mainnet: {
    sodexBase: 'https://mainnet-gw.sodex.dev',
    valueChainRpc: 'https://mainnet.valuechain.xyz',
    label: 'SoDEX Mainnet (ValueChain L1)',
    tradeBaseUrl: 'https://sodex.com/trade',
  },
  testnet: {
    sodexBase: 'https://testnet-gw.sodex.dev',
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

export async function probeSoSoValueOpenApi(
  apiKey: string,
  onLog?: (log: ApiProbeLog) => void,
): Promise<{
  ok: boolean;
  status: number;
  error: string | null;
  etfSummary: Record<string, unknown>[];
  indices: Record<string, unknown>[];
  hotNews: Record<string, unknown>[];
  treasuries: Record<string, unknown>[];
  etfFlowZScore: number;
}> {
  const headers: Record<string, string> = {
    'x-soso-api-key': apiKey.trim() || 'UNCONFIGURED_PROBE',
  };

  if (!apiKey.trim()) {
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
          ? 'CORS & Auth Gate verified live (HTTP 401 without key). Paste a SoSoValue x-soso-api-key to activate live ETF flows, indices, and news.'
          : probe.error || `HTTP ${probe.status}`,
      etfSummary: [],
      indices: [],
      hotNews: [],
      treasuries: [],
      etfFlowZScore: 0,
    };
  }

  const [etfRes, idxRes, newsRes, treasRes] = await Promise.all([
    trackedFetchJson<{ data?: unknown }>(
      'SoSoValue OpenAPI',
      `${SOSO_OPENAPI_BASE}/etfs/summary-history?type=us-btc-spot`,
      { headers },
      onLog,
      'US Spot BTC ETF net-inflow history',
    ),
    trackedFetchJson<{ data?: unknown }>(
      'SoSoValue OpenAPI',
      `${SOSO_OPENAPI_BASE}/indices`,
      { headers },
      onLog,
      'SoSoValue SSI Crypto Indices',
    ),
    trackedFetchJson<{ data?: unknown }>(
      'SoSoValue OpenAPI',
      `${SOSO_OPENAPI_BASE}/news/hot?pageSize=8`,
      { headers },
      onLog,
      'SoSoValue Hot Market News',
    ),
    trackedFetchJson<{ data?: unknown }>(
      'SoSoValue OpenAPI',
      `${SOSO_OPENAPI_BASE}/btc-treasuries`,
      { headers },
      onLog,
      'Corporate BTC Treasuries',
    ),
  ]);

  const toArr = (d: unknown): Record<string, unknown>[] => {
    if (Array.isArray(d)) return d as Record<string, unknown>[];
    if (d && typeof d === 'object' && Array.isArray((d as { list?: unknown }).list)) {
      return (d as { list: Record<string, unknown>[] }).list;
    }
    return [];
  };

  const etfSummary = toArr(etfRes.data?.data);
  const indices = toArr(idxRes.data?.data);
  const hotNews = toArr(newsRes.data?.data);
  const treasuries = toArr(treasRes.data?.data);

  // Derive live ETF flow z-score if history returned
  let etfFlowZScore = 0;
  const flows = etfSummary
    .slice(0, 30)
    .map((row) => safeNum(row.totalNetInflow ?? row.dailyNetInflow ?? row.netInflow, NaN))
    .filter((v) => Number.isFinite(v));
  if (flows.length >= 5) {
    const mean = flows.reduce((a, b) => a + b, 0) / flows.length;
    const std = Math.sqrt(flows.reduce((a, b) => a + (b - mean) ** 2, 0) / flows.length) || 1;
    etfFlowZScore = Number(Math.max(-3, Math.min(3, (flows[0] - mean) / std)).toFixed(2));
  }

  const anyOk = etfRes.ok || idxRes.ok || newsRes.ok || treasRes.ok;
  return {
    ok: anyOk,
    status: etfRes.status || idxRes.status,
    error: anyOk ? null : `SoSoValue API returned HTTP ${etfRes.status} — verify x-soso-api-key.`,
    etfSummary,
    indices,
    hotNews,
    treasuries,
    etfFlowZScore,
  };
}
