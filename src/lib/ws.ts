import type { NetworkMode, OrderbookData, TradeTick, WsConnectionStatus } from '../types';
import { NETWORK_CONFIG } from './api';
import { safeNum } from './quant';

export interface ParsedWsEvent {
  kind: 'l2Book' | 'trade' | 'markPrice' | 'ack' | 'ignore';
  l2Book?: {
    symbol: string;
    eventTime: number;
    updateID: number;
    bids: [string, string][];
    asks: [string, string][];
  };
  trades?: TradeTick[];
  markPrice?: {
    symbol: string;
    markPrice: number;
    indexPrice: number;
    openInterest: number;
    fundingRate: number;
    nextFundingTime: number;
  };
}

export function parseSodexWsMessage(raw: string): ParsedWsEvent {
  try {
    const msg = JSON.parse(raw) as Record<string, unknown>;
    if (msg.op === 'subscribe') {
      return { kind: 'ack' };
    }

    if (msg.channel === 'l2Book' && msg.data && typeof msg.data === 'object') {
      const d = msg.data as Record<string, unknown>;
      const bids = Array.isArray(d.b) ? (d.b as [string, string][]) : [];
      const asks = Array.isArray(d.a) ? (d.a as [string, string][]) : [];
      if (bids.length > 0 || asks.length > 0) {
        return {
          kind: 'l2Book',
          l2Book: {
            symbol: String(d.s ?? ''),
            eventTime: safeNum(d.E, Date.now()),
            updateID: safeNum(d.u, 0),
            bids,
            asks,
          },
        };
      }
    }

    if (msg.channel === 'trade' && Array.isArray(msg.data)) {
      const trades: TradeTick[] = (msg.data as Record<string, unknown>[])
        .map((t) => ({
          t: safeNum(t.t),
          T: safeNum(t.T, safeNum(t.E, Date.now())),
          s: String(t.s ?? ''),
          S: String(t.S).toUpperCase() === 'BUY' ? ('BUY' as const) : ('SELL' as const),
          p: safeNum(t.p),
          q: safeNum(t.q),
        }))
        .filter((t) => t.p > 0 && t.q > 0);
      if (trades.length > 0) {
        return { kind: 'trade', trades };
      }
    }

    if (msg.channel === 'markPrice' && Array.isArray(msg.data) && msg.data.length > 0) {
      const d = msg.data[0] as Record<string, unknown>;
      const mp = safeNum(d.p);
      if (mp > 0) {
        return {
          kind: 'markPrice',
          markPrice: {
            symbol: String(d.s ?? ''),
            markPrice: mp,
            indexPrice: safeNum(d.i, mp),
            openInterest: safeNum(d.oi),
            fundingRate: safeNum(d.r),
            nextFundingTime: safeNum(d.T),
          },
        };
      }
    }

    return { kind: 'ignore' };
  } catch {
    return { kind: 'ignore' };
  }
}

export interface SodexStreamCallbacks {
  network: NetworkMode;
  symbol: string;
  onL2Book: (update: Pick<OrderbookData, 'bids' | 'asks' | 'updateID' | 'blockTime'>) => void;
  onTrades: (trades: TradeTick[]) => void;
  onMarkPrice?: (mp: NonNullable<ParsedWsEvent['markPrice']>) => void;
  onStatus: (status: WsConnectionStatus, tickAt?: number) => void;
}

export function createSodexPerpStream(cb: SodexStreamCallbacks): () => void {
  const endpoint = NETWORK_CONFIG[cb.network].wsPerpsUrl;
  let ws: WebSocket | null = null;
  let closedByClient = false;
  let reconnectTimer: number | null = null;
  let retryDelayMs = 1500;

  const connect = () => {
    if (closedByClient) return;
    cb.onStatus('CONNECTING');
    try {
      ws = new WebSocket(endpoint);
    } catch {
      cb.onStatus('FALLBACK');
      return;
    }

    ws.onopen = () => {
      retryDelayMs = 1500;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ op: 'subscribe', params: { channel: 'l2Book', symbol: cb.symbol } }));
      ws.send(JSON.stringify({ op: 'subscribe', params: { channel: 'trade', symbols: [cb.symbol] } }));
      ws.send(
        JSON.stringify({ op: 'subscribe', params: { channel: 'markPrice', symbols: [cb.symbol] } }),
      );
    };

    ws.onmessage = (ev) => {
      if (closedByClient) return;
      const parsed = parseSodexWsMessage(String(ev.data));
      if (parsed.kind === 'l2Book' && parsed.l2Book) {
        cb.onL2Book({
          bids: parsed.l2Book.bids,
          asks: parsed.l2Book.asks,
          updateID: parsed.l2Book.updateID,
          blockTime: parsed.l2Book.eventTime,
        });
        cb.onStatus('STREAMING', Date.now());
      } else if (parsed.kind === 'trade' && parsed.trades) {
        cb.onTrades(parsed.trades);
        cb.onStatus('STREAMING', Date.now());
      } else if (parsed.kind === 'markPrice' && parsed.markPrice) {
        cb.onMarkPrice?.(parsed.markPrice);
        cb.onStatus('STREAMING', Date.now());
      }
    };

    ws.onerror = () => {
      if (!closedByClient) cb.onStatus('FALLBACK');
    };

    ws.onclose = () => {
      if (closedByClient) return;
      cb.onStatus('FALLBACK');
      reconnectTimer = window.setTimeout(() => {
        retryDelayMs = Math.min(12_000, retryDelayMs * 1.6);
        connect();
      }, retryDelayMs);
    };
  };

  connect();

  return () => {
    closedByClient = true;
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    if (ws) {
      try {
        ws.close();
      } catch {
        // ignore close errors
      }
    }
  };
}
