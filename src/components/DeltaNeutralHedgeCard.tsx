import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, CheckCircle2, Copy, AlertTriangle, Layers } from 'lucide-react';
import type { EnrichedMarket, HedgeStrategyMode, OrderbookData } from '../types';
import { computeDeltaNeutralCarry } from '../lib/quant';

interface Props {
  market: EnrichedMarket | null;
  perpOrderbook: OrderbookData | null;
  spotOrderbook: OrderbookData | null;
}

export const DeltaNeutralHedgeCard: React.FC<Props> = ({
  market,
  perpOrderbook,
  spotOrderbook,
}) => {
  const [notionalUsd, setNotionalUsd] = useState(25_000);
  const [holdingDays, setHoldingDays] = useState(30);
  const [strategy, setStrategy] = useState<HedgeStrategyMode>('CASH_AND_CARRY');
  const [executionMode, setExecutionMode] = useState<'TAKER' | 'MAKER'>('TAKER');
  const [captureBasis, setCaptureBasis] = useState(true);
  const [copiedPlan, setCopiedPlan] = useState(false);

  // Auto-select strategy matching live funding direction
  useEffect(() => {
    if (!market) return;
    setStrategy(market.annualizedFundingApr >= 0 ? 'CASH_AND_CARRY' : 'REVERSE_CARRY');
  }, [market?.symbol, market?.annualizedFundingApr]);

  const hedge = useMemo(() => {
    if (!market) return null;
    return computeDeltaNeutralCarry({
      market,
      notionalUsd,
      holdingDays,
      strategy,
      executionMode,
      captureBasisConvergence: captureBasis,
      spotOrderbook,
      perpOrderbook,
    });
  }, [market, notionalUsd, holdingDays, strategy, executionMode, captureBasis, spotOrderbook, perpOrderbook]);

  if (!market || !hedge) return null;

  const verdictClass =
    hedge.verdict === 'POSITIVE_EDGE'
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
      : hedge.verdict === 'THIN_EDGE'
        ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
        : 'bg-rose-500/20 text-rose-300 border-rose-500/50';

  const handleCopyPlan = () => {
    navigator.clipboard?.writeText(JSON.stringify(hedge.atomicPlan, null, 2));
    setCopiedPlan(true);
    setTimeout(() => setCopiedPlan(false), 1800);
  };

  return (
    <div className="bg-[#0e1522] border border-indigo-500/30 rounded-lg p-4 space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4 text-indigo-400" />
            Multi-Leg Spot↔Perp Delta-Neutral Hedge &amp; Net Carry Builder
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Sweeps BOTH live SoDEX Spot L2 ({market.spotSymbol ?? 'No Spot Pair — Index Proxy'}) and Perp L2 ({market.symbol}) books to compute true net carry APR &amp; breakeven hours after round-trip slippage and fees.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
              hedge.spotBookLive
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
          >
            SPOT L2: {hedge.spotBookLive ? 'LIVE 20-LVL' : 'SPREAD EST'}
          </span>
          <span
            className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
              hedge.perpBookLive
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
          >
            PERP L2: {hedge.perpBookLive ? 'LIVE WS/REST' : 'SPREAD EST'}
          </span>
          <span className={`text-[11px] font-mono px-2.5 py-0.5 rounded font-bold border ${verdictClass}`}>
            {hedge.verdict.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Controls */}
        <div className="lg:col-span-5 space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => setStrategy('CASH_AND_CARRY')}
              className={`py-1.5 px-2 rounded border text-[11px] font-semibold transition ${
                strategy === 'CASH_AND_CARRY'
                  ? 'bg-indigo-500/20 border-indigo-400 text-indigo-200'
                  : 'bg-[#090d14] border-slate-800 text-slate-400'
              }`}
            >
              Cash &amp; Carry (Buy Spot / Short Perp)
            </button>
            <button
              onClick={() => setStrategy('REVERSE_CARRY')}
              className={`py-1.5 px-2 rounded border text-[11px] font-semibold transition ${
                strategy === 'REVERSE_CARRY'
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                  : 'bg-[#090d14] border-slate-800 text-slate-400'
              }`}
            >
              Reverse Carry (Sell Spot / Long Perp)
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Notional Per Leg ($)</label>
              <div className="grid grid-cols-3 gap-1 mb-1.5">
                {[5_000, 25_000, 100_000].map((v) => (
                  <button
                    key={v}
                    onClick={() => setNotionalUsd(v)}
                    className={`py-0.5 rounded text-[10px] font-mono border ${
                      notionalUsd === v
                        ? 'bg-indigo-500/20 border-indigo-400/60 text-indigo-200'
                        : 'bg-[#090d14] border-slate-800 text-slate-400'
                    }`}
                  >
                    ${v / 1000}k
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={100}
                step={1000}
                value={notionalUsd}
                onChange={(e) => setNotionalUsd(Math.max(100, Number(e.target.value) || 0))}
                className="w-full bg-[#090d14] border border-slate-700 rounded px-2 py-1 font-mono text-slate-100"
              />
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Holding Horizon (Days)</label>
              <div className="grid grid-cols-3 gap-1 mb-1.5">
                {[7, 30, 90].map((d) => (
                  <button
                    key={d}
                    onClick={() => setHoldingDays(d)}
                    className={`py-0.5 rounded text-[10px] font-mono border ${
                      holdingDays === d
                        ? 'bg-indigo-500/20 border-indigo-400/60 text-indigo-200'
                        : 'bg-[#090d14] border-slate-800 text-slate-400'
                    }`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={1}
                max={365}
                value={holdingDays}
                onChange={(e) => setHoldingDays(Math.max(1, Number(e.target.value) || 1))}
                className="w-full bg-[#090d14] border border-slate-700 rounded px-2 py-1 font-mono text-slate-100"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="inline-flex rounded bg-[#090d14] border border-slate-800 p-0.5 text-[11px] font-mono">
              {(['TAKER', 'MAKER'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setExecutionMode(m)}
                  className={`px-2.5 py-1 rounded transition ${
                    executionMode === m
                      ? 'bg-emerald-500/20 text-emerald-300 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {m === 'TAKER' ? 'Taker IOC (L2 Sweep)' : 'Maker Post-Only (0 Slip)'}
                </button>
              ))}
            </div>

            <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={captureBasis}
                onChange={(e) => setCaptureBasis(e.target.checked)}
                className="accent-indigo-500"
              />
              Capture Spot↔Perp Basis
            </label>
          </div>
        </div>

        {/* Quantitative Breakdown */}
        <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono">
          <div className="bg-[#090d14] border border-slate-800 rounded p-2.5">
            <div className="text-[10px] text-slate-500 font-sans uppercase">Gross Funding APR</div>
            <div
              className={`text-base font-bold mt-1 ${
                hedge.grossFundingAprPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {hedge.grossFundingAprPct >= 0 ? '+' : ''}
              {hedge.grossFundingAprPct.toFixed(1)}%
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {hedge.expectedFundingUsd >= 0 ? '+' : ''}${hedge.expectedFundingUsd.toFixed(2)} ({holdingDays}d)
            </div>
          </div>

          <div className="bg-[#090d14] border border-slate-800 rounded p-2.5">
            <div className="text-[10px] text-slate-500 font-sans uppercase">2-Leg Slippage + Fees</div>
            <div className="text-base font-bold text-amber-300 mt-1">
              -{hedge.totalExecutionCostBps.toFixed(1)} bps
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              -${hedge.totalExecutionCostUsd.toFixed(2)} (Spot {hedge.spotSlippageBps} / Perp {hedge.perpSlippageBps})
            </div>
          </div>

          <div className="bg-[#090d14] border border-slate-800 rounded p-2.5">
            <div className="text-[10px] text-slate-500 font-sans uppercase">Net Carry APR</div>
            <div
              className={`text-base font-bold mt-1 ${
                hedge.netAprPct >= 8
                  ? 'text-emerald-400'
                  : hedge.netAprPct > 0
                    ? 'text-amber-300'
                    : 'text-rose-400'
              }`}
            >
              {hedge.netAprPct >= 0 ? '+' : ''}
              {hedge.netAprPct.toFixed(2)}%
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Net PnL: {hedge.netPnlUsd >= 0 ? '+' : ''}${hedge.netPnlUsd.toFixed(2)}
            </div>
          </div>

          <div className="bg-[#090d14] border border-slate-800 rounded p-2.5">
            <div className="text-[10px] text-slate-500 font-sans uppercase">Breakeven Horizon</div>
            <div className="text-base font-bold text-cyan-300 mt-1">
              {hedge.breakevenHours === null
                ? 'Never'
                : hedge.breakevenHours === 0
                  ? 'Instant'
                  : hedge.breakevenHours >= 48
                    ? `${(hedge.breakevenHours / 24).toFixed(1)}d`
                    : `${hedge.breakevenHours.toFixed(1)}h`}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Basis edge: {hedge.basisEdgeBps >= 0 ? '+' : ''}
              {hedge.basisEdgeBps.toFixed(1)} bps
            </div>
          </div>

          {/* Bottom strip: 2-leg execution summary + Copy Atomic Plan */}
          <div className="col-span-2 sm:col-span-4 bg-[#090d14] border border-slate-800 rounded p-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-2 font-sans">
              {hedge.verdict === 'POSITIVE_EDGE' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              )}
              <span className="text-slate-300">
                <b className="text-indigo-300">Leg 1:</b> {hedge.spotLegSide} {market.spotSymbol ?? `${market.baseCoin} Spot`} @ ${hedge.atomicPlan.legs[0].estVwap}
                {' · '}
                <b className="text-cyan-300">Leg 2:</b> {hedge.perpLegSide} {market.symbol} @ ${hedge.atomicPlan.legs[1].estVwap}
              </span>
            </div>

            <button
              onClick={handleCopyPlan}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-600/80 hover:bg-indigo-500 text-white text-[11px] font-sans font-medium transition"
            >
              <Layers className="w-3 h-3" />
              <Copy className="w-3 h-3" />
              {copiedPlan ? 'Copied 2-Leg Plan!' : 'Copy Atomic Hedge JSON'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
