import React, { useMemo, useState } from 'react';
import { Activity, AlertTriangle, Download, Flame, ShieldCheck } from 'lucide-react';
import type { EnrichedMarket, KlineBar, RiskEvaluationResult } from '../types';
import { runLiveBootstrapMonteCarlo } from '../lib/quant';

interface Props {
  market: EnrichedMarket | null;
  klines: KlineBar[];
  side: 'LONG' | 'SHORT';
  equity: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  liveSlippageBps: number;
  evaluation: RiskEvaluationResult | null;
}

export const MonteCarloStressCard: React.FC<Props> = ({
  market,
  klines,
  side,
  equity,
  stopLossPrice,
  takeProfitPrice,
  liveSlippageBps,
  evaluation,
}) => {
  const [horizonHours, setHorizonHours] = useState<24 | 72 | 168>(72);

  const result = useMemo(() => {
    if (!market || !evaluation || market.markPrice <= 0) return null;
    return runLiveBootstrapMonteCarlo({
      market,
      klines,
      side,
      accountEquityUsd: equity,
      positionNotionalUsd: evaluation.positionNotionalUsd,
      positionQty: evaluation.positionQty,
      entryPrice: market.markPrice,
      stopLossPrice,
      takeProfitPrice,
      liquidationPrice: evaluation.liquidationPrice,
      entrySlippageBps: liveSlippageBps,
      horizonHours,
      numPaths: 1000,
    });
  }, [
    market,
    klines,
    side,
    equity,
    stopLossPrice,
    takeProfitPrice,
    liveSlippageBps,
    evaluation,
    horizonHours,
  ]);

  if (!market || !evaluation || !result) return null;

  // Build SVG fan chart coordinates
  const width = 560;
  const height = 190;
  const padL = 54;
  const padR = 16;
  const padT = 14;
  const padB = 26;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const allVals = result.bands.flatMap((b) => [b.p10, b.p90, equity]);
  const minVal = Math.min(...allVals) * 0.995;
  const maxVal = Math.max(...allVals) * 1.005;
  const span = Math.max(1, maxVal - minVal);

  const xAt = (idx: number) =>
    padL + (result.bands.length > 1 ? (idx / (result.bands.length - 1)) * plotW : 0);
  const yAt = (val: number) => padT + plotH - ((val - minVal) / span) * plotH;

  const polyArea = (upper: number[], lower: number[]) => {
    const topPts = upper.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
    const botPts = [...lower]
      .reverse()
      .map((v, i) => `${xAt(lower.length - 1 - i).toFixed(1)},${yAt(v).toFixed(1)}`)
      .join(' ');
    return `${topPts} ${botPts}`;
  };

  const p50Line = result.bands
    .map((b, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(b.p50).toFixed(1)}`)
    .join(' ');

  const handleExportAuditJson = () => {
    const report = {
      generatedAtUtc: new Date().toISOString(),
      terminal: 'BasisFlow Terminal v1.2.0',
      symbol: market.symbol,
      side,
      accountEquityUsd: equity,
      riskGateApproved: evaluation.approved,
      riskChecks: evaluation.checks,
      orderPayload: evaluation.orderPayload,
      monteCarloBootstrap: {
        source:
          result.sampleReturnsCount >= 5
            ? `Live SoDEX /klines empirical log-returns (N=${result.sampleReturnsCount})`
            : 'Pending live klines envelope',
        numPaths: result.numPaths,
        horizonHours: result.horizonHours,
        annualizedRealizedVolPct: result.annualizedRealizedVolPct,
        expectedPnlUsd: result.expectedPnlUsd,
        medianPnlUsd: result.medianPnlUsd,
        var95Usd: result.var95Usd,
        var95Pct: result.var95Pct,
        cvar99Usd: result.cvar99Usd,
        cvar99Pct: result.cvar99Pct,
        tpHitRatePct: result.tpHitRatePct,
        slHitRatePct: result.slHitRatePct,
        liquidationProbPct: result.liquidationProbPct,
        winRatePct: result.winRatePct,
      },
      stressScenarios: result.stressScenarios,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `basisflow-risk-audit-${market.symbol.toLowerCase()}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-[#0e1522] border border-slate-800/90 rounded-lg p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Flame className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-slate-100">
              Empirical Monte Carlo &amp; Tail-Stress Risk Engine ({result.numPaths.toLocaleString()} Paths)
            </h3>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                result.sampleReturnsCount >= 5
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                  : 'bg-amber-500/15 text-amber-300 border-amber-500/40'
              }`}
            >
              {result.sampleReturnsCount >= 5
                ? `LIVE KLINES BOOTSTRAP (N=${result.sampleReturnsCount})`
                : 'LOADING KLINES'}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Deterministic seeded bootstrap directly from live SoDEX{' '}
            <span className="font-mono text-slate-300">{market.symbol}</span> realized candle returns — modeling SL, TP, contract liquidation, taker fees, L2 slippage &amp; hourly funding accrual.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-[#090d14] border border-slate-800 rounded p-0.5 text-[11px] font-mono">
            {([24, 72, 168] as const).map((h) => (
              <button
                key={h}
                onClick={() => setHorizonHours(h)}
                className={`px-2 py-0.5 rounded transition ${
                  horizonHours === h
                    ? 'bg-cyan-500/20 text-cyan-300 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {h}h
              </button>
            ))}
          </div>
          <button
            onClick={handleExportAuditJson}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-medium text-slate-200 transition"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            Export Risk Audit JSON
          </button>
        </div>
      </div>

      {/* Key Quant Risk Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs font-mono">
        <div className="bg-[#090d14] border border-slate-800 rounded p-2.5">
          <div className="text-[10px] uppercase text-slate-500">95% Value-at-Risk</div>
          <div className="text-base font-bold text-amber-300 mt-0.5">-${result.var95Usd.toLocaleString()}</div>
          <div className="text-[10px] text-slate-400">-{result.var95Pct.toFixed(2)}% of equity</div>
        </div>
        <div className="bg-[#090d14] border border-slate-800 rounded p-2.5">
          <div className="text-[10px] uppercase text-slate-500">99% CVaR (Tail ES)</div>
          <div className="text-base font-bold text-rose-400 mt-0.5">-${result.cvar99Usd.toLocaleString()}</div>
          <div className="text-[10px] text-slate-400">-{result.cvar99Pct.toFixed(2)}% worst 1%</div>
        </div>
        <div className="bg-[#090d14] border border-slate-800 rounded p-2.5">
          <div className="text-[10px] uppercase text-slate-500">Liquidation Prob</div>
          <div
            className={`text-base font-bold mt-0.5 ${
              result.liquidationProbPct === 0
                ? 'text-emerald-400'
                : result.liquidationProbPct < 2
                  ? 'text-amber-300'
                  : 'text-rose-400'
            }`}
          >
            {result.liquidationProbPct.toFixed(1)}%
          </div>
          <div className="text-[10px] text-slate-400">over {horizonHours}h horizon</div>
        </div>
        <div className="bg-[#090d14] border border-slate-800 rounded p-2.5">
          <div className="text-[10px] uppercase text-slate-500">Realized Vol (Ann.)</div>
          <div className="text-base font-bold text-cyan-300 mt-0.5">{result.annualizedRealizedVolPct.toFixed(1)}%</div>
          <div className="text-[10px] text-slate-400">Win rate: {result.winRatePct.toFixed(1)}%</div>
        </div>
        <div className="bg-[#090d14] border border-slate-800 rounded p-2.5">
          <div className="text-[10px] uppercase text-slate-500">TP / SL Trigger Rate</div>
          <div className="text-base font-bold text-slate-100 mt-0.5">
            <span className="text-emerald-400">{result.tpHitRatePct.toFixed(0)}%</span> /{' '}
            <span className="text-rose-400">{result.slHitRatePct.toFixed(0)}%</span>
          </div>
          <div className="text-[10px] text-slate-400">
            E[PnL]: {result.expectedPnlUsd >= 0 ? '+' : ''}${result.expectedPnlUsd.toFixed(0)}
          </div>
        </div>
      </div>

      {/* Fan Chart + Deterministic Tail-Stress Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-7 bg-[#090d14] border border-slate-800 rounded p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-200">
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              Projected Equity Fan (P10–P90 / P25–P75 / Median P50)
            </span>
            <span className="font-mono text-[10px] text-slate-500">
              Start Equity: ${equity.toLocaleString()}
            </span>
          </div>
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44 select-none">
            {/* Baseline equity line */}
            <line
              x1={padL}
              y1={yAt(equity)}
              x2={width - padR}
              y2={yAt(equity)}
              stroke="#475569"
              strokeDasharray="3 3"
              strokeWidth="1"
            />
            {/* P10-P90 outer band */}
            <polygon
              points={polyArea(
                result.bands.map((b) => b.p90),
                result.bands.map((b) => b.p10),
              )}
              fill="rgba(34, 211, 238, 0.12)"
            />
            {/* P25-P75 inner band */}
            <polygon
              points={polyArea(
                result.bands.map((b) => b.p75),
                result.bands.map((b) => b.p25),
              )}
              fill="rgba(16, 185, 129, 0.22)"
            />
            {/* Median P50 path */}
            <path d={p50Line} fill="none" stroke="#34d399" strokeWidth="2.2" />

            {/* Y axis labels */}
            {[maxVal, equity, minVal].map((v, idx) => (
              <text
                key={idx}
                x={padL - 6}
                y={yAt(v) + 3}
                textAnchor="end"
                className="fill-slate-400 text-[9px] font-mono"
              >
                ${v.toFixed(0)}
              </text>
            ))}

            {/* X axis labels */}
            {[0, Math.floor(result.bands.length / 2), result.bands.length - 1].map((idx) => (
              <text
                key={idx}
                x={xAt(idx)}
                y={height - 6}
                textAnchor="middle"
                className="fill-slate-500 text-[9px] font-mono"
              >
                +{result.bands[idx].hour}h
              </text>
            ))}
          </svg>
        </div>

        <div className="lg:col-span-5 bg-[#090d14] border border-slate-800 rounded p-3">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-200 mb-2">
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              Deterministic Tail-Stress Matrix
            </span>
            <span className="text-[10px] font-mono text-slate-500">{side} Position</span>
          </div>
          <div className="space-y-2">
            {result.stressScenarios.map((sc) => (
              <div
                key={sc.id}
                className="p-2 rounded border border-slate-800/90 bg-[#0e1522] flex items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-200 truncate">{sc.label}</div>
                  <div className="text-[10px] text-slate-400 truncate">{sc.shockSummary}</div>
                </div>
                <div className="text-right font-mono shrink-0">
                  <div
                    className={`font-semibold ${
                      sc.projectedPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {sc.projectedPnlUsd >= 0 ? '+' : ''}${sc.projectedPnlUsd.toFixed(0)} (
                    {sc.equityImpactPct >= 0 ? '+' : ''}
                    {sc.equityImpactPct.toFixed(1)}%)
                  </div>
                  <span
                    className={`inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-bold ${
                      sc.outcome === 'LIQUIDATED'
                        ? 'bg-rose-500/20 text-rose-300'
                        : sc.outcome === 'STOPPED'
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    {sc.outcome === 'SURVIVES' || sc.outcome === 'TP_HIT' ? (
                      <ShieldCheck className="w-2.5 h-2.5" />
                    ) : null}
                    {sc.outcome}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
