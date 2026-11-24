import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  Database,
  ExternalLink,
  Flame,
  KeyRound,
  Layers,
  Newspaper,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
} from 'lucide-react';
import type { EnrichedMarket, SoSoEtfAsset, SoSoEtfDayRow, SoSoValueState } from '../types';
import {
  buildEtfFundingCrossChecks,
  computeEtfFlowStats,
  computeSsiSectorFunding,
} from '../lib/quant';

interface Props {
  apiKey: string;
  onChangeApiKey: (key: string) => void;
  proxyUrl: string;
  onChangeProxyUrl: (url: string) => void;
  sosoState: SoSoValueState;
  markets: EnrichedMarket[];
  loading: boolean;
  onConnectProxy: (urlOverride?: string) => void;
  onProbeLiveKey: (keyOverride?: string) => void;
  onReloadSnapshot: () => void;
  onSelectMarketForExecution: (symbol: string) => void;
}

function fmtUsdCompact(v: number, signed = false): string {
  const sign = signed ? (v > 0 ? '+' : v < 0 ? '-' : '') : v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPct(decimalRatio: number, decimals = 2): string {
  const pct = decimalRatio * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(decimals)}%`;
}

const EtfFlowBarChart: React.FC<{ rows: SoSoEtfDayRow[]; asset: SoSoEtfAsset }> = ({
  rows,
  asset,
}) => {
  const ordered = useMemo(() => [...rows].slice(0, 20).reverse(), [rows]);
  if (ordered.length === 0) {
    return (
      <div className="h-44 flex items-center justify-center text-xs text-slate-500">
        No ETF flow sessions loaded for {asset}.
      </div>
    );
  }

  const maxAbs = Math.max(
    1,
    ...ordered.map((r) => Math.abs(r.totalNetInflow)),
  );
  const width = 620;
  const height = 180;
  const padX = 28;
  const padY = 18;
  const midY = height / 2;
  const plotW = width - padX * 2;
  const plotH = (height - padY * 2) / 2;
  const step = plotW / ordered.length;
  const barW = Math.max(6, step * 0.68);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-44 select-none"
        role="img"
        aria-label={`US Spot ${asset} ETF daily net inflows and outflows`}
      >
        {/* Zero line */}
        <line
          x1={padX}
          y1={midY}
          x2={width - padX}
          y2={midY}
          stroke="#334155"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
        {/* Top/Bottom scale labels */}
        <text x={padX} y={12} fill="#10b981" fontSize="9" fontFamily="monospace">
          +{fmtUsdCompact(maxAbs)}
        </text>
        <text x={padX} y={height - 4} fill="#f43f5e" fontSize="9" fontFamily="monospace">
          -{fmtUsdCompact(maxAbs)}
        </text>

        {ordered.map((row, idx) => {
          const val = row.totalNetInflow;
          const h = Math.max(2, (Math.abs(val) / maxAbs) * (plotH - 6));
          const x = padX + idx * step + (step - barW) / 2;
          const y = val >= 0 ? midY - h : midY;
          const fill = val >= 0 ? '#10b981' : '#f43f5e';
          const showLabel = idx === 0 || idx === ordered.length - 1 || idx % 5 === 0;
          return (
            <g key={`${row.date}-${idx}`}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx="2"
                fill={fill}
                fillOpacity="0.85"
              >
                <title>
                  {row.date}: {fmtUsdCompact(val, true)} net flow | AUM{' '}
                  {fmtUsdCompact(row.totalNetAssets)}
                </title>
              </rect>
              {showLabel && (
                <text
                  x={x + barW / 2}
                  y={height - 4}
                  textAnchor="middle"
                  fill="#64748b"
                  fontSize="8.5"
                  fontFamily="monospace"
                >
                  {row.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
};

export const SoSoValueTab: React.FC<Props> = ({
  apiKey,
  onChangeApiKey,
  proxyUrl,
  onChangeProxyUrl,
  sosoState,
  markets,
  loading,
  onConnectProxy,
  onProbeLiveKey,
  onReloadSnapshot,
  onSelectMarketForExecution,
}) => {
  const [selectedEtf, setSelectedEtf] = useState<SoSoEtfAsset>('BTC');
  const [draftProxy, setDraftProxy] = useState(proxyUrl);
  const [draftKey, setDraftKey] = useState(apiKey);
  const [showConnPanel, setShowConnPanel] = useState(false);

  const activeRows = sosoState.etfFlows[selectedEtf] ?? [];
  const activeStats = useMemo(() => computeEtfFlowStats(activeRows), [activeRows]);

  const crossChecks = useMemo(
    () => buildEtfFundingCrossChecks(sosoState.etfFlows, markets),
    [sosoState.etfFlows, markets],
  );

  const ssiRows = useMemo(
    () => computeSsiSectorFunding(sosoState.ssiIndices, markets),
    [sosoState.ssiIndices, markets],
  );

  const mag7Constituents = useMemo(
    () => sosoState.ssiIndices.find((i) => i.ticker === 'ssiMAG7')?.constituents ?? [],
    [sosoState.ssiIndices],
  );

  const hasData =
    sosoState.etfFlows.BTC.length > 0 ||
    sosoState.etfFlows.ETH.length > 0 ||
    sosoState.ssiIndices.length > 0;

  const modeBadge =
    sosoState.mode === 'LIVE_PROXY'
      ? { label: 'LIVE PROXY', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' }
      : sosoState.mode === 'LIVE_DIRECT'
        ? { label: 'LIVE DIRECT (IN-MEMORY KEY)', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' }
        : sosoState.mode === 'VERIFIED_SNAPSHOT'
          ? { label: 'VERIFIED LIVE SNAPSHOT', cls: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' }
          : { label: 'BYOK / STANDBY', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40' };

  const mstrMarket = markets.find((m) => m.baseCoin.toUpperCase() === 'MSTR');

  return (
    <div className="space-y-4">
      {/* Header & Zero-Secret Connection Architecture Bar */}
      <div className="bg-[#0e1522] border border-slate-800/90 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400" />
              Institutional ETF &amp; SSI Flow Intelligence (SoSoValue OpenAPI v1)
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Cross-checks live <span className="text-indigo-300 font-medium">US Spot BTC/ETH/SOL/XRP ETF flows</span> and{' '}
              <span className="text-cyan-300 font-medium">13 SoSoValue SSI Crypto Sector Indices</span> directly against live SoDEX Perp funding APR &amp; basis spreads. Zero credentials are ever bundled or persisted.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold border ${modeBadge.cls}`}>
              {modeBadge.label}
            </span>
            <button
              onClick={() => setShowConnPanel((v) => !v)}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 inline-flex items-center gap-1.5 border border-slate-700"
            >
              <Server className="w-3.5 h-3.5 text-cyan-400" />
              {showConnPanel ? 'Hide Connection Settings' : 'Proxy / Key Connection'}
            </button>
          </div>
        </div>

        {/* Verified provenance strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono bg-[#090d14] border border-slate-800/90 rounded px-3 py-2">
          <div className="flex flex-wrap items-center gap-3 text-slate-300">
            <span className="inline-flex items-center gap-1.5 text-emerald-300">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {sosoState.sourceLabel}
            </span>
            {sosoState.snapshotFetchedAt && (
              <span className="text-slate-400">
                Timestamp: <span className="text-slate-200">{sosoState.snapshotFetchedAt.replace('T', ' ').slice(0, 19)}Z</span>
              </span>
            )}
            {sosoState.endpointsVerified > 0 && (
              <span className="text-cyan-300">
                {sosoState.endpointsVerified} v1 endpoints verified
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400">
              Conviction ETF Z-Score:{' '}
              <b className={sosoState.etfFlowZScore >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
                {sosoState.etfFlowZScore >= 0 ? '+' : ''}
                {sosoState.etfFlowZScore.toFixed(2)}σ
              </b>
            </span>
            <button
              onClick={onReloadSnapshot}
              disabled={loading}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 inline-flex items-center gap-1"
              title="Reload verified live SoSoValue snapshot"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              Snapshot
            </button>
          </div>
        </div>

        {/* Collapsible Proxy + In-Memory Key Drawer */}
        {showConnPanel && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-2 border-t border-slate-800/80">
            {/* Option A: Local / Custom soso-proxy */}
            <div className="bg-[#090d14] border border-slate-800 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-emerald-400" />
                  1. Connect Local / Custom <code className="text-emerald-300">soso-proxy</code>
                </span>
                <span className="text-[10px] font-mono text-slate-500">Zero key in browser</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Run <code className="text-cyan-300">SOSO_API_KEY=... npm run soso:proxy</code> (default port <code className="text-slate-300">9105</code>, rate-limited 60s TTL cache) and connect live.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={draftProxy}
                  onChange={(e) => setDraftProxy(e.target.value)}
                  placeholder="http://127.0.0.1:9105"
                  className="flex-1 bg-[#0e1522] border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
                <button
                  onClick={() => {
                    onChangeProxyUrl(draftProxy.trim());
                    onConnectProxy(draftProxy.trim());
                  }}
                  disabled={loading}
                  className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition whitespace-nowrap"
                >
                  Connect Proxy
                </button>
              </div>
            </div>

            {/* Option B: In-Memory Direct Key (BYOK) */}
            <div className="bg-[#090d14] border border-slate-800 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-indigo-400" />
                  2. Direct Browser Key (In-Memory Only)
                </span>
                <a
                  href="https://sosovalue.com/developer/console/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-0.5"
                >
                  Get Free Key <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
              <p className="text-[11px] text-slate-400">
                Calls <code className="text-cyan-300">openapi.sosovalue.com/openapi/v1/*</code> directly via CORS. Key stays strictly in RAM (never written to disk or localStorage).
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={draftKey}
                  onChange={(e) => setDraftKey(e.target.value)}
                  placeholder="x-soso-api-key (RAM-only, cleared on reload)"
                  className="flex-1 bg-[#0e1522] border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-indigo-500"
                />
                <button
                  onClick={() => {
                    onChangeApiKey(draftKey.trim());
                    onProbeLiveKey(draftKey.trim());
                  }}
                  disabled={loading}
                  className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition whitespace-nowrap"
                >
                  Fetch Live
                </button>
                <button
                  onClick={() => onProbeLiveKey('')}
                  disabled={loading}
                  className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 inline-flex items-center gap-1"
                  title="Probe live CORS & 401 auth gate contract"
                >
                  <Radio className="w-3 h-3 text-cyan-400" />
                  CORS
                </button>
              </div>
            </div>
          </div>
        )}

        {sosoState.error && (
          <div className="flex items-start gap-2 text-xs bg-amber-950/30 border border-amber-700/50 text-amber-200 rounded p-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <div>{sosoState.error}</div>
          </div>
        )}
      </div>

      {/* Macro Market Overview KPI Strip */}
      {sosoState.marketOverview && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-[#0e1522] border border-slate-800/90 rounded-lg p-3">
            <div className="text-[11px] text-slate-400">Global Crypto Market Cap</div>
            <div className="text-lg font-mono font-bold text-slate-100 mt-0.5">
              {fmtUsdCompact(sosoState.marketOverview.totalMarketCap)}
            </div>
            <div
              className={`text-[11px] font-mono ${
                sosoState.marketOverview.totalMarketCapChangePct >= 0
                  ? 'text-emerald-400'
                  : 'text-rose-400'
              }`}
            >
              {sosoState.marketOverview.totalMarketCapChangePct >= 0 ? '+' : ''}
              {sosoState.marketOverview.totalMarketCapChangePct.toFixed(2)}% (24h)
            </div>
          </div>

          <div className="bg-[#0e1522] border border-slate-800/90 rounded-lg p-3">
            <div className="text-[11px] text-slate-400">24h Global Spot+Perp Vol</div>
            <div className="text-lg font-mono font-bold text-slate-100 mt-0.5">
              {fmtUsdCompact(sosoState.marketOverview.totalVolume24h)}
            </div>
            <div className="text-[11px] text-slate-500 font-mono">SoSoValue /market/overview</div>
          </div>

          <div className="bg-[#0e1522] border border-slate-800/90 rounded-lg p-3">
            <div className="text-[11px] text-slate-400">US Spot BTC ETF AUM</div>
            <div className="text-lg font-mono font-bold text-cyan-300 mt-0.5">
              {fmtUsdCompact(computeEtfFlowStats(sosoState.etfFlows.BTC).totalNetAssets)}
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              30d Flow Z:{' '}
              <span className={sosoState.btcEtfFlowZScore >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {sosoState.btcEtfFlowZScore >= 0 ? '+' : ''}
                {sosoState.btcEtfFlowZScore.toFixed(2)}σ
              </span>
            </div>
          </div>

          <div className="bg-[#0e1522] border border-slate-800/90 rounded-lg p-3">
            <div className="text-[11px] text-slate-400">US Spot ETH ETF AUM</div>
            <div className="text-lg font-mono font-bold text-indigo-300 mt-0.5">
              {fmtUsdCompact(computeEtfFlowStats(sosoState.etfFlows.ETH).totalNetAssets)}
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              30d Flow Z:{' '}
              <span className={sosoState.ethEtfFlowZScore >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {sosoState.ethEtfFlowZScore >= 0 ? '+' : ''}
                {sosoState.ethEtfFlowZScore.toFixed(2)}σ
              </span>
            </div>
          </div>

          <div className="bg-[#0e1522] border border-slate-800/90 rounded-lg p-3">
            <div className="text-[11px] text-slate-400">Network Fee Telemetry</div>
            <div className="text-sm font-mono font-bold text-slate-100 mt-1">
              ETH {sosoState.marketOverview.ethGasGwei.toFixed(2)} gwei
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-0.5">
              BTC {sosoState.marketOverview.btcGasSatVb.toFixed(2)} sat/vB
            </div>
          </div>
        </div>
      )}

      {hasData && (
        <>
          {/* Section 1: ETF Flows vs SoDEX Funding & Basis Cross-Check Matrix */}
          <div className="bg-[#0e1522] border border-slate-800/90 rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  Institutional ETF Flow × SoDEX Perp Funding &amp; Basis Cross-Check
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Joins real-time SoSoValue US Spot ETF net flows with live SoDEX Mainnet/Testnet funding APR &amp; Spot↔Perp spreads to isolate carry/divergence setups.
                </p>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                LIVE CROSS-VENUE ALPHA
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] font-mono uppercase text-slate-400">
                    <th className="py-2 pr-3">Asset / Perp</th>
                    <th className="py-2 px-2 text-right">Latest ETF Flow</th>
                    <th className="py-2 px-2 text-right">5D Cum Flow</th>
                    <th className="py-2 px-2 text-right">30D Flow Z</th>
                    <th className="py-2 px-2 text-right">SoDEX Funding APR</th>
                    <th className="py-2 px-2 text-right">Mark-Idx / Spot-Perp</th>
                    <th className="py-2 px-3">Cross-Check Regime</th>
                    <th className="py-2 pl-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {crossChecks.map((row) => (
                    <tr key={row.asset} className="hover:bg-slate-800/30 transition">
                      <td className="py-2.5 pr-3">
                        <div className="font-bold text-slate-100">{row.asset} Spot ETF</div>
                        <div className="text-[10px] text-slate-500">
                          {row.perpSymbol} · AUM {fmtUsdCompact(row.totalNetAssetsUsd)}
                        </div>
                      </td>
                      <td
                        className={`py-2.5 px-2 text-right font-semibold ${
                          row.latestNetInflowUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        <div>{fmtUsdCompact(row.latestNetInflowUsd, true)}</div>
                        <div className="text-[10px] text-slate-500 font-normal">
                          {row.latestDate ?? '—'}
                        </div>
                      </td>
                      <td
                        className={`py-2.5 px-2 text-right ${
                          row.fiveDayNetInflowUsd >= 0 ? 'text-emerald-300' : 'text-rose-300'
                        }`}
                      >
                        {fmtUsdCompact(row.fiveDayNetInflowUsd, true)}
                      </td>
                      <td
                        className={`py-2.5 px-2 text-right ${
                          row.flowZScore >= 0.5
                            ? 'text-emerald-300'
                            : row.flowZScore <= -0.5
                              ? 'text-rose-300'
                              : 'text-slate-300'
                        }`}
                      >
                        {row.flowZScore >= 0 ? '+' : ''}
                        {row.flowZScore.toFixed(2)}σ
                      </td>
                      <td
                        className={`py-2.5 px-2 text-right font-semibold ${
                          row.perpFundingAprPct >= 0 ? 'text-emerald-300' : 'text-rose-300'
                        }`}
                      >
                        {row.hasLivePerp
                          ? `${row.perpFundingAprPct >= 0 ? '+' : ''}${row.perpFundingAprPct.toFixed(2)}%`
                          : '—'}
                      </td>
                      <td className="py-2.5 px-2 text-right text-slate-300">
                        <div>
                          {row.markIndexBasisBps >= 0 ? '+' : ''}
                          {row.markIndexBasisBps.toFixed(1)} bps
                        </div>
                        <div className="text-[10px] text-cyan-400">
                          {row.spotPerpSpreadBps !== null
                            ? `Spot↔Perp ${row.spotPerpSpreadBps >= 0 ? '+' : ''}${row.spotPerpSpreadBps.toFixed(1)}bp`
                            : 'Perp only'}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-sans max-w-xs">
                        <span
                          className={`inline-block text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border mb-1 ${
                            row.regimeTag.includes('SHORT') || row.regimeTag.includes('DELEVERAGING')
                              ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                              : row.regimeTag.includes('LONG') || row.regimeTag.includes('BULLISH')
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                : row.regimeTag.includes('SQUEEZE')
                                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                  : 'bg-slate-800 text-slate-300 border-slate-700'
                          }`}
                        >
                          {row.regimeTag}
                        </span>
                        <p className="text-[11px] text-slate-400 leading-snug">{row.thesis}</p>
                      </td>
                      <td className="py-2.5 pl-2 text-right">
                        {row.hasLivePerp && (
                          <button
                            onClick={() => onSelectMarketForExecution(row.perpSymbol)}
                            className="px-2.5 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/40 text-emerald-300 text-[11px] font-sans font-medium inline-flex items-center gap-1 whitespace-nowrap"
                          >
                            Desk <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 2: Interactive US Spot ETF Flow Chart & Session History */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-[#0e1522] border border-slate-800/90 rounded-lg p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                  <BarChart3 className="w-4 h-4 text-cyan-400" />
                  US Spot {selectedEtf} ETF Daily Net Inflow / Outflow ({activeRows.length} Sessions)
                </h3>
                <div className="inline-flex rounded bg-[#090d14] border border-slate-800 p-0.5 text-[11px] font-mono">
                  {(['BTC', 'ETH', 'SOL', 'XRP'] as const).map((sym) => (
                    <button
                      key={sym}
                      onClick={() => setSelectedEtf(sym)}
                      className={`px-2.5 py-0.5 rounded transition ${
                        selectedEtf === sym
                          ? 'bg-indigo-500/30 text-indigo-200 font-bold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {sym}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                <div className="bg-[#090d14] border border-slate-800/80 rounded p-2.5">
                  <div className="text-[10px] text-slate-500">Latest ({activeStats.latestDate ?? '—'})</div>
                  <div
                    className={`font-bold text-sm mt-0.5 ${
                      activeStats.latestNetInflow >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {fmtUsdCompact(activeStats.latestNetInflow, true)}
                  </div>
                </div>
                <div className="bg-[#090d14] border border-slate-800/80 rounded p-2.5">
                  <div className="text-[10px] text-slate-500">5-Day Cumulative</div>
                  <div
                    className={`font-bold text-sm mt-0.5 ${
                      activeStats.fiveDayNetInflow >= 0 ? 'text-emerald-300' : 'text-rose-300'
                    }`}
                  >
                    {fmtUsdCompact(activeStats.fiveDayNetInflow, true)}
                  </div>
                </div>
                <div className="bg-[#090d14] border border-slate-800/80 rounded p-2.5">
                  <div className="text-[10px] text-slate-500">Total Net Assets</div>
                  <div className="font-bold text-sm text-cyan-300 mt-0.5">
                    {fmtUsdCompact(activeStats.totalNetAssets)}
                  </div>
                </div>
                <div className="bg-[#090d14] border border-slate-800/80 rounded p-2.5">
                  <div className="text-[10px] text-slate-500">All-Time Cum Flow</div>
                  <div className="font-bold text-sm text-slate-100 mt-0.5">
                    {fmtUsdCompact(activeStats.cumNetInflow, true)}
                  </div>
                </div>
              </div>

              <EtfFlowBarChart rows={activeRows} asset={selectedEtf} />

              {selectedEtf === 'BTC' && sosoState.btcEtfProducts.length > 0 && (
                <div className="pt-2 border-t border-slate-800/70">
                  <div className="text-[10px] font-mono uppercase text-slate-500 mb-1.5">
                    Tracked US Spot BTC ETF Issuers ({sosoState.btcEtfProducts.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {sosoState.btcEtfProducts.map((p) => (
                      <span
                        key={p.ticker}
                        className="px-2 py-0.5 rounded bg-[#090d14] border border-slate-800 text-[10px] font-mono text-slate-300"
                        title={`${p.name} (${p.exchange})`}
                      >
                        <b className="text-cyan-300">{p.ticker}</b> · {p.exchange}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Recent Daily Sessions Ledger */}
            <div className="bg-[#0e1522] border border-slate-800/90 rounded-lg p-4 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  {selectedEtf} ETF Session Ledger
                </h4>
                <span className="text-[10px] font-mono text-slate-500">
                  Streak: {activeStats.streakDays > 0 ? `+${activeStats.streakDays}d in` : `${activeStats.streakDays}d out`}
                </span>
              </div>
              <div className="flex-1 max-h-72 overflow-y-auto font-mono text-[11px] divide-y divide-slate-800/60">
                {activeRows.slice(0, 15).map((row) => (
                  <div key={row.date} className="py-1.5 flex items-center justify-between gap-2">
                    <span className="text-slate-400">{row.date}</span>
                    <span className="text-slate-500 text-[10px]">
                      Vol {fmtUsdCompact(row.totalValueTraded)}
                    </span>
                    <span
                      className={`font-semibold ${
                        row.totalNetInflow >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {fmtUsdCompact(row.totalNetInflow, true)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Section 3: SoSoValue SSI Crypto Sector Indices vs SoDEX Sector Funding */}
          <div className="bg-[#0e1522] border border-slate-800/90 rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                  <Flame className="w-4 h-4 text-amber-400" />
                  SoSoValue SSI Crypto Sector Indices ({ssiRows.length} Live Benchmarks) × SoDEX Funding
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Live SSI index NAV &amp; multi-horizon ROI mapped to overlapping SoDEX Perpetual baskets to detect sector carry dislocations.
                </p>
              </div>
              {mag7Constituents.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 text-[10px] font-mono">
                  <span className="text-slate-500 mr-1">ssiMAG7 weights:</span>
                  {mag7Constituents.slice(0, 6).map((c) => (
                    <span
                      key={c.symbol}
                      className="px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 uppercase"
                    >
                      {c.symbol.slice(0, 6)} {(c.weight * 100).toFixed(1)}%
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse font-mono">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-400">
                    <th className="py-2 pr-3">SSI Index</th>
                    <th className="py-2 px-2 text-right">Index NAV</th>
                    <th className="py-2 px-2 text-right">24h</th>
                    <th className="py-2 px-2 text-right">7d ROI</th>
                    <th className="py-2 px-2 text-right">1m ROI</th>
                    <th className="py-2 px-2 text-right">3m ROI</th>
                    <th className="py-2 px-2 text-right">YTD</th>
                    <th className="py-2 px-2 text-right">SoDEX Sector Funding</th>
                    <th className="py-2 pl-2 text-right">Matched Perps</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {ssiRows.map(({ index, matchedSymbols, avgFundingAprPct, avgBasisBps }) => (
                    <tr key={index.ticker} className="hover:bg-slate-800/30 transition">
                      <td className="py-2 pr-3 font-bold text-cyan-300">{index.ticker}</td>
                      <td className="py-2 px-2 text-right text-slate-100">
                        ${index.price.toFixed(2)}
                      </td>
                      <td
                        className={`py-2 px-2 text-right ${
                          index.changePct24h >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {fmtPct(index.changePct24h)}
                      </td>
                      <td
                        className={`py-2 px-2 text-right ${
                          index.roi7d >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {fmtPct(index.roi7d, 1)}
                      </td>
                      <td
                        className={`py-2 px-2 text-right ${
                          index.roi1m >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {fmtPct(index.roi1m, 1)}
                      </td>
                      <td
                        className={`py-2 px-2 text-right ${
                          index.roi3m >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {fmtPct(index.roi3m, 1)}
                      </td>
                      <td
                        className={`py-2 px-2 text-right ${
                          index.ytd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {fmtPct(index.ytd, 1)}
                      </td>
                      <td
                        className={`py-2 px-2 text-right font-semibold ${
                          avgFundingAprPct === null
                            ? 'text-slate-500'
                            : avgFundingAprPct >= 0
                              ? 'text-emerald-300'
                              : 'text-rose-300'
                        }`}
                      >
                        {avgFundingAprPct !== null
                          ? `${avgFundingAprPct >= 0 ? '+' : ''}${avgFundingAprPct.toFixed(1)}% APR`
                          : '—'}
                        {avgBasisBps !== null && (
                          <span className="block text-[10px] text-slate-500 font-normal">
                            basis {avgBasisBps >= 0 ? '+' : ''}
                            {avgBasisBps.toFixed(1)}bp
                          </span>
                        )}
                      </td>
                      <td className="py-2 pl-2 text-right text-[10px] text-slate-400">
                        {matchedSymbols.length > 0
                          ? matchedSymbols.slice(0, 4).map((s) => s.replace('-USD', '')).join(', ') +
                            (matchedSymbols.length > 4 ? ` +${matchedSymbols.length - 4}` : '')
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 4: Hot Institutional News & Corporate BTC Treasuries */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-[#0e1522] border border-slate-800/90 rounded-lg p-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-1.5">
                <Newspaper className="w-4 h-4 text-cyan-400" />
                SoSoValue Hot Institutional Catalysts ({sosoState.hotNews.length})
              </h4>
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-800/60 space-y-1">
                {sosoState.hotNews.map((n) => (
                  <div key={n.id || n.title} className="pt-2 pb-1.5 first:pt-0">
                    <div className="flex items-start justify-between gap-2">
                      <a
                        href={n.sourceLink || 'https://sosovalue.com'}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium text-slate-100 hover:text-cyan-300 transition leading-snug"
                      >
                        {n.title}
                      </a>
                      {n.sourceLink && (
                        <ExternalLink className="w-3 h-3 text-slate-500 shrink-0 mt-0.5" />
                      )}
                    </div>
                    {n.summary && (
                      <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{n.summary}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-[#0e1522] border border-slate-800/90 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-indigo-400" />
                  Corporate BTC Treasuries ({sosoState.treasuries.length})
                </h4>
                {mstrMarket && (
                  <button
                    onClick={() => onSelectMarketForExecution(mstrMarket.symbol)}
                    className="text-[11px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/30 inline-flex items-center gap-1"
                  >
                    Trade {mstrMarket.symbol} ({mstrMarket.annualizedFundingApr >= 0 ? '+' : ''}
                    {mstrMarket.annualizedFundingApr.toFixed(1)}% APR)
                  </button>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto font-mono text-xs divide-y divide-slate-800/60">
                {sosoState.treasuries.map((t) => {
                  const matchedEq = markets.find(
                    (m) => m.baseCoin.toUpperCase() === t.ticker.toUpperCase(),
                  );
                  return (
                    <div key={`${t.ticker}-${t.name}`} className="py-2 flex items-center justify-between gap-2">
                      <div>
                        <span className="font-bold text-slate-100">{t.ticker}</span>{' '}
                        <span className="text-slate-400 font-sans text-[11px]">{t.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-500">{t.listLocation}</span>
                        {matchedEq && (
                          <button
                            onClick={() => onSelectMarketForExecution(matchedEq.symbol)}
                            className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px]"
                          >
                            SoDEX Perp
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Architecture & Security Footer */}
      <div className="bg-[#0b101b] border border-slate-800/80 rounded-lg p-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          Zero-Secret Architecture: Static GitHub Pages loads sanitized <code className="text-slate-300">public/data/soso-snapshot.json</code>; live polling runs via <code className="text-slate-300">server/soso-proxy.mjs</code> or RAM-only user key.
        </span>
        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-slate-500">
          <Database className="w-3 h-3" /> SoSoValue OpenAPI v1
        </span>
      </div>
    </div>
  );
};
