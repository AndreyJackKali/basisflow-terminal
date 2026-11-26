import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Copy,
  Download,
  FileSpreadsheet,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { CarryStrategySide, EnrichedMarket, SoSoValueState } from '../types';
import { computeCarryStressScenario, serializeCarryTicketCsv } from '../lib/quant';

interface Props {
  markets: EnrichedMarket[];
  selectedMarket: EnrichedMarket | null;
  onChangeSymbol: (symbol: string) => void;
  sosoState: SoSoValueState;
}

const ETF_QUICK_SYMBOLS = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD'] as const;

function fmtUsd(v: number, signed = false): string {
  const sign = signed ? (v > 0 ? '+' : v < 0 ? '-' : '') : v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `${sign}$${abs.toFixed(2)}`;
}

export const CarryStressCalculatorCard: React.FC<Props> = ({
  markets,
  selectedMarket,
  onChangeSymbol,
  sosoState,
}) => {
  const [notionalUsd, setNotionalUsd] = useState(50_000);
  const [leverage, setLeverage] = useState(3);
  const [holdingDays, setHoldingDays] = useState(30);
  const [feeSlippageBps, setFeeSlippageBps] = useState(12);
  const [borrowCostAprPct, setBorrowCostAprPct] = useState(4.5);
  const [fundingDecayPct, setFundingDecayPct] = useState(25);
  const [side, setSide] = useState<CarryStrategySide>('SHORT_PERP');
  const [copiedTicket, setCopiedTicket] = useState(false);

  // Sync default carry direction & round-trip fee+spread estimate when asset changes
  useEffect(() => {
    if (!selectedMarket) return;
    setSide(selectedMarket.annualizedFundingApr >= 0 ? 'SHORT_PERP' : 'LONG_PERP');
    const takerBps = Number(selectedMarket.contract.takerFee || 0.0004) * 10_000 * 2;
    const estCostBps = Math.max(4, Math.min(80, Math.round((takerBps + selectedMarket.spreadBps) * 10) / 10));
    setFeeSlippageBps(estCostBps);
    setLeverage((prev) => Math.min(prev, Math.max(1, selectedMarket.contract.maxLeverage || 10)));
  }, [selectedMarket?.symbol]);

  const result = useMemo(() => {
    if (!selectedMarket) return null;
    return computeCarryStressScenario({
      market: selectedMarket,
      notionalUsd,
      leverage,
      holdingDays,
      feeSlippageBps,
      borrowCostAprPct,
      fundingDecayPct,
      side,
      etfFlows: sosoState.etfFlows,
    });
  }, [
    selectedMarket,
    notionalUsd,
    leverage,
    holdingDays,
    feeSlippageBps,
    borrowCostAprPct,
    fundingDecayPct,
    side,
    sosoState.etfFlows,
  ]);

  if (!selectedMarket || !result) return null;

  const pxPrec = Math.min(4, selectedMarket.contract.pricePrecision ?? 2);

  const verdictBadge =
    result.verdict === 'INSTITUTIONAL_GRADE'
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
      : result.verdict === 'CONDITIONAL_CARRY'
        ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
        : 'bg-rose-500/20 text-rose-300 border-rose-500/50';

  const liqTierColor =
    result.liquidationRiskTier === 'LOW'
      ? 'text-emerald-400'
      : result.liquidationRiskTier === 'MODERATE'
        ? 'text-cyan-300'
        : result.liquidationRiskTier === 'HIGH'
          ? 'text-amber-300'
          : 'text-rose-400';

  const etfBadgeClass =
    result.etfConfirmation.signal === 'CONFIRMED'
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
      : result.etfConfirmation.signal === 'DIVERGENT'
        ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
        : result.etfConfirmation.signal === 'CAUTIOUS'
          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
          : 'bg-slate-800 text-slate-400 border-slate-700';

  const handleCopyTicket = () => {
    navigator.clipboard?.writeText(JSON.stringify(result.ticket, null, 2));
    setCopiedTicket(true);
    setTimeout(() => setCopiedTicket(false), 1800);
  };

  const handleDownloadJson = () => {
    const payload = {
      ...result.ticket,
      sensitivity: result.sensitivity,
      etfConfirmation: result.etfConfirmation,
      soSoSnapshotFetchedAt: sosoState.snapshotFetchedAt,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `basisflow-carry-ticket-${result.symbol.toLowerCase()}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadCsv = () => {
    const csv = serializeCarryTicketCsv(result);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `basisflow-carry-stress-${result.symbol.toLowerCase()}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section
      id="carry-stress-calculator"
      className="bg-[#0e1522] border border-cyan-500/35 rounded-lg p-4 space-y-4 scroll-mt-24"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Calculator className="w-4 h-4 text-cyan-400" />
              Institutional Carry-Trade &amp; Liquidation Stress-Test Calculator
            </h3>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/35">
              v1.6.0 · Live SoSoValue ETF + SoDEX Math
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Sizes collateral, leverage, funding decay, borrow drag, liquidation buffer, and funding-flip drawdown sensitivity against live SoDEX contracts and SoSoValue US Spot ETF flows.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[11px] font-mono px-2.5 py-0.5 rounded font-bold border ${verdictBadge}`}>
            {result.verdict.replace(/_/g, ' ')}
          </span>
          <button
            onClick={handleDownloadJson}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-cyan-600/85 hover:bg-cyan-500 text-white text-[11px] font-medium transition"
            title="Download reproducible Trade Ticket & Stress Audit JSON"
          >
            <Download className="w-3 h-3" />
            Ticket JSON
          </button>
          <button
            onClick={handleDownloadCsv}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-medium transition"
            title="Download Funding-Flip Stress Report CSV"
          >
            <FileSpreadsheet className="w-3 h-3 text-emerald-400" />
            Stress CSV
          </button>
          <button
            onClick={handleCopyTicket}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[11px] transition"
          >
            <Copy className="w-3 h-3" />
            {copiedTicket ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Asset selector strip + Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5 space-y-3 text-xs bg-[#090d14] border border-slate-800/90 rounded-lg p-3">
          {/* Quick ETF-tracked assets + full dropdown */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-slate-400">Tracked Asset (ETF-Linked &amp; All SoDEX)</span>
              <span className="text-[10px] font-mono text-slate-500">
                Mark ${selectedMarket.markPrice.toFixed(pxPrec)} · Funding{' '}
                <span className={selectedMarket.annualizedFundingApr >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  {selectedMarket.annualizedFundingApr >= 0 ? '+' : ''}
                  {selectedMarket.annualizedFundingApr.toFixed(1)}% APR
                </span>
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {ETF_QUICK_SYMBOLS.map((sym) => {
                const exists = markets.some((m) => m.symbol === sym);
                if (!exists) return null;
                return (
                  <button
                    key={sym}
                    onClick={() => onChangeSymbol(sym)}
                    className={`px-2 py-0.5 rounded text-[11px] font-mono border transition ${
                      selectedMarket.symbol === sym
                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-bold'
                        : 'bg-[#0e1522] border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {sym.replace('-USD', '')} ETF
                  </button>
                );
              })}
            </div>
            <select
              aria-label="Carry Stress Asset"
              value={selectedMarket.symbol}
              onChange={(e) => onChangeSymbol(e.target.value)}
              className="w-full bg-[#0e1522] border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-100"
            >
              {markets.map((m) => (
                <option key={m.symbol} value={m.symbol}>
                  {m.symbol} · {m.annualizedFundingApr >= 0 ? '+' : ''}
                  {m.annualizedFundingApr.toFixed(1)}% APR · Max {m.contract.maxLeverage}x
                </option>
              ))}
            </select>
          </div>

          {/* Carry Direction */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => setSide('SHORT_PERP')}
              className={`py-1.5 px-2 rounded border text-[11px] font-semibold flex items-center justify-center gap-1 transition ${
                side === 'SHORT_PERP'
                  ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                  : 'bg-[#0e1522] border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <TrendingDown className="w-3.5 h-3.5" />
              Short Perp Carry
            </button>
            <button
              onClick={() => setSide('LONG_PERP')}
              className={`py-1.5 px-2 rounded border text-[11px] font-semibold flex items-center justify-center gap-1 transition ${
                side === 'LONG_PERP'
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                  : 'bg-[#0e1522] border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              Long Perp Reverse
            </button>
          </div>

          {/* Parameter Grid */}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Notional Size ($)</label>
              <div className="grid grid-cols-3 gap-1 mb-1">
                {[10_000, 50_000, 250_000].map((v) => (
                  <button
                    key={v}
                    onClick={() => setNotionalUsd(v)}
                    className={`py-0.5 rounded text-[10px] font-mono border ${
                      notionalUsd === v
                        ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
                        : 'bg-[#0e1522] border-slate-800 text-slate-400'
                    }`}
                  >
                    ${v / 1000}k
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={100}
                step={5000}
                value={notionalUsd}
                onChange={(e) => setNotionalUsd(Math.max(100, Number(e.target.value) || 0))}
                className="w-full bg-[#0e1522] border border-slate-700 rounded px-2 py-1 font-mono text-slate-100"
              />
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">
                Leverage (Max {result.effectiveMaxLeverage}x)
              </label>
              <div className="grid grid-cols-4 gap-1 mb-1">
                {[1, 3, 5, 10].map((lev) => (
                  <button
                    key={lev}
                    onClick={() => setLeverage(lev)}
                    className={`py-0.5 rounded text-[10px] font-mono border ${
                      leverage === lev
                        ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
                        : 'bg-[#0e1522] border-slate-800 text-slate-400'
                    }`}
                  >
                    {lev}x
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={1}
                max={50}
                step={1}
                value={leverage}
                onChange={(e) => setLeverage(Math.max(1, Number(e.target.value) || 1))}
                className="w-full bg-[#0e1522] border border-slate-700 rounded px-2 py-1 font-mono text-slate-100"
              />
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Holding Horizon (Days)</label>
              <div className="grid grid-cols-3 gap-1 mb-1">
                {[7, 30, 90].map((d) => (
                  <button
                    key={d}
                    onClick={() => setHoldingDays(d)}
                    className={`py-0.5 rounded text-[10px] font-mono border ${
                      holdingDays === d
                        ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
                        : 'bg-[#0e1522] border-slate-800 text-slate-400'
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
                onChange={(e) => setHoldingDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
                className="w-full bg-[#0e1522] border border-slate-700 rounded px-2 py-1 font-mono text-slate-100"
              />
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Funding Decay (%)</label>
              <div className="grid grid-cols-3 gap-1 mb-1">
                {[0, 25, 50].map((dec) => (
                  <button
                    key={dec}
                    onClick={() => setFundingDecayPct(dec)}
                    className={`py-0.5 rounded text-[10px] font-mono border ${
                      fundingDecayPct === dec
                        ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
                        : 'bg-[#0e1522] border-slate-800 text-slate-400'
                    }`}
                  >
                    {dec}%
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                value={fundingDecayPct}
                onChange={(e) => setFundingDecayPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                className="w-full bg-[#0e1522] border border-slate-700 rounded px-2 py-1 font-mono text-slate-100"
              />
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Round-Trip Fee + Slip (bps)</label>
              <input
                type="number"
                min={0}
                max={250}
                step={1}
                value={feeSlippageBps}
                onChange={(e) => setFeeSlippageBps(Math.max(0, Number(e.target.value) || 0))}
                className="w-full bg-[#0e1522] border border-slate-700 rounded px-2 py-1 font-mono text-slate-100"
              />
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Borrow / Financing Drag (APR %)</label>
              <input
                type="number"
                min={0}
                max={50}
                step={0.5}
                value={borrowCostAprPct}
                onChange={(e) => setBorrowCostAprPct(Math.max(0, Number(e.target.value) || 0))}
                className="w-full bg-[#0e1522] border border-slate-700 rounded px-2 py-1 font-mono text-slate-100"
              />
            </div>
          </div>
        </div>

        {/* Right: Institutional KPI Cards + ETF Signal + Sensitivity Table */}
        <div className="lg:col-span-7 space-y-3">
          {/* 4-Card KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono">
            <div className="bg-[#090d14] border border-slate-800 rounded p-2.5">
              <div className="text-[10px] text-slate-500 font-sans uppercase">Net Carry APY</div>
              <div
                className={`text-base font-bold mt-1 ${
                  result.netApyOnNotionalPct >= 5
                    ? 'text-emerald-400'
                    : result.netApyOnNotionalPct > 0
                      ? 'text-amber-300'
                      : 'text-rose-400'
                }`}
              >
                {result.netApyOnNotionalPct >= 0 ? '+' : ''}
                {result.netApyOnNotionalPct.toFixed(2)}%
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                ROE {result.netRoeAnnualizedPct >= 0 ? '+' : ''}
                {result.netRoeAnnualizedPct.toFixed(1)}% · {fmtUsd(result.netCarryUsd, true)}
              </div>
            </div>

            <div className="bg-[#090d14] border border-slate-800 rounded p-2.5">
              <div className="text-[10px] text-slate-500 font-sans uppercase">Break-Even Days</div>
              <div className="text-base font-bold text-cyan-300 mt-1">
                {result.breakEvenDays === null
                  ? 'Never'
                  : result.breakEvenDays === 0
                    ? 'Instant'
                    : `${result.breakEvenDays}d`}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Cost -{fmtUsd(result.executionCostUsd)} · {fmtUsd(result.dailyNetCarryUsd, true)}/d
              </div>
            </div>

            <div className="bg-[#090d14] border border-slate-800 rounded p-2.5">
              <div className="text-[10px] text-slate-500 font-sans uppercase">Liq Price &amp; Buffer</div>
              <div className={`text-base font-bold mt-1 ${liqTierColor}`}>
                {result.liquidationBufferPct.toFixed(1)}% buf
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Liq ${result.liquidationPrice.toFixed(pxPrec)} · {result.liquidationRiskTier}
              </div>
            </div>

            <div className="bg-[#090d14] border border-slate-800 rounded p-2.5">
              <div className="text-[10px] text-slate-500 font-sans uppercase">Collateral Req.</div>
              <div className="text-base font-bold text-slate-100 mt-1">
                {fmtUsd(result.collateralUsd)}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                MMR {(result.maintenanceMarginRate * 100).toFixed(2)}% · Flip {fmtUsd(result.fundingFlipDrawdown1xUsd, true)}
              </div>
            </div>
          </div>

          {/* Live SoSoValue ETF Confirmation Banner */}
          <div className="bg-[#090d14] border border-slate-800 rounded-lg p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-start gap-2 min-w-0 flex-1">
              {result.etfConfirmation.signal === 'CONFIRMED' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : result.etfConfirmation.signal === 'DIVERGENT' ? (
                <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-slate-200">SoSoValue ETF-Flow Confirmation</span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${etfBadgeClass}`}>
                    {result.etfConfirmation.signal.replace(/_/g, ' ')}
                  </span>
                  {result.etfConfirmation.latestDate && (
                    <span className="text-[10px] font-mono text-slate-500">
                      as of {result.etfConfirmation.latestDate}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                  {result.etfConfirmation.explanation}
                </p>
              </div>
            </div>
          </div>

          {/* Funding-Flip Drawdown Sensitivity Matrix */}
          <div className="bg-[#090d14] border border-slate-800 rounded-lg overflow-x-auto">
            <table className="w-full text-xs font-mono border-collapse">
              <thead>
                <tr className="text-[10px] uppercase text-slate-500 border-b border-slate-800 bg-[#0b101b]">
                  <th className="py-1.5 px-2.5 text-left font-sans">Funding-Flip Stress Scenario ({holdingDays}d)</th>
                  <th className="py-1.5 px-2 text-right">Eff. APR</th>
                  <th className="py-1.5 px-2 text-right">Horizon PnL</th>
                  <th className="py-1.5 px-2 text-right">Collateral ROE</th>
                  <th className="py-1.5 px-2.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {result.sensitivity.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-800/30">
                    <td className="py-1.5 px-2.5 font-sans text-slate-300">{row.label}</td>
                    <td
                      className={`py-1.5 px-2 text-right ${
                        row.effectiveFundingAprPct > 0
                          ? 'text-emerald-400'
                          : row.effectiveFundingAprPct < 0
                            ? 'text-rose-400'
                            : 'text-slate-400'
                      }`}
                    >
                      {row.effectiveFundingAprPct >= 0 ? '+' : ''}
                      {row.effectiveFundingAprPct.toFixed(1)}%
                    </td>
                    <td
                      className={`py-1.5 px-2 text-right font-semibold ${
                        row.horizonPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {fmtUsd(row.horizonPnlUsd, true)}
                    </td>
                    <td
                      className={`py-1.5 px-2 text-right ${
                        row.roePct >= 0 ? 'text-slate-200' : 'text-rose-300'
                      }`}
                    >
                      {row.roePct >= 0 ? '+' : ''}
                      {row.roePct.toFixed(2)}%
                    </td>
                    <td className="py-1.5 px-2.5 text-right font-sans">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border ${
                          row.status === 'PROFITABLE'
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                            : row.status === 'MARGINAL'
                              ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                              : 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Quality Warnings (if any) */}
          {result.qualityWarnings.length > 0 && (
            <div className="bg-amber-950/25 border border-amber-500/40 rounded-lg p-2.5 space-y-1">
              <div className="text-[11px] font-semibold text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Active Institutional Risk &amp; Data-Quality Guardrails ({result.qualityWarnings.length})
              </div>
              <ul className="space-y-0.5 text-[11px] text-amber-200/90 font-mono">
                {result.qualityWarnings.map((w, idx) => (
                  <li key={idx}>• {w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
