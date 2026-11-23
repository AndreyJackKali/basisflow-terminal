import React from 'react';
import { X, Terminal, CheckCircle2, XCircle } from 'lucide-react';
import type { ApiProbeLog } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  logs: ApiProbeLog[];
}

export const ApiConsoleDrawer: React.FC<Props> = ({ open, onClose, logs }) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-end">
      <div className="w-full max-w-2xl bg-[#0b101b] border-l border-slate-800 h-full flex flex-col">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              Live API Verification &amp; Data Honesty Console ({logs.length} calls)
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 bg-emerald-950/20 border-b border-slate-800 text-[11px] text-slate-300">
          Every HTTP call below was executed live from your browser directly against SoDEX Mainnet/Testnet, ValueChain L1 RPC, or SoSoValue OpenAPI v1 — zero hidden proxies, zero fake data.
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2.5 font-mono text-xs">
          {logs.map((log) => (
            <div key={log.id} className="bg-[#090d14] border border-slate-800 rounded p-2.5 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {log.ok ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-amber-400" />
                  )}
                  <span className="font-semibold text-slate-200">{log.source}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] ${
                      log.ok ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    HTTP {log.status || 'ERR'}
                  </span>
                  <span className="text-slate-500">{log.latencyMs}ms</span>
                  {log.recordCount !== undefined && (
                    <span className="text-cyan-400">{log.recordCount} rows</span>
                  )}
                </div>
                <span className="text-[10px] text-slate-500">
                  {new Date(log.timestamp).toISOString().slice(11, 19)}Z
                </span>
              </div>
              <div className="text-[11px] text-cyan-300 break-all">
                {log.method} {log.endpoint}
              </div>
              <div className="text-[11px] text-slate-400 font-sans">{log.note}</div>
              <details className="text-[10px] text-slate-500">
                <summary className="cursor-pointer hover:text-slate-300">Inspect raw JSON snippet</summary>
                <pre className="mt-1 p-2 bg-black/40 rounded overflow-x-auto text-slate-400 whitespace-pre-wrap break-all">
                  {log.sampleJson}
                </pre>
              </details>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
