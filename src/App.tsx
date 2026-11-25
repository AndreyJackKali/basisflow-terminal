import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Cpu,
  KeyRound,
  PlayCircle,
  Presentation,
  RefreshCw,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import type {
  ApiProbeLog,
  DataBadgeState,
  KlineBar,
  NetworkMode,
  OrderbookData,
  PaperTrade,
  PerpMarkPrice,
  PerpSymbolInfo,
  PerpTicker,
  BookTicker,
  SoSoValueState,
  SpotSymbolInfo,
  SpotTicker,
  TradeTick,
  ValueChainTelemetry,
  WsStreamTelemetry,
} from './types';
import {
  DEFAULT_SOSO_PROXY_URL,
  NETWORK_CONFIG,
  fetchAllSodexMarkets,
  fetchSoSoFromProxy,
  fetchSpotOrderbook,
  fetchSymbolMicrostructure,
  fetchValueChainTelemetry,
  loadVerifiedSoSoSnapshot,
  probeSoSoValueOpenApi,
} from './lib/api';
import { createSodexPerpStream } from './lib/ws';
import { enrichMarkets } from './lib/quant';
import { ScannerTab } from './components/ScannerTab';
import { MicrostructureTab } from './components/MicrostructureTab';
import { ExecutionTab } from './components/ExecutionTab';
import { SoSoValueTab } from './components/SoSoValueTab';
import { ApiConsoleDrawer } from './components/ApiConsoleDrawer';

type TabKey = 'scanner' | 'microstructure' | 'execution' | 'sosovalue';

const STORAGE_TRADES_KEY = 'basisflow_paper_trades_v1';

export default function App() {
  const [network, setNetwork] = useState<NetworkMode>('mainnet');
  const [activeTab, setActiveTab] = useState<TabKey>('scanner');
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [killSwitch, setKillSwitch] = useState(false);

  const [apiLogs, setApiLogs] = useState<ApiProbeLog[]>([]);
  const pushLog = useCallback((log: ApiProbeLog) => {
    setApiLogs((prev) => [log, ...prev].slice(0, 80));
  }, []);

  // Raw market datasets
  const [rawData, setRawData] = useState<{
    perpSymbols: PerpSymbolInfo[];
    perpTickers: PerpTicker[];
    perpMarks: PerpMarkPrice[];
    perpBooks: BookTicker[];
    spotSymbols: SpotSymbolInfo[];
    spotTickers: SpotTicker[];
  }>({
    perpSymbols: [],
    perpTickers: [],
    perpMarks: [],
    perpBooks: [],
    spotSymbols: [],
    spotTickers: [],
  });

  const [perpsStatus, setPerpsStatus] = useState<DataBadgeState>('LOADING');
  const [spotStatus, setSpotStatus] = useState<DataBadgeState>('LOADING');
  const [rpcStatus, setRpcStatus] = useState<DataBadgeState>('LOADING');
  const [vcTelemetry, setVcTelemetry] = useState<ValueChainTelemetry | null>(null);
  const [loadingMarkets, setLoadingMarkets] = useState(false);

  // Microstructure & Live WebSocket state
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTC-USD');
  const [interval, setIntervalState] = useState<'15m' | '1h' | '4h' | '1d'>('1h');
  const [orderbook, setOrderbook] = useState<OrderbookData | null>(null);
  const [spotOrderbook, setSpotOrderbook] = useState<OrderbookData | null>(null);
  const [klines, setKlines] = useState<KlineBar[]>([]);
  const [trades, setTrades] = useState<TradeTick[]>([]);
  const [loadingMicro, setLoadingMicro] = useState(false);
  const [wsPaused, setWsPaused] = useState(false);
  const [wsTelemetry, setWsTelemetry] = useState<WsStreamTelemetry>({
    status: 'CONNECTING',
    endpoint: NETWORK_CONFIG.mainnet.wsPerpsUrl,
    symbol: 'BTC-USD',
    msgCount: 0,
    lastTickAt: null,
  });

  // SoSoValue OpenAPI state (in-memory key only, zero localStorage persistence)
  const [sosoKey, setSosoKey] = useState<string>('');
  const [sosoProxyUrl, setSosoProxyUrl] = useState<string>(DEFAULT_SOSO_PROXY_URL);
  const [loadingSoSo, setLoadingSoSo] = useState<boolean>(false);
  const [sosoState, setSosoState] = useState<SoSoValueState>({
    status: 'LOADING',
    mode: 'BYOK',
    sourceLabel: 'Loading verified SoSoValue OpenAPI v1 snapshot...',
    proxyUrl: DEFAULT_SOSO_PROXY_URL,
    lastChecked: null,
    snapshotFetchedAt: null,
    endpointsVerified: 0,
    error: null,
    marketOverview: null,
    etfFlows: { BTC: [], ETH: [], SOL: [], XRP: [] },
    btcEtfProducts: [],
    ssiIndices: [],
    hotNews: [],
    treasuries: [],
    btcEtfFlowZScore: 0,
    ethEtfFlowZScore: 0,
    etfFlowZScore: 0,
  });

  // Paper portfolio ledger
  const [paperTrades, setPaperTrades] = useState<PaperTrade[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_TRADES_KEY);
      return saved ? (JSON.parse(saved) as PaperTrade[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_TRADES_KEY, JSON.stringify(paperTrades));
    } catch {
      // ignore storage quota errors
    }
  }, [paperTrades]);

  const loadGlobalData = useCallback(async () => {
    setLoadingMarkets(true);
    const [mkt, vc] = await Promise.all([
      fetchAllSodexMarkets(network, pushLog),
      fetchValueChainTelemetry(network, pushLog),
    ]);
    setRawData({
      perpSymbols: mkt.perpSymbols,
      perpTickers: mkt.perpTickers,
      perpMarks: mkt.perpMarks,
      perpBooks: mkt.perpBooks,
      spotSymbols: mkt.spotSymbols,
      spotTickers: mkt.spotTickers,
    });
    setPerpsStatus(mkt.perpsOk ? 'LIVE' : 'OFFLINE');
    setSpotStatus(mkt.spotOk ? 'LIVE' : 'OFFLINE');
    setVcTelemetry(vc);
    setRpcStatus(vc ? 'LIVE' : 'OFFLINE');
    setLoadingMarkets(false);
  }, [network, pushLog]);

  const loadMicro = useCallback(
    async (sym: string, iv: '15m' | '1h' | '4h' | '1d') => {
      if (!sym) return;
      setLoadingMicro(true);
      const res = await fetchSymbolMicrostructure(network, sym, iv, pushLog);
      setOrderbook(res.orderbook);
      setKlines(res.klines);
      setTrades(res.trades);
      setLoadingMicro(false);
    },
    [network, pushLog],
  );

  const handleLoadSoSoSnapshot = useCallback(async () => {
    setLoadingSoSo(true);
    const res = await loadVerifiedSoSoSnapshot(pushLog);
    if (res.ok && res.snapshot) {
      const snap = res.snapshot;
      setSosoState((prev) => ({
        ...prev,
        status: 'SNAPSHOT',
        mode: 'VERIFIED_SNAPSHOT',
        sourceLabel: snap.source,
        lastChecked: Date.now(),
        snapshotFetchedAt: snap.fetchedAt,
        endpointsVerified: snap.endpointsVerified,
        error: null,
        marketOverview: snap.marketOverview,
        etfFlows: snap.etfFlows,
        btcEtfProducts: snap.btcEtfProducts,
        ssiIndices: snap.ssiIndices,
        hotNews: snap.hotNews,
        treasuries: snap.treasuries,
        btcEtfFlowZScore: snap.btcEtfFlowZScore,
        ethEtfFlowZScore: snap.ethEtfFlowZScore,
        etfFlowZScore: snap.btcEtfFlowZScore,
      }));
    } else {
      setSosoState((prev) => ({
        ...prev,
        status: 'BYOK',
        mode: 'BYOK',
        lastChecked: Date.now(),
        error: res.error,
      }));
    }
    setLoadingSoSo(false);
  }, [pushLog]);

  const handleConnectSoSoProxy = useCallback(
    async (overrideUrl?: string) => {
      const targetUrl = (overrideUrl !== undefined ? overrideUrl : sosoProxyUrl).trim();
      setLoadingSoSo(true);
      const res = await fetchSoSoFromProxy(targetUrl, pushLog);
      if (res.ok && res.snapshot) {
        const snap = res.snapshot;
        setSosoState((prev) => ({
          ...prev,
          status: 'LIVE',
          mode: 'LIVE_PROXY',
          sourceLabel: `${snap.source} (${targetUrl})`,
          proxyUrl: targetUrl,
          lastChecked: Date.now(),
          snapshotFetchedAt: snap.fetchedAt,
          endpointsVerified: snap.endpointsVerified,
          error: null,
          marketOverview: snap.marketOverview,
          etfFlows: snap.etfFlows,
          btcEtfProducts: snap.btcEtfProducts,
          ssiIndices: snap.ssiIndices,
          hotNews: snap.hotNews,
          treasuries: snap.treasuries,
          btcEtfFlowZScore: snap.btcEtfFlowZScore,
          ethEtfFlowZScore: snap.ethEtfFlowZScore,
          etfFlowZScore: snap.btcEtfFlowZScore,
        }));
      } else {
        setSosoState((prev) => ({
          ...prev,
          lastChecked: Date.now(),
          error: `${res.error ?? 'Proxy connection failed'} — keeping verified live snapshot active.`,
        }));
      }
      setLoadingSoSo(false);
    },
    [sosoProxyUrl, pushLog],
  );

  const handleProbeSoSo = useCallback(
    async (overrideKey?: string) => {
      const activeKey = overrideKey !== undefined ? overrideKey : sosoKey;
      setLoadingSoSo(true);
      const res = await probeSoSoValueOpenApi(activeKey, pushLog);
      if (res.ok && res.snapshot) {
        const snap = res.snapshot;
        setSosoState((prev) => ({
          ...prev,
          status: 'LIVE',
          mode: 'LIVE_DIRECT',
          sourceLabel: snap.source,
          lastChecked: Date.now(),
          snapshotFetchedAt: snap.fetchedAt,
          endpointsVerified: snap.endpointsVerified,
          error: null,
          marketOverview: snap.marketOverview,
          etfFlows: snap.etfFlows,
          btcEtfProducts: snap.btcEtfProducts,
          ssiIndices: snap.ssiIndices,
          hotNews: snap.hotNews,
          treasuries: snap.treasuries,
          btcEtfFlowZScore: snap.btcEtfFlowZScore,
          ethEtfFlowZScore: snap.ethEtfFlowZScore,
          etfFlowZScore: snap.btcEtfFlowZScore,
        }));
      } else {
        setSosoState((prev) => ({
          ...prev,
          lastChecked: Date.now(),
          error: res.error,
        }));
      }
      setLoadingSoSo(false);
    },
    [sosoKey, pushLog],
  );

  useEffect(() => {
    handleLoadSoSoSnapshot();
  }, [handleLoadSoSoSnapshot]);

  useEffect(() => {
    loadGlobalData();
    const id = window.setInterval(loadGlobalData, 30_000);
    return () => window.clearInterval(id);
  }, [loadGlobalData]);

  const markets = useMemo(
    () =>
      enrichMarkets(
        rawData.perpSymbols,
        rawData.perpTickers,
        rawData.perpMarks,
        rawData.perpBooks,
        rawData.spotSymbols,
        rawData.spotTickers,
        sosoState.etfFlowZScore,
      ),
    [rawData, sosoState.etfFlowZScore],
  );

  // Ensure selectedSymbol exists on current network (mainnet vs testnet)
  useEffect(() => {
    if (markets.length === 0) return;
    if (!markets.some((m) => m.symbol === selectedSymbol)) {
      const btc = markets.find((m) => m.symbol === 'BTC-USD');
      setSelectedSymbol(btc ? btc.symbol : markets[0].symbol);
    }
  }, [markets, selectedSymbol]);

  useEffect(() => {
    if (selectedSymbol) {
      loadMicro(selectedSymbol, interval);
    }
  }, [selectedSymbol, interval, loadMicro]);

  const selectedMarket = useMemo(
    () => markets.find((m) => m.symbol === selectedSymbol) ?? markets[0] ?? null,
    [markets, selectedSymbol],
  );

  // Fetch paired Spot L2 Orderbook when a Spot↔Perp asset is selected (powers 2-leg Delta-Neutral Hedge Builder)
  useEffect(() => {
    let active = true;
    const spotSym = selectedMarket?.spotSymbol;
    if (!spotSym) {
      setSpotOrderbook(null);
      return;
    }
    fetchSpotOrderbook(network, spotSym, pushLog).then((ob) => {
      if (active) setSpotOrderbook(ob);
    });
    return () => {
      active = false;
    };
  }, [network, selectedMarket?.spotSymbol, pushLog]);

  // Real-time 500ms SoDEX WebSocket L2 Orderbook, Trade Tape & MarkPrice Stream
  useEffect(() => {
    if (!selectedSymbol) return;
    const endpoint = NETWORK_CONFIG[network].wsPerpsUrl;
    if (wsPaused) {
      setWsTelemetry((prev) => ({ ...prev, status: 'PAUSED', endpoint, symbol: selectedSymbol }));
      return;
    }

    setWsTelemetry({
      status: 'CONNECTING',
      endpoint,
      symbol: selectedSymbol,
      msgCount: 0,
      lastTickAt: null,
    });

    const cleanup = createSodexPerpStream({
      network,
      symbol: selectedSymbol,
      onL2Book: (update) => {
        setOrderbook((prev) => ({
          blockHeight: prev?.blockHeight ?? 0,
          blockTime: update.blockTime,
          updateID: update.updateID,
          bids: update.bids,
          asks: update.asks,
        }));
      },
      onTrades: (incoming) => {
        setTrades((prev) => {
          const seen = new Set(prev.map((t) => `${t.t}-${t.T}`));
          const fresh = incoming.filter((t) => !seen.has(`${t.t}-${t.T}`));
          return fresh.length > 0 ? [...fresh, ...prev].slice(0, 60) : prev;
        });
      },
      onMarkPrice: (mp) => {
        setRawData((prev) => ({
          ...prev,
          perpMarks: prev.perpMarks.map((item) =>
            item.symbol === mp.symbol
              ? {
                  ...item,
                  markPrice: String(mp.markPrice),
                  indexPrice: String(mp.indexPrice),
                  openInterest: String(mp.openInterest),
                  fundingRate: String(mp.fundingRate),
                  nextFundingTime: mp.nextFundingTime || item.nextFundingTime,
                }
              : item,
          ),
        }));
      },
      onStatus: (status, tickAt) => {
        setWsTelemetry((prev) => ({
          status,
          endpoint,
          symbol: selectedSymbol,
          msgCount: tickAt ? prev.msgCount + 1 : prev.msgCount,
          lastTickAt: tickAt ?? prev.lastTickAt,
        }));
      },
    });

    return cleanup;
  }, [network, selectedSymbol, wsPaused]);

  const badgeClass = (st: DataBadgeState) =>
    st === 'LIVE'
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
      : st === 'SNAPSHOT'
        ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40'
        : st === 'BYOK'
          ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
          : st === 'LOADING'
            ? 'bg-slate-800 text-slate-400 border-slate-700'
            : 'bg-rose-500/20 text-rose-300 border-rose-500/40';

  return (
    <div className="min-h-screen flex flex-col bg-[#090d14] text-slate-100">
      {/* Top Telemetry & Radical Data Honesty Bar */}
      <header className="sticky top-0 z-30 bg-[#0b101b]/95 backdrop-blur border-b border-slate-800/90">
        <div className="max-w-7xl mx-auto px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center font-mono font-black text-slate-950 text-sm shadow-lg shadow-emerald-500/20">
              BF
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-tight text-slate-100">
                  BasisFlow Terminal
                </h1>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                  SoDEX + ValueChain + SoSoValue
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Institutional Funding-Basis, L2 Microstructure &amp; Risk-Gated Execution Desk
              </p>
            </div>
          </div>

          {/* Network switch + Live Source Honesty Badges */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
            <div className="inline-flex rounded bg-[#090d14] border border-slate-800 p-0.5">
              {(['mainnet', 'testnet'] as const).map((net) => (
                <button
                  key={net}
                  onClick={() => setNetwork(net)}
                  className={`px-2 py-0.5 rounded uppercase transition ${
                    network === net
                      ? 'bg-emerald-500/25 text-emerald-300 font-bold'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {net}
                </button>
              ))}
            </div>

            <button
              onClick={() => setActiveTab('microstructure')}
              className={`px-2 py-1 rounded border flex items-center gap-1 ${
                wsTelemetry.status === 'STREAMING'
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                  : wsTelemetry.status === 'PAUSED'
                    ? 'bg-slate-800 text-slate-400 border-slate-700'
                    : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
              }`}
              title={`Real-time 500ms WebSocket stream: ${wsTelemetry.endpoint} (${wsTelemetry.symbol})`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full bg-current ${
                  wsTelemetry.status === 'STREAMING' ? 'animate-pulse' : ''
                }`}
              />
              WS: {wsTelemetry.status === 'STREAMING' ? `${wsTelemetry.msgCount} ticks` : wsTelemetry.status}
            </button>
            <button
              onClick={() => setConsoleOpen(true)}
              className={`px-2 py-1 rounded border flex items-center gap-1 ${badgeClass(perpsStatus)}`}
              title="Click to inspect live HTTP status & raw JSON"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              PERPS: {perpsStatus}
            </button>
            <button
              onClick={() => setConsoleOpen(true)}
              className={`px-2 py-1 rounded border flex items-center gap-1 ${badgeClass(spotStatus)}`}
            >
              SPOT: {spotStatus}
            </button>
            <button
              onClick={() => setConsoleOpen(true)}
              className={`px-2 py-1 rounded border flex items-center gap-1 ${badgeClass(rpcStatus)}`}
            >
              L1 #{vcTelemetry ? vcTelemetry.blockNumber.toLocaleString() : '—'}
            </button>
            <button
              onClick={() => setActiveTab('sosovalue')}
              className={`px-2 py-1 rounded border flex items-center gap-1 ${badgeClass(sosoState.status)}`}
            >
              SOSO: {sosoState.status}
            </button>

            <button
              onClick={() => setConsoleOpen(true)}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 inline-flex items-center gap-1"
            >
              <Terminal className="w-3 h-3 text-cyan-400" />
              API Console ({apiLogs.length})
            </button>

            <button
              onClick={loadGlobalData}
              disabled={loadingMarkets}
              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
              title="Refresh all SoDEX & ValueChain live feeds"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingMarkets ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between gap-2 overflow-x-auto border-t border-slate-800/60">
          <div className="flex gap-1">
            {(
              [
                ['scanner', '1. Basis & Carry Scanner', Activity],
                ['microstructure', '2. L2 Microstructure & Regime', BarChart3],
                ['execution', '3. Risk-Gated Execution Desk', ShieldCheck],
                ['sosovalue', '4. ETF & SSI Intelligence (SoSoValue)', KeyRound],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-3.5 py-2 text-xs font-medium inline-flex items-center gap-1.5 border-b-2 transition whitespace-nowrap ${
                  activeTab === key
                    ? 'border-emerald-400 text-emerald-300 bg-emerald-500/5'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
          <div className="hidden md:flex items-center gap-2 py-1 shrink-0 text-[11px] font-mono">
            <a
              href="./deck.html"
              target="_blank"
              rel="noreferrer"
              className="px-2 py-1 rounded border border-cyan-500/35 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 inline-flex items-center gap-1 transition"
            >
              <Presentation className="w-3 h-3" />
              Pitch Deck
            </a>
            <a
              href="./demo.mp4"
              target="_blank"
              rel="noreferrer"
              className="px-2 py-1 rounded border border-emerald-500/35 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 inline-flex items-center gap-1 transition"
            >
              <PlayCircle className="w-3 h-3" />
              60s Demo
            </a>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-4">
        {activeTab === 'scanner' && (
          <ScannerTab
            markets={markets}
            selectedSymbol={selectedSymbol}
            etfFlowZScore={sosoState.etfFlowZScore}
            onSelectForMicrostructure={(sym) => {
              setSelectedSymbol(sym);
              setActiveTab('microstructure');
            }}
            onSelectForExecution={(sym) => {
              setSelectedSymbol(sym);
              setActiveTab('execution');
            }}
          />
        )}

        {activeTab === 'microstructure' && (
          <MicrostructureTab
            markets={markets}
            selectedMarket={selectedMarket}
            onChangeSymbol={setSelectedSymbol}
            interval={interval}
            onChangeInterval={setIntervalState}
            orderbook={orderbook}
            klines={klines}
            trades={trades}
            loading={loadingMicro}
            wsTelemetry={wsTelemetry}
            wsPaused={wsPaused}
            onToggleWsPause={() => setWsPaused((v) => !v)}
            onRefresh={() => loadMicro(selectedSymbol, interval)}
            onSendToExecution={(sym) => {
              setSelectedSymbol(sym);
              setActiveTab('execution');
            }}
          />
        )}

        {activeTab === 'execution' && (
          <ExecutionTab
            network={network}
            markets={markets}
            selectedMarket={selectedMarket}
            onChangeSymbol={setSelectedSymbol}
            orderbook={orderbook}
            spotOrderbook={spotOrderbook}
            klines={klines}
            sosoState={sosoState}
            killSwitch={killSwitch}
            onToggleKillSwitch={() => setKillSwitch((v) => !v)}
            paperTrades={paperTrades}
            onExecutePaperTrade={(tr) => setPaperTrades((prev) => [tr, ...prev])}
            onClosePaperTrade={(id, exitPrice) =>
              setPaperTrades((prev) =>
                prev.map((t) => {
                  if (t.id !== id) return t;
                  const pnl =
                    t.side === 'LONG'
                      ? (exitPrice - t.entryPrice) * t.qty
                      : (t.entryPrice - exitPrice) * t.qty;
                  return {
                    ...t,
                    status: 'CLOSED',
                    exitPrice,
                    closedAt: Date.now(),
                    realizedPnlUsd: Number(pnl.toFixed(2)),
                  };
                }),
              )
            }
            onClearPaperTrades={() => setPaperTrades([])}
          />
        )}

        {activeTab === 'sosovalue' && (
          <SoSoValueTab
            apiKey={sosoKey}
            onChangeApiKey={setSosoKey}
            proxyUrl={sosoProxyUrl}
            onChangeProxyUrl={setSosoProxyUrl}
            sosoState={sosoState}
            markets={markets}
            loading={loadingSoSo}
            onConnectProxy={handleConnectSoSoProxy}
            onProbeLiveKey={handleProbeSoSo}
            onReloadSnapshot={handleLoadSoSoSnapshot}
            onSelectMarketForExecution={(sym) => {
              setSelectedSymbol(sym);
              setActiveTab('execution');
            }}
          />
        )}
      </main>

      <footer className="border-t border-slate-800/70 py-3 px-4 text-[11px] text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-wrap justify-between gap-2">
          <span className="inline-flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-emerald-500" />
            BasisFlow Terminal — Built for SoSoValue x ValueChain x SoDEX WaveHack
          </span>
          <span>
            100% client-side · Zero custodial keys · Click any source badge to audit live HTTP payloads
          </span>
        </div>
      </footer>

      <ApiConsoleDrawer open={consoleOpen} onClose={() => setConsoleOpen(false)} logs={apiLogs} />
    </div>
  );
}
