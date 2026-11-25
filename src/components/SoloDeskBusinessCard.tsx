import React, { useMemo, useState } from 'react';
import { Briefcase, CheckCircle2, Copy, Download, Radio } from 'lucide-react';
import type { EnrichedMarket, NetworkMode, SoSoValueState } from '../types';
import { computeSoloDeskEconomics, generateOperatorSignalBrief } from '../lib/quant';

interface Props {
  network: NetworkMode;
  markets: EnrichedMarket[];
  sosoState: SoSoValueState;
}

export const SoloDeskBusinessCard: React.FC<Props> = ({ network, markets, sosoState }) => {
  const [managedAumUsd, setManagedAumUsd] = useState(250_000);
  const [capitalUtilizationPct, setCapitalUtilizationPct] = useState(80);
  const [managementFeePct, setManagementFeePct] = useState(1.0);
  const [performanceFeePct, setPerformanceFeePct] = useState(15);
  const [paidSubscribers, setPaidSubscribers] = useState(35);
  const [monthlySubPriceUsd, setMonthlySubPriceUsd] = useState(49);
  const [x402CallsPerDay, setX402CallsPerDay] = useState(400);
  const [x402PricePerCallUsd, setX402PricePerCallUsd] = useState(0.05);
  const [monthlyInfraCostUsd, setMonthlyInfraCostUsd] = useState(180);
  const [copiedMd, setCopiedMd] = useState(false);

  // Derive realistic live carry APR strictly from top 5 liquid SoDEX carry markets (absolute carry capture)
  const liveBasketCarryApr = useMemo(() => {
    const liquid = [...markets]
      .filter((m) => m.quoteVolume24h >= 100_000 && Number.isFinite(m.annualizedFundingApr))
      .sort((a, b) => Math.abs(b.annualizedFundingApr) - Math.abs(a.annualizedFundingApr))
      .slice(0, 5);
    if (liquid.length === 0) return 0;
    const avgAbs =
      liquid.reduce((acc, m) => acc + Math.min(80, Math.abs(m.annualizedFundingApr)), 0) /
      liquid.length;
    return Number(avgAbs.toFixed(2));
  }, [markets]);

  const econ = useMemo(
    () =>
      computeSoloDeskEconomics({
        managedAumUsd,
        capitalUtilizationPct,
        liveGrossCarryAprPct: liveBasketCarryApr,
        executionDragAprPct: 2.2, // conservative annualized 2-leg rebalance + taker fee drag
        managementFeePct,
        performanceFeePct,
        benchmarkAprPct: 4.5, // US T-Bill risk-free hurdle
        paidSubscribers,
        monthlySubPriceUsd,
        x402CallsPerDay,
        x402PricePerCallUsd,
        monthlyInfraCostUsd,
      }),
    [
      managedAumUsd,
      capitalUtilizationPct,
      liveBasketCarryApr,
      managementFeePct,
      performanceFeePct,
      paidSubscribers,
      monthlySubPriceUsd,
      x402CallsPerDay,
      x402PricePerCallUsd,
      monthlyInfraCostUsd,
    ],
  );

  const brief = useMemo(
    () => generateOperatorSignalBrief(markets, sosoState, network, 5),
    [markets, sosoState, network],
  );

  const handleCopyBrief = () => {
    navigator.clipboard?.writeText(brief.markdown);
    setCopiedMd(true);
    setTimeout(() => setCopiedMd(false), 1800);
  };

  const handleDownloadJson = () => {
    const payload = {
      schema: 'basisflow.x402.signal.v1',
      deskEconomics: econ,
      liveBasketCarryAprPct: liveBasketCarryApr,
      signalBrief: brief,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `basisflow-x402-signal-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tagStyle =
    econ.viabilityTag === 'PROFITABLE SOLO DESK'
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
      : econ.viabilityTag === 'SCALING STAGE'
        ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
        : 'bg-rose-500/20 text-rose-300 border-rose-500/50';

  return (
    <div className="bg-[#0e1522] border border-cyan-500/30 rounded-lg p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-cyan-400" />
            One-Person On-Chain Finance Business Desk (Carry Vault + USDC Signals + x402 API)
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Anchored live to top-5 liquid SoDEX markets ({liveBasketCarryApr.toFixed(1)}% gross carry APR, 2.2% rebalance drag, high-water-mark perf fee).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2.5 py-1 rounded border text-[11px] font-semibold ${tagStyle}`}>
            {econ.viabilityTag}
          </span>
          <button
            onClick={handleCopyBrief}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-200 text-xs font-medium"
          >
            {copiedMd ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedMd ? 'Copied Brief' : 'Copy Client Brief (MD)'}
          </button>
          <button
            onClick={handleDownloadJson}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium"
          >
            <Download className="w-3.5 h-3.5" />
            x402 JSON
          </button>
        </div>
      </div>

      {/* Business Inputs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-xs">
        <label className="bg-slate-900/70 border border-slate-800 rounded p-2">
          <span className="text-[10px] text-slate-400 block">Vault AUM ($)</span>
          <input
            type="number"
            min={0}
            step={25000}
            value={managedAumUsd}
            onChange={(e) => setManagedAumUsd(Number(e.target.value) || 0)}
            className="w-full mt-1 bg-transparent font-mono text-slate-100 focus:outline-none"
          />
        </label>
        <label className="bg-slate-900/70 border border-slate-800 rounded p-2">
          <span className="text-[10px] text-slate-400 block">Util. (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            value={capitalUtilizationPct}
            onChange={(e) => setCapitalUtilizationPct(Number(e.target.value) || 0)}
            className="w-full mt-1 bg-transparent font-mono text-slate-100 focus:outline-none"
          />
        </label>
        <label className="bg-slate-900/70 border border-slate-800 rounded p-2">
          <span className="text-[10px] text-slate-400 block">Mgmt Fee (%)</span>
          <input
            type="number"
            min={0}
            max={5}
            step={0.25}
            value={managementFeePct}
            onChange={(e) => setManagementFeePct(Number(e.target.value) || 0)}
            className="w-full mt-1 bg-transparent font-mono text-slate-100 focus:outline-none"
          />
        </label>
        <label className="bg-slate-900/70 border border-slate-800 rounded p-2">
          <span className="text-[10px] text-slate-400 block">Perf Fee (%)</span>
          <input
            type="number"
            min={0}
            max={35}
            step={1}
            value={performanceFeePct}
            onChange={(e) => setPerformanceFeePct(Number(e.target.value) || 0)}
            className="w-full mt-1 bg-transparent font-mono text-slate-100 focus:outline-none"
          />
        </label>
        <label className="bg-slate-900/70 border border-slate-800 rounded p-2">
          <span className="text-[10px] text-slate-400 block">Signal Subs</span>
          <input
            type="number"
            min={0}
            step={5}
            value={paidSubscribers}
            onChange={(e) => setPaidSubscribers(Number(e.target.value) || 0)}
            className="w-full mt-1 bg-transparent font-mono text-slate-100 focus:outline-none"
          />
        </label>
        <label className="bg-slate-900/70 border border-slate-800 rounded p-2">
          <span className="text-[10px] text-slate-400 block">Sub $/mo</span>
          <input
            type="number"
            min={0}
            step={10}
            value={monthlySubPriceUsd}
            onChange={(e) => setMonthlySubPriceUsd(Number(e.target.value) || 0)}
            className="w-full mt-1 bg-transparent font-mono text-slate-100 focus:outline-none"
          />
        </label>
        <label className="bg-slate-900/70 border border-slate-800 rounded p-2">
          <span className="text-[10px] text-slate-400 block">x402 Calls/d</span>
          <input
            type="number"
            min={0}
            step={50}
            value={x402CallsPerDay}
            onChange={(e) => setX402CallsPerDay(Number(e.target.value) || 0)}
            className="w-full mt-1 bg-transparent font-mono text-slate-100 focus:outline-none"
          />
        </label>
        <label className="bg-slate-900/70 border border-slate-800 rounded p-2">
          <span className="text-[10px] text-slate-400 block">Infra $/mo</span>
          <input
            type="number"
            min={0}
            step={20}
            value={monthlyInfraCostUsd}
            onChange={(e) => setMonthlyInfraCostUsd(Number(e.target.value) || 0)}
            className="w-full mt-1 bg-transparent font-mono text-slate-100 focus:outline-none"
          />
        </label>
      </div>

      {/* Live Unit Economics KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
        <div className="bg-slate-900/80 border border-slate-800 rounded p-2.5">
          <div className="text-[10px] uppercase text-slate-400">Net Operator MRR</div>
          <div className={`text-lg font-mono font-bold ${econ.totalNetMrrUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            ${econ.totalNetMrrUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo
          </div>
          <div className="text-[10px] text-slate-500 font-mono">
            ARR: ${econ.totalNetArrUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 rounded p-2.5">
          <div className="text-[10px] uppercase text-slate-400">Vault Fee Stream</div>
          <div className="text-lg font-mono font-bold text-cyan-300">
            ${econ.vaultFeeMrrUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo
          </div>
          <div className="text-[10px] text-slate-500 font-mono">
            Mgmt ${Math.round(econ.managementFeeAnnualUsd / 12)} + Perf ${Math.round(econ.performanceFeeAnnualUsd / 12)}
          </div>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 rounded p-2.5">
          <div className="text-[10px] uppercase text-slate-400">Subs + x402 API</div>
          <div className="text-lg font-mono font-bold text-indigo-300">
            ${(econ.subscriptionMrrUsd + econ.x402ApiMrrUsd).toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo
          </div>
          <div className="text-[10px] text-slate-500 font-mono">
            Subs ${econ.subscriptionMrrUsd.toFixed(0)} · x402 ${econ.x402ApiMrrUsd.toFixed(0)}
          </div>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 rounded p-2.5">
          <div className="text-[10px] uppercase text-slate-400">Client Net APR</div>
          <div className={`text-lg font-mono font-bold ${econ.clientNetAprPct >= 4.5 ? 'text-emerald-400' : 'text-amber-300'}`}>
            {econ.clientNetAprPct >= 0 ? '+' : ''}{econ.clientNetAprPct.toFixed(2)}%
          </div>
          <div className="text-[10px] text-slate-500 font-mono">
            {econ.alphaOverBenchmarkPct >= 0 ? '+' : ''}{econ.alphaOverBenchmarkPct.toFixed(2)}% vs 4.5% T-Bill
          </div>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 rounded p-2.5">
          <div className="text-[10px] uppercase text-slate-400">Live Signal Feed</div>
          <div className="text-sm font-mono font-semibold text-slate-100 flex items-center gap-1 mt-1">
            <Radio className="w-3.5 h-3.5 text-emerald-400" />
            {brief.topCarrySignals.length} Top Signals
          </div>
          <div className="text-[10px] text-slate-500 font-mono flex items-center gap-1 mt-0.5">
            <span>Breakeven: {econ.breakevenSubscribers} subs ·</span>
            {[0.02, 0.05, 0.1].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setX402PricePerCallUsd(p)}
                className={`px-1 rounded ${x402PricePerCallUsd === p ? 'bg-cyan-500/25 text-cyan-200' : 'text-slate-400 hover:text-slate-200'}`}
              >
                ${p.toFixed(2)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Live Preview of Top Signals Included in Client Brief */}
      <div className="bg-slate-950/60 border border-slate-800/80 rounded p-2.5 text-[11px] font-mono text-slate-300 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-slate-500 uppercase text-[10px]">Ready-to-Publish Brief Leaders:</span>
        {brief.topCarrySignals.slice(0, 4).map((sig) => (
          <span key={sig.symbol} className="inline-flex items-center gap-1">
            <strong className="text-slate-100">{sig.symbol}</strong>
            <span className={sig.annualizedFundingApr >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {sig.annualizedFundingApr >= 0 ? '+' : ''}{sig.annualizedFundingApr.toFixed(1)}%
            </span>
            <span className="text-slate-500">({sig.convictionScore}/100)</span>
          </span>
        ))}
      </div>
    </div>
  );
};
