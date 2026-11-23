import React, { useState } from 'react';
import type { KlineBar, RegimeResult } from '../types';
import { safeNum } from '../lib/quant';

interface CandlestickProps {
  klines: KlineBar[];
  regime: RegimeResult;
  pricePrecision?: number;
}

export const CandlestickRegimeChart: React.FC<CandlestickProps> = ({
  klines,
  regime,
  pricePrecision = 2,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (klines.length < 2) {
    return (
      <div className="h-64 flex items-center justify-center text-xs text-slate-500 border border-slate-800/80 rounded-lg bg-[#0c111b]">
        Loading live SoDEX OHLCV candles...
      </div>
    );
  }

  const width = 760;
  const height = 270;
  const padL = 12;
  const padR = 70;
  const padT = 16;
  const padB = 46;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const highs = klines.map((k) => k.h);
  const lows = klines.map((k) => k.l);
  const maxP = Math.max(...highs);
  const minP = Math.min(...lows);
  const range = Math.max(maxP - minP, maxP * 0.0005, 1e-6);
  const maxVol = Math.max(...klines.map((k) => k.v), 1e-9);

  const xAt = (i: number) => padL + ((i + 0.5) / klines.length) * plotW;
  const yAt = (p: number) => padT + ((maxP - p) / range) * plotH;
  const barW = Math.max(2, (plotW / klines.length) * 0.62);

  const buildPath = (vals: number[]) =>
    vals
      .map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`)
      .join(' ');

  const hovered = hoverIdx !== null ? klines[hoverIdx] : klines[klines.length - 1];

  return (
    <div className="relative bg-[#0b1019] border border-slate-800/80 rounded-lg p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-xs font-mono">
        <div className="flex items-center gap-3 text-slate-300">
          <span>
            O <b className="text-slate-100">{hovered.o.toFixed(pricePrecision)}</b>
          </span>
          <span>
            H <b className="text-emerald-400">{hovered.h.toFixed(pricePrecision)}</b>
          </span>
          <span>
            L <b className="text-rose-400">{hovered.l.toFixed(pricePrecision)}</b>
          </span>
          <span>
            C <b className="text-slate-100">{hovered.c.toFixed(pricePrecision)}</b>
          </span>
          <span className="text-slate-400">
            Vol <b className="text-slate-200">{hovered.v.toFixed(2)}</b>
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-cyan-400">— EMA 9</span>
          <span className="text-amber-400">— EMA 21</span>
          <span
            className={`px-2 py-0.5 rounded font-semibold ${
              regime.regime === 'UPTREND'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : regime.regime === 'DOWNTREND'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
            }`}
          >
            {regime.regime} · ATR {regime.atrPct}% · ER {regime.efficiencyRatio}
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-64 select-none"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const y = padT + frac * plotH;
          const p = maxP - frac * range;
          return (
            <g key={frac}>
              <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="#1e293b" strokeDasharray="2 3" />
              <text x={width - padR + 6} y={y + 3} fill="#64748b" fontSize="10" fontFamily="monospace">
                {p.toFixed(pricePrecision)}
              </text>
            </g>
          );
        })}

        {/* Volume histogram */}
        {klines.map((k, i) => {
          const vh = (k.v / maxVol) * 28;
          const x = xAt(i) - barW / 2;
          const y = height - 14 - vh;
          const up = k.c >= k.o;
          return (
            <rect
              key={`v-${k.t}`}
              x={x}
              y={y}
              width={barW}
              height={Math.max(1, vh)}
              fill={up ? 'rgba(16,185,129,0.22)' : 'rgba(244,63,94,0.22)'}
            />
          );
        })}

        {/* Candles */}
        {klines.map((k, i) => {
          const cx = xAt(i);
          const up = k.c >= k.o;
          const color = up ? '#10b981' : '#f43f5e';
          const top = yAt(Math.max(k.o, k.c));
          const bot = yAt(Math.min(k.o, k.c));
          const bodyH = Math.max(1.5, bot - top);
          return (
            <g key={k.t} onMouseEnter={() => setHoverIdx(i)} className="cursor-crosshair">
              <line x1={cx} x2={cx} y1={yAt(k.h)} y2={yAt(k.l)} stroke={color} strokeWidth={1.1} />
              <rect x={cx - barW / 2} y={top} width={barW} height={bodyH} fill={color} rx={0.5} />
              <rect
                x={cx - plotW / klines.length / 2}
                y={padT}
                width={plotW / klines.length}
                height={plotH}
                fill="transparent"
              />
            </g>
          );
        })}

        {/* EMAs */}
        <path d={buildPath(regime.emaSlow)} fill="none" stroke="#f59e0b" strokeWidth={1.4} opacity={0.85} />
        <path d={buildPath(regime.emaFast)} fill="none" stroke="#22d3ee" strokeWidth={1.5} opacity={0.95} />

        {/* Crosshair */}
        {hoverIdx !== null && (
          <line
            x1={xAt(hoverIdx)}
            x2={xAt(hoverIdx)}
            y1={padT}
            y2={height - 14}
            stroke="#94a3b8"
            strokeDasharray="3 3"
            strokeWidth={0.8}
          />
        )}
      </svg>
    </div>
  );
};

interface DepthProps {
  bids: [string, string][];
  asks: [string, string][];
  pricePrecision?: number;
}

export const DepthChart: React.FC<DepthProps> = ({ bids, asks, pricePrecision = 2 }) => {
  if (bids.length === 0 || asks.length === 0) {
    return (
      <div className="h-44 flex items-center justify-center text-xs text-slate-500 border border-slate-800/80 rounded-lg bg-[#0b1019]">
        Awaiting live L2 orderbook depth...
      </div>
    );
  }

  let cumBid = 0;
  const bidPts = bids.slice(0, 15).map(([p, q]) => {
    const px = safeNum(p);
    cumBid += px * safeNum(q);
    return { px, cum: cumBid };
  });
  let cumAsk = 0;
  const askPts = asks.slice(0, 15).map(([p, q]) => {
    const px = safeNum(p);
    cumAsk += px * safeNum(q);
    return { px, cum: cumAsk };
  });

  const maxCum = Math.max(cumBid, cumAsk, 1);
  const w = 480;
  const h = 150;
  const midX = w / 2;
  const padT = 12;
  const padB = 22;
  const plotH = h - padT - padB;

  const bidSvg = bidPts
    .map((pt, i) => {
      const x = midX - 8 - ((i + 1) / bidPts.length) * (midX - 18);
      const y = padT + (1 - pt.cum / maxCum) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const bidArea = `${midX - 8},${padT + plotH} ${bidSvg} 10,${padT + plotH}`;

  const askSvg = askPts
    .map((pt, i) => {
      const x = midX + 8 + ((i + 1) / askPts.length) * (midX - 18);
      const y = padT + (1 - pt.cum / maxCum) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const askArea = `${midX + 8},${padT + plotH} ${askSvg} ${w - 10},${padT + plotH}`;

  return (
    <div className="bg-[#0b1019] border border-slate-800/80 rounded-lg p-3">
      <div className="flex justify-between text-[11px] font-mono text-slate-400 mb-1">
        <span className="text-emerald-400">
          Bid Depth (Top 15): ${(cumBid / 1000).toFixed(1)}k
        </span>
        <span className="text-rose-400">
          Ask Depth (Top 15): ${(cumAsk / 1000).toFixed(1)}k
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-36">
        <polygon points={bidArea} fill="rgba(16,185,129,0.18)" stroke="#10b981" strokeWidth="1.5" />
        <polygon points={askArea} fill="rgba(244,63,94,0.18)" stroke="#f43f5e" strokeWidth="1.5" />
        <line x1={midX} x2={midX} y1={padT} y2={padT + plotH} stroke="#334155" strokeDasharray="2 2" />
        <text x={14} y={h - 5} fill="#64748b" fontSize="10" fontFamily="monospace">
          {bidPts[bidPts.length - 1]?.px.toFixed(pricePrecision)}
        </text>
        <text x={midX} y={h - 5} textAnchor="middle" fill="#cbd5e1" fontSize="10" fontFamily="monospace">
          {bidPts[0]?.px.toFixed(pricePrecision)} / {askPts[0]?.px.toFixed(pricePrecision)}
        </text>
        <text x={w - 14} y={h - 5} textAnchor="end" fill="#64748b" fontSize="10" fontFamily="monospace">
          {askPts[askPts.length - 1]?.px.toFixed(pricePrecision)}
        </text>
      </svg>
    </div>
  );
};

interface CounterfactualProps {
  points: { label: string; gatedEquity: number; ungatedEquity: number }[];
}

export const CounterfactualChart: React.FC<CounterfactualProps> = ({ points }) => {
  if (points.length < 2) {
    return (
      <div className="h-36 flex items-center justify-center text-xs text-slate-500 border border-slate-800/80 rounded-lg bg-[#0b1019] px-4 text-center">
        Execute and close at least 1 paper trade to render live Risk-Gated vs. Ungated Counterfactual Equity comparison.
      </div>
    );
  }
  const w = 520;
  const h = 150;
  const padL = 52;
  const padR = 16;
  const padT = 14;
  const padB = 22;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const allVals = points.flatMap((p) => [p.gatedEquity, p.ungatedEquity]);
  const maxV = Math.max(...allVals);
  const minV = Math.min(...allVals);
  const range = Math.max(maxV - minV, 50);

  const xAt = (i: number) => padL + (i / (points.length - 1)) * plotW;
  const yAt = (v: number) => padT + ((maxV - v) / range) * plotH;

  const gatedPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(p.gatedEquity).toFixed(1)}`)
    .join(' ');
  const ungatedPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(p.ungatedEquity).toFixed(1)}`)
    .join(' ');

  return (
    <div className="bg-[#0b1019] border border-slate-800/80 rounded-lg p-3">
      <div className="flex justify-between text-[11px] font-mono mb-1">
        <span className="text-emerald-400">● Risk-Gated Equity (Active)</span>
        <span className="text-rose-400">--- Ungated 2.5x Counterfactual</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-36">
        <text x={4} y={padT + 8} fill="#64748b" fontSize="10" fontFamily="monospace">
          ${maxV.toFixed(0)}
        </text>
        <text x={4} y={padT + plotH} fill="#64748b" fontSize="10" fontFamily="monospace">
          ${minV.toFixed(0)}
        </text>
        <path d={ungatedPath} fill="none" stroke="#f43f5e" strokeWidth={1.6} strokeDasharray="4 3" />
        <path d={gatedPath} fill="none" stroke="#10b981" strokeWidth={2.1} />
        {points.map((p, i) => (
          <circle key={i} cx={xAt(i)} cy={yAt(p.gatedEquity)} r={2.5} fill="#10b981" />
        ))}
      </svg>
    </div>
  );
};
