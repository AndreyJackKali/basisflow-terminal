import React, { useEffect, useMemo, useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Copy,
  ExternalLink,
  Power,
  Trash2,
} from 'lucide-react';
import type { EnrichedMarket, KlineBar, NetworkMode, OrderbookData, PaperTrade, SoSoValueState } from '../types';
import {
  buildCounterfactualCurves,
  evaluatePreTradeRisk,
  simulateOrderbookSlippage,
} from '../lib/quant';
import { NETWORK_CONFIG } from '../lib/api';
import { CounterfactualChart } from './Charts';
import { CarryStressCalculatorCard } from './CarryStressCalculatorCard';
import { DeltaNeutralHedgeCard } from './DeltaNeutralHedgeCard';
import { MonteCarloStressCard } from './MonteCarloStressCard';
import { SoloDeskBusinessCard } from './SoloDeskBusinessCard';

interface Props {
  network: NetworkMode;
  markets: EnrichedMarket[];
  selectedMarket: EnrichedMarket | null;
  onChangeSymbol: (symbol: string) => void;
  orderbook: OrderbookData | null;
  spotOrderbook: OrderbookData | null;
  klines: KlineBar[];
  sosoState: SoSoValueState;
  killSwitch: boolean;
  onToggleKillSwitch: () => void;
  paperTrades: PaperTrade[];
  onExecutePaperTrade: (trade: PaperTrade) => void;
  onClosePaperTrade: (id: string, exitPrice: number) => void;
  onClearPaperTrades: () => void;
}

export const ExecutionTab: React.FC<Props> = ({
  network,
  markets,
  selectedMarket,
  onChangeSymbol,
  orderbook,
  spotOrderbook,
  klines,
  sosoState,
  killSwitch,
  onToggleKillSwitch,
  paperTrades,
  onExecutePaperTrade,
  onClosePaperTrade,
  onClearPaperTrades,
}) => {
  const [side, setSide] = useState<'LONG' | 'SHORT'>('SHORT');
  const [equity, setEquity] = useState(10_000);
  const [riskPct, setRiskPct] = useState(1.0);
  const [leverage, setLeverage] = useState(3);
  const [stopPct, setStopPct] = useState(2.5);
  const [tpPct, setTpPct] = useState(5.0);
  const [maxSlippageBps, setMaxSlippageBps] = useState(35);
  const [copied, setCopied] = useState(false);

  // Sync default side to quant conviction when market changes
  useEffect(() => {
    if (!selectedMarket) return;
    if (selectedMarket.conviction.direction === 'CARRY LONG') setSide('LONG');
    else setSide('SHORT');
    setLeverage((prev) => Math.min(prev, selectedMarket.contract.maxLeverage || 10));
  }, [selectedMarket?.symbol]);

  const entryPrice = selectedMarket?.markPrice ?? 0;
  const stopLossPrice =
    side === 'LONG' ? entryPrice * (1 - stopPct / 100) : entryPrice * (1 + stopPct / 100);
  const takeProfitPrice =
    side === 'LONG' ? entryPrice * (1 + tpPct / 100) : entryPrice * (1 - tpPct / 100);

  const openExposureUsd = useMemo(
    () => paperTrades.filter((t) => t.status === 'OPEN').reduce((a, t) => a + t.notionalUsd, 0),
    [paperTrades],
  );

  const realizedDailyLossUsd = useMemo(() => {
    const net = paperTrades
      .filter((t) => t.status === 'CLOSED')
      .reduce((a, t) => a + (t.realizedPnlUsd ?? 0), 0);
    return net < 0 ? Math.abs(net) : 0;
  }, [paperTrades]);

  const estNotionalForSlip = useMemo(() => {
    if (stopPct <= 0) return 1000;
    return Math.min(equity * leverage, (equity * (riskPct / 100)) / (stopPct / 100));
  }, [equity, leverage, riskPct, stopPct]);

  const liveSlippageBps = useMemo(() => {
    if (!orderbook || !selectedMarket) return selectedMarket?.spreadBps ?? 5;
    const levels = side === 'LONG' ? orderbook.asks : orderbook.bids;
    return simulateOrderbookSlippage(levels, side === 'LONG' ? 'BUY' : 'SELL', estNotionalForSlip, entryPrice)
      .slippageBps;
  }, [orderbook, selectedMarket, side, estNotionalForSlip, entryPrice]);

  const evaluation = useMemo(() => {
    if (!selectedMarket || entryPrice <= 0) return null;
    return evaluatePreTradeRisk({
      market: selectedMarket,
      side,
      accountEquityUsd: equity,
      riskPctPerTrade: riskPct,
      leverage,
      entryPrice,
      stopLossPrice,
      takeProfitPrice,
      estimatedSlippageBps: liveSlippageBps,
      killSwitchActive: killSwitch,
      existingExposureUsd: openExposureUsd,
      realizedDailyLossUsd,
      maxDailyDrawdownPct: 5,
      maxSlippageBps,
    });
  }, [
    selectedMarket,
    side,
    equity,
    riskPct,
    leverage,
    entryPrice,
    stopLossPrice,
    takeProfitPrice,
    liveSlippageBps,
    killSwitch,
    openExposureUsd,
    realizedDailyLossUsd,
    maxSlippageBps,
  ]);

  const counterfactualPts = useMemo(
    () => buildCounterfactualCurves(paperTrades, equity),
    [paperTrades, equity],
  );

  const priceBySymbol = useMemo(
    () => new Map(markets.map((m) => [m.symbol, m.markPrice])),
    [markets],
  );

  const handlePaperExecute = () => {
    if (!evaluation || !evaluation.approved || !selectedMarket) return;
    const trade: PaperTrade = {
      id: `BF-${Date.now().toString(36).toUpperCase()}`,
      createdAt: Date.now(),
      network,
      symbol: selectedMarket.symbol,
      side,
      entryPrice,
      stopLoss: stopLossPrice,
      takeProfit: takeProfitPrice,
      qty: evaluation.positionQty,
      notionalUsd: evaluation.positionNotionalUsd,
      leverage,
      riskUsd: evaluation.riskUsd,
      entrySlippageBps: liveSlippageBps,
      convictionScore: selectedMarket.conviction.score,
      status: 'OPEN',
      riskGatePassed: true,
    };
    onExecutePaperTrade(trade);
  };

  const handleCopyPayload = () => {
    if (!evaluation) return;
    navigator.clipboard?.writeText(JSON.stringify(evaluation.orderPayload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const pxPrec = Math.min(4, selectedMarket?.contract.pricePrecision ?? 2);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: Risk Sizing Inputs */}
        <div className="lg:col-span-4 bg-[#0e1522] border border-slate-800/90 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-100">Pre-Trade Ticket Builder</h3>
            <button
              onClick={onToggleKillSwitch}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold border transition ${
                killSwitch
                  ? 'bg-rose-600 text-white border-rose-400'
                  : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-rose-500/60'
              }`}
            >
              <Power className="w-3 h-3" />
              {killSwitch ? 'KILL SWITCH ON' : 'Kill Switch: Armed'}
            </button>
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">SoDEX Perp Contract</label>
            <select
              value={selectedMarket?.symbol ?? ''}
              onChange={(e) => onChangeSymbol(e.target.value)}
              className="w-full bg-[#090d14] border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-100"
            >
              {markets.map((m) => (
                <option key={m.symbol} value={m.symbol}>
                  {m.symbol} (${m.markPrice.toFixed(Math.min(4, m.contract.pricePrecision))} · Max {m.contract.maxLeverage}x)
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {(['LONG', 'SHORT'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSide(s)}
                className={`py-1.5 rounded text-xs font-bold border transition ${
                  side === s
                    ? s === 'LONG'
                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                      : 'bg-rose-500/20 border-rose-500 text-rose-300'
                    : 'bg-[#090d14] border-slate-800 text-slate-400'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs">
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Account Equity ($)</label>
              <input
                type="number"
                min={100}
                step={500}
                value={equity}
                onChange={(e) => setEquity(Math.max(100, Number(e.target.value) || 0))}
                className="w-full bg-[#090d14] border border-slate-700 rounded px-2.5 py-1.5 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Risk / Trade (%)</label>
              <input
                type="number"
                min={0.1}
                max={10}
                step={0.25}
                value={riskPct}
                onChange={(e) => setRiskPct(Math.max(0.1, Number(e.target.value) || 0.1))}
                className="w-full bg-[#090d14] border border-slate-700 rounded px-2.5 py-1.5 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">
                Leverage (Max {selectedMarket?.contract.maxLeverage ?? 10}x)
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={leverage}
                onChange={(e) => setLeverage(Math.max(1, Number(e.target.value) || 1))}
                className="w-full bg-[#090d14] border border-slate-700 rounded px-2.5 py-1.5 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Max Slippage Gate (bps)</label>
              <input
                type="number"
                min={5}
                max={200}
                value={maxSlippageBps}
                onChange={(e) => setMaxSlippageBps(Math.max(5, Number(e.target.value) || 35))}
                className="w-full bg-[#090d14] border border-slate-700 rounded px-2.5 py-1.5 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Stop-Loss Distance (%)</label>
              <input
                type="number"
                min={0.2}
                max={40}
                step={0.25}
                value={stopPct}
                onChange={(e) => setStopPct(Math.max(0.2, Number(e.target.value) || 1))}
                className="w-full bg-[#090d14] border border-slate-700 rounded px-2.5 py-1.5 font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Take-Profit Distance (%)</label>
              <input
                type="number"
                min={0.5}
                max={100}
                step={0.5}
                value={tpPct}
                onChange={(e) => setTpPct(Math.max(0.5, Number(e.target.value) || 2))}
                className="w-full bg-[#090d14] border border-slate-700 rounded px-2.5 py-1.5 font-mono text-slate-100"
              />
            </div>
          </div>

          {evaluation && (
            <div className="bg-[#090d14] border border-slate-800 rounded p-3 space-y-1.5 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Position Size</span>
                <span className="text-slate-100 font-semibold">
                  ${evaluation.positionNotionalUsd.toLocaleString()} ({evaluation.positionQty} {selectedMarket?.baseCoin})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Required Margin</span>
                <span className="text-slate-200">${evaluation.requiredMarginUsd.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">SL / TP / Est. Liq</span>
                <span className="text-slate-200">
                  <span className="text-rose-400">${stopLossPrice.toFixed(pxPrec)}</span> /{' '}
                  <span className="text-emerald-400">${takeProfitPrice.toFixed(pxPrec)}</span> /{' '}
                  <span className="text-amber-300">${evaluation.liquidationPrice.toFixed(pxPrec)}</span>
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">R:R · Round-Trip Fee</span>
                <span className="text-slate-200">
                  {evaluation.riskRewardRatio.toFixed(2)}R · ${evaluation.estimatedTakerFeeUsd.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">24h Funding Carry Est.</span>
                <span className={evaluation.estimated24hFundingUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  {evaluation.estimated24hFundingUsd >= 0 ? '+' : ''}${evaluation.estimated24hFundingUsd.toFixed(2)}/day
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Middle: 6 Fail-Closed Risk Guardrails */}
        <div className="lg:col-span-4 bg-[#0e1522] border border-slate-800/90 rounded-lg p-4 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
                {evaluation?.approved ? (
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-rose-400" />
                )}
                Fail-Closed Pre-Trade Risk Gate
              </h3>
              <span
                className={`text-[11px] font-mono px-2 py-0.5 rounded font-bold ${
                  evaluation?.approved
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                }`}
              >
                {evaluation?.approved ? 'GATE PASS' : 'BLOCKED'}
              </span>
            </div>

            <div className="space-y-2">
              {evaluation?.checks.map((c) => (
                <div
                  key={c.id}
                  className={`p-2 rounded border text-xs ${
                    c.passed
                      ? 'bg-emerald-950/15 border-emerald-800/40'
                      : 'bg-rose-950/25 border-rose-700/60'
                  }`}
                >
                  <div className="flex items-center justify-between font-medium">
                    <span className={c.passed ? 'text-slate-200' : 'text-rose-200'}>{c.label}</span>
                    {c.passed ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{c.detail}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-2">
            <button
              onClick={handlePaperExecute}
              disabled={!evaluation?.approved}
              className={`w-full py-2 rounded text-xs font-bold transition ${
                evaluation?.approved
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'
              }`}
            >
              {evaluation?.approved
                ? `Execute Paper ${side} on ${selectedMarket?.symbol} (Risk $${evaluation.riskUsd})`
                : 'Execution Blocked by Pre-Trade Risk Gate'}
            </button>
            <a
              href={`${NETWORK_CONFIG[network].tradeBaseUrl}/${selectedMarket?.symbol ?? 'BTC-USD'}`}
              target="_blank"
              rel="noreferrer"
              className="w-full py-1.5 rounded text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center gap-1.5 transition"
            >
              Open {selectedMarket?.symbol} on SoDEX <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        {/* Right: Deterministic EIP-712 Payload Preview */}
        <div className="lg:col-span-4 bg-[#0e1522] border border-slate-800/90 rounded-lg p-4 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-slate-100">SoDEX EIP-712 Order Payload</h3>
            <button
              onClick={handleCopyPayload}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200"
            >
              <Copy className="w-3 h-3" />
              {copied ? 'Copied!' : 'Copy JSON'}
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mb-2">
            Non-custodial deterministic payload formatted for ValueChain SoDEX Perps execution. Sign with your own wallet — zero private keys ever touch BasisFlow.
          </p>
          <pre className="flex-1 bg-[#090d14] border border-slate-800 rounded p-2.5 text-[11px] font-mono text-cyan-300 overflow-auto max-h-72">
            {evaluation ? JSON.stringify(evaluation.orderPayload, null, 2) : '{}'}
          </pre>
        </div>
      </div>

      {/* v1.6.0 Institutional Carry-Trade & Liquidation Stress-Test Calculator */}
      <CarryStressCalculatorCard
        markets={markets}
        selectedMarket={selectedMarket}
        onChangeSymbol={onChangeSymbol}
        sosoState={sosoState}
      />

      {/* Multi-Leg Spot↔Perp Delta-Neutral Hedge & Net Carry Builder */}
      <DeltaNeutralHedgeCard
        market={selectedMarket}
        perpOrderbook={orderbook}
        spotOrderbook={spotOrderbook}
      />

      {/* Empirical Bootstrap Monte Carlo & Tail-Stress Risk Engine */}
      <MonteCarloStressCard
        market={selectedMarket}
        klines={klines}
        side={side}
        equity={equity}
        stopLossPrice={stopLossPrice}
        takeProfitPrice={takeProfitPrice}
        liveSlippageBps={liveSlippageBps}
        evaluation={evaluation}
      />

      {/* Paper Portfolio Ledger + Counterfactual Equity Curve */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 bg-[#0e1522] border border-slate-800/90 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-100">
              Live Mark-to-Market Paper Ledger ({paperTrades.length})
            </h3>
            {paperTrades.length > 0 && (
              <button
                onClick={onClearPaperTrades}
                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-rose-400"
              >
                <Trash2 className="w-3 h-3" /> Clear Ledger
              </button>
            )}
          </div>
          {paperTrades.length === 0 ? (
            <div className="text-xs text-slate-500 py-8 text-center border border-dashed border-slate-800 rounded">
              No paper trades recorded yet. Pass all 6 risk gates above and execute a paper trade to track live Mark-to-Market PnL against real SoDEX mark prices.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-[10px] uppercase text-slate-500 border-b border-slate-800">
                    <th className="py-1.5 text-left">Symbol / Side</th>
                    <th className="py-1.5 text-right">Entry</th>
                    <th className="py-1.5 text-right">Live Mark</th>
                    <th className="py-1.5 text-right">Notional</th>
                    <th className="py-1.5 text-right">MTM / Realized</th>
                    <th className="py-1.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {paperTrades.map((t) => {
                    const liveMark = priceBySymbol.get(t.symbol) ?? t.entryPrice;
                    const pnl =
                      t.status === 'CLOSED'
                        ? (t.realizedPnlUsd ?? 0)
                        : t.side === 'LONG'
                          ? (liveMark - t.entryPrice) * t.qty
                          : (t.entryPrice - liveMark) * t.qty;
                    return (
                      <tr key={t.id}>
                        <td className="py-2">
                          <span className="text-slate-100 font-semibold">{t.symbol}</span>{' '}
                          <span className={t.side === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}>
                            {t.side} {t.leverage}x
                          </span>
                        </td>
                        <td className="py-2 text-right text-slate-300">
                          ${t.entryPrice.toFixed(t.entryPrice < 1 ? 4 : 2)}
                        </td>
                        <td className="py-2 text-right text-slate-200">
                          ${(t.exitPrice ?? liveMark).toFixed((t.exitPrice ?? liveMark) < 1 ? 4 : 2)}
                        </td>
                        <td className="py-2 text-right text-slate-300">${t.notionalUsd.toFixed(0)}</td>
                        <td className={`py-2 text-right font-semibold ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                        </td>
                        <td className="py-2 text-right font-sans">
                          {t.status === 'OPEN' ? (
                            <button
                              onClick={() => onClosePaperTrade(t.id, liveMark)}
                              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200"
                            >
                              Close @ Mark
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-500">CLOSED</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="lg:col-span-5 bg-[#0e1522] border border-slate-800/90 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-100 mb-2">
            Counterfactual Risk-Gate Attribution
          </h3>
          <p className="text-[11px] text-slate-400 mb-3">
            Compares realized Risk-Gated equity against an ungated 2.5× oversized / high-slippage counterfactual on the exact same trade tape.
          </p>
          <CounterfactualChart points={counterfactualPts} />
        </div>
      </div>

      {/* v1.5.0 One-Person On-Chain Finance Business Desk */}
      <SoloDeskBusinessCard network={network} markets={markets} sosoState={sosoState} />
    </div>
  );
};
