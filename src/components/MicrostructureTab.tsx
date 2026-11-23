import React, { useMemo, useState } from 'react';
import { RefreshCw, Gauge, ArrowRight, Radio, Pause, Play } from 'lucide-react';
import type { EnrichedMarket, KlineBar, OrderbookData, TradeTick, WsStreamTelemetry } from '../types';
import {
  computeOrderbookImbalance,
  detectMarketRegime,
  safeNum,
  simulateOrderbookSlippage,
} from '../lib/quant';
import { CandlestickRegimeChart, DepthChart } from './Charts';

interface Props {
  markets: EnrichedMarket[];
  selectedMarket: EnrichedMarket | null;
  onChangeSymbol: (symbol: string) => void;
  interval: '15m' | '1h' | '4h' | '1d';
  onChangeInterval: (iv: '15m' | '1h' | '4h' | '1d') => void;
  orderbook: OrderbookData | null;
  klines: KlineBar[];
  trades: TradeTick[];
  loading: boolean;
  wsTelemetry: WsStreamTelemetry;
  wsPaused: boolean;
  onToggleWsPause: () => void;
  onRefresh: () => void;
  onSendToExecution: (symbol: string) => void;
}

export const MicrostructureTab: React.FC<Props> = ({
  markets,
  selectedMarket,
  onChangeSymbol,
  interval,
  onChangeInterval,
  orderbook,
  klines,
  trades,
  loading,
  wsTelemetry,
  wsPaused,
  onToggleWsPause,
  onRefresh,
  onSendToExecution,
}) => {
  const [simSide, setSimSide] = useState<'BUY' | 'SELL'>('BUY');
  const [simNotional, setSimNotional] = useState<number>(25_000);

  const regime = useMemo(() => detectMarketRegime(klines), [klines]);

  const imbalance = useMemo(() => {
    if (!orderbook) return { bidUsd: 0, askUsd: 0, imbalancePct: 0 };
    return computeOrderbookImbalance(orderbook.bids, orderbook.asks, 10);
  }, [orderbook]);

  const midPrice = useMemo(() => {
    if (orderbook && orderbook.bids.length > 0 && orderbook.asks.length > 0) {
      return (safeNum(orderbook.bids[0][0]) + safeNum(orderbook.asks[0][0])) / 2;
    }
    return selectedMarket?.markPrice ?? 0;
  }, [orderbook, selectedMarket]);

  const slippage = useMemo(() => {
    if (!orderbook) return null;
    const levels = simSide === 'BUY' ? orderbook.asks : orderbook.bids;
    return simulateOrderbookSlippage(levels, simSide, simNotional, midPrice);
  }, [orderbook, simSide, simNotional, midPrice]);

  const buyPressurePct = useMemo(() => {
    if (trades.length === 0) return 50;
    const buyVol = trades.filter((t) => t.S === 'BUY').reduce((a, t) => a + t.p * t.q, 0);
    const totalVol = trades.reduce((a, t) => a + t.p * t.q, 0);
    return totalVol > 0 ? (buyVol / totalVol) * 100 : 50;
  }, [trades]);

  const pxPrec = Math.min(4, selectedMarket?.contract.pricePrecision ?? 2);

  return (
    <div className="space-y-4">
      {/* Control bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0e1522] border border-slate-800/90 rounded-lg p-3">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedMarket?.symbol ?? ''}
            onChange={(e) => onChangeSymbol(e.target.value)}
            className="bg-[#090d14] border border-slate-700 rounded px-3 py-1.5 text-sm font-semibold text-slate-100 focus:outline-none focus:border-emerald-500"
          >
            {markets.map((m) => (
              <option key={m.symbol} value={m.symbol}>
                {m.symbol} — ${m.markPrice.toFixed(Math.min(4, m.contract.pricePrecision))} (
                {m.annualizedFundingApr >= 0 ? '+' : ''}
                {m.annualizedFundingApr.toFixed(1)}% APR)
              </option>
            ))}
          </select>

          <div className="inline-flex rounded bg-[#090d14] border border-slate-800 p-0.5">
            {(['15m', '1h', '4h', '1d'] as const).map((iv) => (
              <button
                key={iv}
                onClick={() => onChangeInterval(iv)}
                className={`px-2.5 py-1 text-xs font-mono rounded transition ${
                  interval === iv
                    ? 'bg-emerald-500/20 text-emerald-300 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {iv}
              </button>
            ))}
          </div>

          {orderbook && (
            <span className="text-[11px] font-mono text-slate-400">
              {orderbook.blockHeight > 0 ? (
                <>
                  SoDEX L2 Block <b className="text-cyan-400">#{orderbook.blockHeight.toLocaleString()}</b>
                </>
              ) : (
                <>
                  WS Update <b className="text-cyan-400">#{orderbook.updateID.toLocaleString()}</b>
                </>
              )}
            </span>
          )}

          <span
            className={`inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-0.5 rounded border ${
              wsTelemetry.status === 'STREAMING'
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                : wsTelemetry.status === 'PAUSED'
                  ? 'bg-slate-800 text-slate-400 border-slate-700'
                  : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
            }`}
          >
            <Radio className={`w-3 h-3 ${wsTelemetry.status === 'STREAMING' ? 'animate-pulse' : ''}`} />
            {wsTelemetry.status === 'STREAMING'
              ? `500ms WS LIVE (${wsTelemetry.msgCount} ticks)`
              : `WS: ${wsTelemetry.status}`}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onToggleWsPause}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 transition"
            title="Pause or resume real-time 500ms SoDEX WebSocket L2 stream"
          >
            {wsPaused ? <Play className="w-3.5 h-3.5 text-emerald-400" /> : <Pause className="w-3.5 h-3.5 text-amber-400" />}
            {wsPaused ? 'Resume WS' : 'Pause WS'}
          </button>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh L2
          </button>
          {selectedMarket && (
            <button
              onClick={() => onSendToExecution(selectedMarket.symbol)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition"
            >
              Build Risk-Gated Ticket <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Candlestick + Regime Explanation */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          <CandlestickRegimeChart klines={klines} regime={regime} pricePrecision={pxPrec} />
          <div className="bg-[#0e1522] border border-slate-800/90 rounded-lg p-3 text-xs text-slate-300 flex flex-wrap justify-between gap-2">
            <div>
              <span className="text-slate-500 uppercase text-[10px] tracking-wider block">
                Automated Regime Classifier
              </span>
              {regime.summary}
            </div>
            {selectedMarket && (
              <div className="text-right font-mono">
                <span className="text-slate-500 uppercase text-[10px] tracking-wider block">
                  Quant Thesis
                </span>
                <span className="text-emerald-300">{selectedMarket.conviction.direction}</span> · Score{' '}
                <b>{selectedMarket.conviction.score.toFixed(1)}/100</b>
              </div>
            )}
          </div>
          <DepthChart
            bids={orderbook?.bids ?? []}
            asks={orderbook?.asks ?? []}
            pricePrecision={pxPrec}
          />
        </div>

        {/* Right column: Exact L2 Slippage Simulator + Live Trade Tape */}
        <div className="space-y-4">
          <div className="bg-[#0e1522] border border-slate-800/90 rounded-lg p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-100">
                <Gauge className="w-4 h-4 text-cyan-400" />
                Exact L2 Slippage Simulator
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                LIVE BOOK
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {(['BUY', 'SELL'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSimSide(s)}
                  className={`py-1.5 rounded text-xs font-semibold border transition ${
                    simSide === s
                      ? s === 'BUY'
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                        : 'bg-rose-500/20 border-rose-500 text-rose-300'
                      : 'bg-[#090d14] border-slate-800 text-slate-400'
                  }`}
                >
                  {s === 'BUY' ? 'Simulate Market BUY' : 'Simulate Market SELL'}
                </button>
              ))}
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>Order Notional (USD)</span>
                <span className="font-mono text-slate-200">${simNotional.toLocaleString()}</span>
              </div>
              <div className="grid grid-cols-4 gap-1 mb-2">
                {[1000, 10000, 50000, 250000].map((v) => (
                  <button
                    key={v}
                    onClick={() => setSimNotional(v)}
                    className={`py-1 rounded text-[11px] font-mono border ${
                      simNotional === v
                        ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                        : 'bg-[#090d14] border-slate-800 text-slate-400'
                    }`}
                  >
                    ${v >= 1000 ? `${v / 1000}k` : v}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={10}
                step={1000}
                value={simNotional}
                onChange={(e) => setSimNotional(Math.max(10, Number(e.target.value) || 0))}
                className="w-full bg-[#090d14] border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-100"
              />
            </div>

            {slippage && (
              <div className="bg-[#090d14] border border-slate-800 rounded p-2.5 space-y-1.5 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-400">Live Mid Price</span>
                  <span className="text-slate-200">${slippage.midPrice.toFixed(pxPrec)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Exact Fill VWAP</span>
                  <span className="text-slate-100 font-semibold">${slippage.vwapPrice.toFixed(pxPrec)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Expected Slippage</span>
                  <span
                    className={
                      slippage.slippageBps > 35
                        ? 'text-rose-400 font-bold'
                        : slippage.slippageBps > 12
                          ? 'text-amber-300 font-semibold'
                          : 'text-emerald-400 font-semibold'
                    }
                  >
                    {slippage.slippageBps.toFixed(2)} bps
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Book Levels Swept</span>
                  <span className="text-slate-200">
                    {slippage.levelsConsumed} {slippage.exhaustedBook ? '(EXHAUSTED TOP-20!)' : ''}
                  </span>
                </div>
                <div className="flex justify-between pt-1 border-t border-slate-800">
                  <span className="text-slate-400">Top-10 Imbalance</span>
                  <span className={imbalance.imbalancePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    {imbalance.imbalancePct >= 0 ? '+' : ''}
                    {imbalance.imbalancePct.toFixed(1)}% ({imbalance.imbalancePct >= 0 ? 'Bid Heavy' : 'Ask Heavy'})
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Live Trade Tape */}
          <div className="bg-[#0e1522] border border-slate-800/90 rounded-lg p-3.5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-100">Live SoDEX Trade Tape</span>
              <span className="text-[11px] font-mono text-slate-400">
                Buy Flow: <b className="text-emerald-400">{buyPressurePct.toFixed(0)}%</b>
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-rose-500/40 overflow-hidden mb-2.5">
              <div
                className="h-full bg-emerald-400 transition-all"
                style={{ width: `${buyPressurePct}%` }}
              />
            </div>
            <div className="max-h-56 overflow-y-auto space-y-1 font-mono text-[11px]">
              {trades.slice(0, 20).map((t, idx) => (
                <div key={`${t.t}-${idx}`} className="flex justify-between py-0.5 border-b border-slate-800/40">
                  <span className={t.S === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}>
                    {t.S} {t.p.toFixed(pxPrec)}
                  </span>
                  <span className="text-slate-300">{t.q.toFixed(4)}</span>
                  <span className="text-slate-500">
                    {new Date(t.T).toISOString().slice(11, 19)}
                  </span>
                </div>
              ))}
              {trades.length === 0 && (
                <div className="text-slate-500 text-center py-4">No recent trades on this symbol.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
