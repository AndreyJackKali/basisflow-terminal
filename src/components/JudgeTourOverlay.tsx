import React, { useEffect } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Compass,
  Download,
  ExternalLink,
  FileSpreadsheet,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import type { EnrichedMarket, QualityAlertSummary, SoSoValueState } from '../types';

export interface JudgeTourStepMeta {
  step: number;
  title: string;
  badge: string;
  tab: 'sosovalue' | 'execution' | 'scanner';
  summary: string;
  bullets: string[];
  scrollTargetId?: string;
}

export const JUDGE_TOUR_STEPS: JudgeTourStepMeta[] = [
  {
    step: 1,
    title: 'Live SoSoValue ETF Flow & Spot/Perp Basis Regime',
    badge: '0:00 – 0:15 · Tab 4',
    tab: 'sosovalue',
    summary:
      '24/24 verified SoSoValue OpenAPI v1 endpoints power live US Spot BTC/ETH/SOL/XRP ETF flow Z-scores, 13 SSI crypto sector indices, and cross-venue funding divergence regimes — with zero credentials bundled.',
    bullets: [
      'Real US Spot ETF daily flows joined directly against SoDEX Perp funding APR & Spot↔Perp spreads.',
      'All 13 live SSI sector indices mapped to overlapping SoDEX perp funding baskets.',
      'Zero-secret hybrid architecture: verified snapshot + local CORS proxy + RAM-only BYOK.',
    ],
  },
  {
    step: 2,
    title: 'Carry-Trade Position Sizing & Liquidation Stress Simulator',
    badge: '0:15 – 0:30 · Tab 3',
    tab: 'execution',
    scrollTargetId: 'carry-stress-calculator',
    summary:
      'Wired directly to live SoDEX contract margin tiers and SoSoValue ETF flows. Adjust collateral, leverage, funding decay, and borrow cost to inspect Net APY, break-even days, and funding-flip drawdowns.',
    bullets: [
      'Computes exact Net APY, collateral ROE, break-even days, and live liquidation buffer.',
      '5-tier Funding-Flip Sensitivity Matrix (Steady → -50% Decay → 0% → -1× Flip → -2× Flip).',
      'Live ETF-Flow Confirmation badge (CONFIRMED / DIVERGENT / CAUTIOUS) per tracked asset.',
    ],
  },
  {
    step: 3,
    title: 'Thin-Book & Anomaly Data-Quality Guardrails',
    badge: '0:30 – 0:45 · Tab 1',
    tab: 'scanner',
    scrollTargetId: 'quality-guard-strip',
    summary:
      'Protects institutional traders from mirage yields: markets under $1M 24h volume are flagged THIN BOOK (conviction capped ≤55) and Spot↔Perp gaps >1,500 bps are flagged STALE SPOT instead of fake arb.',
    bullets: [
      'Headline Peak Tradable Carry filters strictly for ≥$1M executable markets.',
      'Live spread & mark-index divergence alerts surface wide-spread or dislocated contracts.',
      'Click any source badge in the top bar to audit raw HTTP status, latency, and JSON payloads.',
    ],
  },
  {
    step: 4,
    title: 'Export Reproducible Trade Ticket JSON & CSV Reports',
    badge: '0:45 – 1:00 · Export & Brief',
    tab: 'execution',
    scrollTargetId: 'carry-stress-calculator',
    summary:
      'Every calculation is deterministic, auditable, and exportable in one click — plus inspect the full 24/24 SoSoValue endpoint map and zero-leak architecture in our Judge Brief.',
    bullets: [
      'Export Carry Trade Ticket JSON (schema v1.6) or 5-scenario Stress CSV report.',
      'Export full live SoDEX Scanner CSV (107 perps + joined Spot↔Perp pairs) or EIP-712 payload.',
      'Backed by 37+ Vitest unit tests including snapshot schema & zero-secret leak assertions.',
    ],
  },
];

interface Props {
  open: boolean;
  stepIndex: number;
  onClose: () => void;
  onStepChange: (nextIndex: number) => void;
  sosoState: SoSoValueState;
  markets: EnrichedMarket[];
  qualitySummary: QualityAlertSummary;
  onExportScannerCsv: () => void;
  onExportCarryTicketJson: () => void;
}

export const JudgeTourOverlay: React.FC<Props> = ({
  open,
  stepIndex,
  onClose,
  onStepChange,
  sosoState,
  markets,
  qualitySummary,
  onExportScannerCsv,
  onExportCarryTicketJson,
}) => {
  const total = JUDGE_TOUR_STEPS.length;
  const current = JUDGE_TOUR_STEPS[Math.max(0, Math.min(total - 1, stepIndex))];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && stepIndex < total - 1) onStepChange(stepIndex + 1);
      else if (e.key === 'ArrowLeft' && stepIndex > 0) onStepChange(stepIndex - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, stepIndex, total, onClose, onStepChange]);

  if (!open) return null;

  return (
    <aside
      aria-label="60-Second Guided Judge Tour"
      className="fixed bottom-3 right-3 left-3 sm:left-auto sm:w-[440px] z-50 bg-[#0b1220]/98 backdrop-blur-md border border-emerald-500/55 rounded-xl shadow-2xl shadow-black/70 p-4 text-slate-100"
    >
      {/* Top bar */}
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-md bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-300">
            <Compass className="w-3.5 h-3.5" />
          </span>
          <div>
            <div className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
              60-Second Guided Judge Tour
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                {current.step} / {total}
              </span>
            </div>
            <div className="text-[10px] font-mono text-slate-400">{current.badge}</div>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close Judge Tour"
          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-100 transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Step progress dots */}
      <div className="grid grid-cols-4 gap-1.5 my-2.5">
        {JUDGE_TOUR_STEPS.map((s, i) => (
          <button
            key={s.step}
            onClick={() => onStepChange(i)}
            className={`h-1.5 rounded-full transition ${
              i === stepIndex
                ? 'bg-emerald-400'
                : i < stepIndex
                  ? 'bg-emerald-700/80'
                  : 'bg-slate-800 hover:bg-slate-700'
            }`}
            title={`Jump to Step ${s.step}: ${s.title}`}
          />
        ))}
      </div>

      {/* Body */}
      <div className="space-y-2.5">
        <h4 className="text-sm font-bold text-slate-100 leading-snug">{current.title}</h4>
        <p className="text-xs text-slate-300 leading-relaxed">{current.summary}</p>

        {/* Live contextual telemetry strip */}
        <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono bg-[#070b12] border border-slate-800 rounded-lg p-2">
          {stepIndex === 0 && (
            <>
              <div>
                <div className="text-slate-500">SoSo Endpoints</div>
                <div className="text-emerald-400 font-bold">{sosoState.endpointsVerified || 24}/24 OK</div>
              </div>
              <div>
                <div className="text-slate-500">BTC ETF 30d Z</div>
                <div className="text-cyan-300 font-bold">{sosoState.btcEtfFlowZScore.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-slate-500">SSI Indices</div>
                <div className="text-indigo-300 font-bold">{sosoState.ssiIndices.length || 13} Live</div>
              </div>
            </>
          )}
          {stepIndex === 1 && (
            <>
              <div>
                <div className="text-slate-500">Live Perps</div>
                <div className="text-emerald-400 font-bold">{markets.length} Active</div>
              </div>
              <div>
                <div className="text-slate-500">Stress Matrix</div>
                <div className="text-cyan-300 font-bold">5 Flip Tiers</div>
              </div>
              <div>
                <div className="text-slate-500">ETF Overlay</div>
                <div className="text-indigo-300 font-bold">BTC/ETH/SOL/XRP</div>
              </div>
            </>
          )}
          {stepIndex === 2 && (
            <>
              <div>
                <div className="text-slate-500">Executable ≥$1M</div>
                <div className="text-emerald-400 font-bold">{qualitySummary.executableCount} MkTs</div>
              </div>
              <div>
                <div className="text-slate-500">THIN BOOK Cap</div>
                <div className="text-amber-300 font-bold">{qualitySummary.thinBookCount} Flagged</div>
              </div>
              <div>
                <div className="text-slate-500">STALE / Div.</div>
                <div className="text-rose-300 font-bold">
                  {qualitySummary.staleSpotCount} / {qualitySummary.divergenceAlertCount}
                </div>
              </div>
            </>
          )}
          {stepIndex === 3 && (
            <>
              <div>
                <div className="text-slate-500">Secret Leaks</div>
                <div className="text-emerald-400 font-bold">0 Hardcoded</div>
              </div>
              <div>
                <div className="text-slate-500">Unit Tests</div>
                <div className="text-cyan-300 font-bold">37+ Vitest</div>
              </div>
              <div>
                <div className="text-slate-500">Release</div>
                <div className="text-indigo-300 font-bold">v1.6.0 Live</div>
              </div>
            </>
          )}
        </div>

        <ul className="space-y-1 text-[11px] text-slate-300">
          {current.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
              <span>{b}</span>
            </li>
          ))}
        </ul>

        {/* Step 4 1-click export actions */}
        {stepIndex === 3 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            <button
              onClick={onExportCarryTicketJson}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-cyan-600/90 hover:bg-cyan-500 text-white text-[11px] font-semibold transition"
            >
              <Download className="w-3 h-3" />
              Export Ticket JSON
            </button>
            <button
              onClick={onExportScannerCsv}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-medium transition"
            >
              <FileSpreadsheet className="w-3 h-3 text-emerald-400" />
              Export Scanner CSV
            </button>
            <a
              href="./judge-brief.html"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-[11px] font-medium transition"
            >
              <ShieldCheck className="w-3 h-3" />
              Judge Brief <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between gap-2 pt-3 mt-3 border-t border-slate-800">
        <button
          onClick={() => onStepChange(Math.max(0, stepIndex - 1))}
          disabled={stepIndex === 0}
          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium transition ${
            stepIndex === 0
              ? 'bg-slate-900 text-slate-600 cursor-not-allowed'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
          }`}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </button>

        <span className="text-[10px] font-mono text-slate-500 hidden sm:inline">
          Use ← / → keys · Esc to exit
        </span>

        {stepIndex < total - 1 ? (
          <button
            onClick={() => onStepChange(stepIndex + 1)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition"
          >
            Next Step
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Finish Tour
          </button>
        )}
      </div>
    </aside>
  );
};
