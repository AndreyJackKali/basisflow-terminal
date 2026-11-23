import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Cpu,
  KeyRound,
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
} from './types';
import {
  fetchAllSodexMarkets,
  fetchSymbolMicrostructure,
  fetchValueChainTelemetry,
  probeSoSoValueOpenApi,
} from './lib/api';
import { enrichMarkets } from './lib/quant';
import { ScannerTab } from './components/ScannerTab';
import { MicrostructureTab } from './components/MicrostructureTab';
import { ExecutionTab } from './components/ExecutionTab';
import { SoSoValueTab } from './components/SoSoValueTab';
import { ApiConsoleDrawer } from './components/ApiConsoleDrawer';

type TabKey = 'scanner' | 'microstructure' | 'execution' | 'sosovalue';

const STORAGE_TRADES_KEY = 'basisflow_paper_trades_v1';
const STORAGE_SOSO_KEY = 'basisflow_soso_api_key_v1';

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

  // Microstructure state
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTC-USD');
  const [interval, setIntervalState] = useState<'15m' | '1h' | '4h' | '1d'>('1h');
  const [orderbook, setOrderbook] = useState<OrderbookData | null>(null);
  const [klines, setKlines] = useState<KlineBar[]>([]);
  const [trades, setTrades] = useState<TradeTick[]>([]);
  const [loadingMicro, setLoadingMicro] = useState(false);

  // SoSoValue BYOK state
  const [sosoKey, setSosoKey] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_SOSO_KEY) || '';
    } catch {
      return '';
    }
  });
  const [sosoState, setSosoState] = useState<SoSoValueState>({
    status: 'BYOK',
    lastChecked: null,
    error: null,
    etfSummary: [],
    indices: [],
    hotNews: [],
    treasuries: [],
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

  const handleProbeSoSo = useCallback(
    async (overrideKey?: string) => {
      const activeKey = overrideKey !== undefined ? overrideKey : sosoKey;
      const res = await probeSoSoValueOpenApi(activeKey, pushLog);
      setSosoState({
        status: res.ok ? 'LIVE' : 'BYOK',
        lastChecked: Date.now(),
        error: res.error,
        etfSummary: res.etfSummary,
        indices: res.indices,
        hotNews: res.hotNews,
        treasuries: res.treasuries,
        etfFlowZScore: res.etfFlowZScore,
      });
    },
    [sosoKey, pushLog],
  );

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

  const badgeClass = (st: DataBadgeState) =>
    st === 'LIVE'
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
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
        <div className="max-w-7xl mx-auto px-4 flex gap-1 overflow-x-auto border-t border-slate-800/60">
          {(
            [
              ['scanner', '1. Basis & Carry Scanner', Activity],
              ['microstructure', '2. L2 Microstructure & Regime', BarChart3],
              ['execution', '3. Risk-Gated Execution Desk', ShieldCheck],
              ['sosovalue', '4. SoSoValue OpenAPI Hub', KeyRound],
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
            onSaveApiKey={(k) => {
              setSosoKey(k);
              try {
                if (k) localStorage.setItem(STORAGE_SOSO_KEY, k);
                else localStorage.removeItem(STORAGE_SOSO_KEY);
              } catch {
                // ignore
              }
            }}
            sosoState={sosoState}
            onProbeLive={handleProbeSoSo}
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
