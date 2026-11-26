import React, { useMemo, useState } from 'react';
import { ArrowUpDown, Download, Search, TrendingUp, Layers, ShieldCheck, Activity } from 'lucide-react';
import type { EnrichedMarket } from '../types';
import { serializeMarketsToCsv, THIN_BOOK_USD, THIN_BOOK_LABEL } from '../lib/quant';

interface Props {
  markets: EnrichedMarket[];
  selectedSymbol: string;
  onSelectForMicrostructure: (symbol: string) => void;
  onSelectForExecution: (symbol: string) => void;
  etfFlowZScore: number;
}

type FilterKey = 'ALL' | 'SPOT_PERP' | 'CRYPTO' | 'EQUITY' | 'COMMODITY' | 'HIGH_CARRY';
type SortKey = 'conviction' | 'fundingApr' | 'spotPerp' | 'volume' | 'oi' | 'spread';

function fmtUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

export const ScannerTab: React.FC<Props> = ({
  markets,
  selectedSymbol,
  onSelectForMicrostructure,
  onSelectForExecution,
  etfFlowZScore,
}) => {
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('conviction');
  const [sortAsc, setSortAsc] = useState(false);

  const stats = useMemo(() => {
    const overlapCount = markets.filter((m) => m.spotPerpSpreadBps !== null).length;
    const totalVol = markets.reduce((a, m) => a + m.quoteVolume24h, 0);
    const totalOi = markets.reduce((a, m) => a + m.openInterestUsd, 0);
    // Headline carry only from markets with executable size (>= THIN_BOOK_USD 24h volume)
    const tradable = markets.filter((m) => m.quoteVolume24h >= THIN_BOOK_USD);
    const topCarry = [...(tradable.length ? tradable : markets)].sort(
      (a, b) => Math.abs(b.annualizedFundingApr) - Math.abs(a.annualizedFundingApr),
    )[0];
    return { overlapCount, totalVol, totalOi, topCarry };
  }, [markets]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    return markets
      .filter((m) => {
        if (q && !m.symbol.toUpperCase().includes(q) && !m.baseCoin.toUpperCase().includes(q)) {
          return false;
        }
        if (filter === 'SPOT_PERP') return m.spotPerpSpreadBps !== null;
        if (filter === 'CRYPTO') return m.assetClass === 'Crypto';
        if (filter === 'EQUITY') return m.assetClass === 'Tokenized Equity';
        if (filter === 'COMMODITY') return m.assetClass === 'Commodity';
        if (filter === 'HIGH_CARRY') return Math.abs(m.annualizedFundingApr) >= 15;
        return true;
      })
      .sort((a, b) => {
        let va = 0;
        let vb = 0;
        if (sortBy === 'conviction') {
          va = a.conviction.score;
          vb = b.conviction.score;
        } else if (sortBy === 'fundingApr') {
          va = Math.abs(a.annualizedFundingApr);
          vb = Math.abs(b.annualizedFundingApr);
        } else if (sortBy === 'spotPerp') {
          va = Math.abs(a.spotPerpSpreadBps ?? -1);
          vb = Math.abs(b.spotPerpSpreadBps ?? -1);
        } else if (sortBy === 'volume') {
          va = a.quoteVolume24h;
          vb = b.quoteVolume24h;
        } else if (sortBy === 'oi') {
          va = a.openInterestUsd;
          vb = b.openInterestUsd;
        } else {
          va = a.spreadBps || 9999;
          vb = b.spreadBps || 9999;
        }
        return sortAsc ? va - vb : vb - va;
      });
  }, [markets, filter, search, sortBy, sortAsc]);

  const toggleSort = (k: SortKey) => {
    if (sortBy === k) setSortAsc(!sortAsc);
    else {
      setSortBy(k);
      setSortAsc(k === 'spread');
    }
  };

  return (
    <div className="space-y-4">
      {/* KPI summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[#0e1522] border border-slate-800/90 rounded-lg p-3.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Live SoDEX Markets</span>
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-mono font-bold text-slate-100 mt-1">
            {markets.length} Perps
          </div>
          <div className="text-[11px] text-emerald-400 mt-0.5">
            {stats.overlapCount} Spot↔Perp Basis Pairs Joined
          </div>
        </div>

        <div className="bg-[#0e1522] border border-slate-800/90 rounded-lg p-3.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>24h Perp Volume / OI</span>
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="text-xl font-mono font-bold text-slate-100 mt-1">
            {fmtUsd(stats.totalVol)}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            Live Open Interest: <span className="text-slate-200">{fmtUsd(stats.totalOi)}</span>
          </div>
        </div>

        <div className="bg-[#0e1522] border border-slate-800/90 rounded-lg p-3.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span title={`Largest |funding APR| among markets with >= ${THIN_BOOK_LABEL} 24h volume`}>Peak Tradable Carry</span>
            <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-xl font-mono font-bold text-amber-300 mt-1">
            {stats.topCarry
              ? `${stats.topCarry.annualizedFundingApr >= 0 ? '+' : ''}${stats.topCarry.annualizedFundingApr.toFixed(1)}%`
              : '—'}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {stats.topCarry
              ? `${stats.topCarry.symbol} · ${stats.topCarry.annualizedFundingApr >= 0 ? 'longs pay shorts' : 'shorts pay longs'} · ≥${THIN_BOOK_LABEL} vol`
              : 'Loading...'}
          </div>
        </div>

        <div className="bg-[#0e1522] border border-slate-800/90 rounded-lg p-3.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Quant Formula Model</span>
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div className="text-sm font-mono font-semibold text-indigo-300 mt-1.5">
            σ(0.38·F + 0.24·B + 0.22·L + 0.10·M)
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            SoSo ETF Overlay Z:{' '}
            <span className={etfFlowZScore !== 0 ? 'text-emerald-400' : 'text-slate-500'}>
              {etfFlowZScore !== 0 ? `${etfFlowZScore.toFixed(2)} (LIVE)` : '0.00 (BYOK)'}
            </span>
          </div>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#0e1522] border border-slate-800/90 rounded-lg p-2.5">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['ALL', `All (${markets.length})`],
              ['SPOT_PERP', `Spot↔Perp Arb (${stats.overlapCount})`],
              ['CRYPTO', 'Crypto'],
              ['EQUITY', 'Tokenized Equities'],
              ['COMMODITY', 'Commodities'],
              ['HIGH_CARRY', 'High Carry (≥15% APR)'],
            ] as [FilterKey, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                filter === k
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50'
                  : 'bg-slate-900/80 text-slate-400 border border-slate-800 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter ticker (BTC, NVDA, XAUT)..."
              className="bg-[#090d14] border border-slate-700/80 rounded pl-8 pr-3 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 w-52"
            />
          </div>
          <button
            onClick={() => {
              const csv = serializeMarketsToCsv(filtered);
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `basisflow-sodex-scanner-${Date.now()}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 transition"
            title="Export live filtered markets to CSV"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            CSV
          </button>
        </div>
      </div>

      {/* Main Live Table */}
      <div className="overflow-x-auto bg-[#0e1522] border border-slate-800/90 rounded-lg">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-400 bg-[#0b101b]">
              <th className="py-2.5 px-3">Market</th>
              <th className="py-2.5 px-3 text-right">Mark / 24h</th>
              <th
                className="py-2.5 px-3 text-right cursor-pointer hover:text-slate-200"
                onClick={() => toggleSort('fundingApr')}
              >
                <span className="inline-flex items-center gap-1">
                  Funding APR <ArrowUpDown className="w-3 h-3" />
                </span>
              </th>
              <th
                className="py-2.5 px-3 text-right cursor-pointer hover:text-slate-200"
                onClick={() => toggleSort('spotPerp')}
              >
                <span className="inline-flex items-center gap-1">
                  Spot↔Perp / Basis <ArrowUpDown className="w-3 h-3" />
                </span>
              </th>
              <th
                className="py-2.5 px-3 text-right cursor-pointer hover:text-slate-200"
                onClick={() => toggleSort('volume')}
              >
                <span className="inline-flex items-center gap-1">
                  24h Vol / OI <ArrowUpDown className="w-3 h-3" />
                </span>
              </th>
              <th
                className="py-2.5 px-3 text-right cursor-pointer hover:text-slate-200"
                onClick={() => toggleSort('spread')}
              >
                <span className="inline-flex items-center gap-1">
                  Spread <ArrowUpDown className="w-3 h-3" />
                </span>
              </th>
              <th
                className="py-2.5 px-3 text-right cursor-pointer hover:text-slate-200"
                onClick={() => toggleSort('conviction')}
              >
                <span className="inline-flex items-center gap-1">
                  Quant Conviction <ArrowUpDown className="w-3 h-3" />
                </span>
              </th>
              <th className="py-2.5 px-3 text-right">Desk Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono">
            {filtered.slice(0, 60).map((m) => {
              const isSelected = m.symbol === selectedSymbol;
              const aprColor =
                m.annualizedFundingApr > 10
                  ? 'text-emerald-400'
                  : m.annualizedFundingApr < -10
                    ? 'text-rose-400'
                    : 'text-slate-300';
              const dirBadge =
                m.conviction.direction === 'BASIS ARB'
                  ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                  : m.conviction.direction === 'CARRY SHORT'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : m.conviction.direction === 'CARRY LONG'
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700';

              return (
                <tr
                  key={m.symbol}
                  className={`hover:bg-slate-800/40 transition ${isSelected ? 'bg-emerald-950/20' : ''}`}
                >
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <span className="font-sans font-semibold text-slate-100">{m.symbol}</span>
                      <span className="text-[10px] font-sans px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-400">
                        {m.assetClass === 'Tokenized Equity' ? 'Equity' : m.assetClass}
                      </span>
                      {m.spotDisplayName && (
                        <span
                          title={`Live Spot Pair: ${m.spotSymbol}`}
                          className="text-[10px] font-sans px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
                        >
                          SPOT
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 font-sans mt-0.5">
                      Max {m.contract.maxLeverage}x · Maker {(Number(m.contract.makerFee) * 100).toFixed(3)}%
                    </div>
                  </td>

                  <td className="py-2.5 px-3 text-right">
                    <div className="text-slate-100">
                      ${m.markPrice.toFixed(Math.min(4, m.contract.pricePrecision))}
                    </div>
                    <div className={m.changePct24h >= 0 ? 'text-emerald-400 text-[11px]' : 'text-rose-400 text-[11px]'}>
                      {m.changePct24h >= 0 ? '+' : ''}
                      {m.changePct24h.toFixed(2)}%
                    </div>
                  </td>

                  <td className="py-2.5 px-3 text-right">
                    <div className={`font-semibold ${aprColor}`}>
                      {m.annualizedFundingApr >= 0 ? '+' : ''}
                      {m.annualizedFundingApr.toFixed(1)}%
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {(m.fundingRate * 100).toFixed(4)}%/hr
                    </div>
                  </td>

                  <td className="py-2.5 px-3 text-right">
                    {m.spotPerpSpreadBps !== null ? (
                      <>
                        <div
                          className={
                            Math.abs(m.spotPerpSpreadBps) >= 15
                              ? 'text-indigo-300 font-semibold'
                              : 'text-slate-300'
                          }
                        >
                          {m.spotPerpSpreadBps >= 0 ? '+' : ''}
                          {m.spotPerpSpreadBps.toFixed(1)} bps
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Spot ${m.spotPrice?.toFixed(Math.min(4, m.contract.pricePrecision))}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-slate-400">
                          {m.markIndexBasisBps >= 0 ? '+' : ''}
                          {m.markIndexBasisBps.toFixed(1)} bps
                        </div>
                        <div className="text-[10px] text-slate-500">Mark vs Index</div>
                      </>
                    )}
                  </td>

                  <td className="py-2.5 px-3 text-right">
                    <div className="text-slate-200">{fmtUsd(m.quoteVolume24h)}</div>
                    <div className="text-[10px] text-slate-500">OI {fmtUsd(m.openInterestUsd)}</div>
                  </td>

                  <td className="py-2.5 px-3 text-right">
                    <span className={m.spreadBps > 25 ? 'text-amber-400' : 'text-slate-300'}>
                      {m.spreadBps > 0 ? `${m.spreadBps.toFixed(1)} bps` : '—'}
                    </span>
                  </td>

                  <td className="py-2.5 px-3 text-right" title={m.conviction.rationale}>
                    <div className="flex items-center justify-end gap-1.5">
                      <span className="font-bold text-slate-100">{m.conviction.score.toFixed(1)}</span>
                      <span className={`text-[10px] font-sans px-1.5 py-0.5 rounded border ${dirBadge}`}>
                        {m.conviction.direction}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      zF:{m.conviction.fundingZ} zB:{m.conviction.basisZ} zL:{m.conviction.liquidityZ}
                    </div>
                    {m.conviction.qualityFlags && m.conviction.qualityFlags.length > 0 && (
                      <div className="flex justify-end gap-1 mt-0.5">
                        {m.conviction.qualityFlags.map((f) => (
                          <span
                            key={f}
                            className="text-[9px] font-sans px-1 rounded border border-amber-500/40 text-amber-300/90 bg-amber-500/10"
                            title={m.conviction.rationale}
                          >
                            {f === 'STALE_SPOT' ? 'STALE SPOT' : 'THIN BOOK'}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>

                  <td className="py-2.5 px-3 text-right font-sans">
                    <div className="inline-flex gap-1.5">
                      <button
                        onClick={() => onSelectForMicrostructure(m.symbol)}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] transition"
                      >
                        L2 / Chart
                      </button>
                      <button
                        onClick={() => onSelectForExecution(m.symbol)}
                        className="px-2 py-1 rounded bg-emerald-600/90 hover:bg-emerald-500 text-white text-[11px] font-medium transition"
                      >
                        Risk Desk
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
