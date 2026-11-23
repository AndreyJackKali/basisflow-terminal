import React, { useState } from 'react';
import { KeyRound, Radio, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';
import type { SoSoValueState } from '../types';

interface Props {
  apiKey: string;
  onSaveApiKey: (key: string) => void;
  sosoState: SoSoValueState;
  onProbeLive: (keyOverride?: string) => void;
}

export const SoSoValueTab: React.FC<Props> = ({
  apiKey,
  onSaveApiKey,
  sosoState,
  onProbeLive,
}) => {
  const [draftKey, setDraftKey] = useState(apiKey);

  const handleConnect = () => {
    onSaveApiKey(draftKey.trim());
    onProbeLive(draftKey.trim());
  };

  return (
    <div className="space-y-4">
      {/* BYOK Banner */}
      <div className="bg-[#0e1522] border border-slate-800/90 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-indigo-400" />
              SoSoValue OpenAPI v1 Intelligence Hub (Native CORS · BYOK)
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Calls <code className="text-cyan-300">https://openapi.sosovalue.com/openapi/v1/*</code> directly from your browser. Your key stays strictly in <code className="text-slate-300">localStorage</code>. Zero mocked or fabricated numbers are ever displayed.
            </p>
          </div>
          <span
            className={`px-2.5 py-1 rounded text-xs font-mono font-bold border ${
              sosoState.status === 'LIVE'
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-amber-500/15 text-amber-300 border-amber-500/40'
            }`}
          >
            STATUS: {sosoState.status}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            type="password"
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
            placeholder="Paste x-soso-api-key to enable live ETF flows, SSI Indices, Hot News & Conviction Z-score..."
            className="flex-1 min-w-[260px] bg-[#090d14] border border-slate-700 rounded px-3 py-2 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={handleConnect}
            className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition"
          >
            Save &amp; Fetch Live SoSoValue Data
          </button>
          <button
            onClick={() => onProbeLive('')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 transition"
          >
            <Radio className="w-3.5 h-3.5 text-cyan-400" />
            Test Live CORS &amp; Auth Gate
          </button>
        </div>

        {sosoState.error && (
          <div className="flex items-start gap-2 text-xs bg-amber-950/30 border border-amber-700/50 text-amber-200 rounded p-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <div>{sosoState.error}</div>
          </div>
        )}

        {sosoState.status === 'LIVE' && (
          <div className="flex items-center gap-2 text-xs bg-emerald-950/30 border border-emerald-700/50 text-emerald-200 rounded p-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              Live SoSoValue OpenAPI connected! Derived BTC Spot ETF Flow Z-Score:{' '}
              <b className="font-mono">{sosoState.etfFlowZScore.toFixed(2)}</b> — automatically fused into Tab 1 Sigmoid Conviction scores.
            </span>
          </div>
        )}
      </div>

      {/* Live Data Panels (or Honest BYOK Endpoint Matrix) */}
      {sosoState.status === 'LIVE' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-[#0e1522] border border-slate-800/90 rounded-lg p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
              US Spot BTC ETF Flows ({sosoState.etfSummary.length} sessions)
            </h4>
            <div className="max-h-64 overflow-y-auto font-mono text-xs divide-y divide-slate-800/60">
              {sosoState.etfSummary.slice(0, 15).map((row, idx) => (
                <div key={idx} className="py-1.5 flex justify-between">
                  <span className="text-slate-400">{String(row.date ?? row.time ?? `#${idx + 1}`)}</span>
                  <span className="text-emerald-300">
                    {String(row.totalNetInflow ?? row.dailyNetInflow ?? JSON.stringify(row).slice(0, 60))}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#0e1522] border border-slate-800/90 rounded-lg p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
              SoSoValue Hot News ({sosoState.hotNews.length})
            </h4>
            <div className="max-h-64 overflow-y-auto text-xs divide-y divide-slate-800/60">
              {sosoState.hotNews.slice(0, 8).map((n, idx) => (
                <div key={idx} className="py-2">
                  <div className="text-slate-200 font-medium">
                    {String(n.title ?? n.headline ?? 'Market Update')}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {String(n.source ?? n.publishTime ?? '')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-[#0e1522] border border-slate-800/90 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Wired SoSoValue OpenAPI v1 Endpoints (Ready for Judge Key)
            </h4>
            <a
              href="https://sosovalue.com/developer/dashboard"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1"
            >
              Get Free API Key <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
            {[
              { ep: 'GET /openapi/v1/etfs/summary-history?type=us-btc-spot', role: 'Computes 30d Spot BTC ETF net-inflow z-score -> fused into Tab 1 Quant Conviction.' },
              { ep: 'GET /openapi/v1/indices', role: 'Benchmarks SoDEX sector carry baskets against live SoSoValue SSI indices.' },
              { ep: 'GET /openapi/v1/news/hot?pageSize=8', role: 'Surfaces real-time macro & ETF catalyst headlines alongside basis spikes.' },
              { ep: 'GET /openapi/v1/btc-treasuries', role: 'Tracks corporate BTC holdings (e.g. MSTR) paired with SoDEX MSTR-USD tokenized perp.' },
            ].map((item) => (
              <div key={item.ep} className="bg-[#090d14] border border-slate-800 rounded p-3">
                <div className="text-cyan-300 break-all">{item.ep}</div>
                <div className="text-slate-400 font-sans text-[11px] mt-1">{item.role}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
