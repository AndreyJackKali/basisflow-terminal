#!/usr/bin/env node
/**
 * Reproducible live API verifier for SoDEX Mainnet, SoDEX Testnet & ValueChain L1 RPC.
 * Zero authentication required. Prints exact HTTP statuses, latencies, and record counts.
 */

const PROBES = [
  { name: 'SoDEX Mainnet Perps Symbols', url: 'https://mainnet-gw.sodex.dev/api/v1/perps/markets/symbols' },
  { name: 'SoDEX Mainnet Perps Tickers', url: 'https://mainnet-gw.sodex.dev/api/v1/perps/markets/tickers' },
  { name: 'SoDEX Mainnet Perps Mark Prices', url: 'https://mainnet-gw.sodex.dev/api/v1/perps/markets/mark-prices' },
  { name: 'SoDEX Mainnet Perps BookTickers', url: 'https://mainnet-gw.sodex.dev/api/v1/perps/markets/bookTickers' },
  { name: 'SoDEX Mainnet BTC-USD Orderbook', url: 'https://mainnet-gw.sodex.dev/api/v1/perps/markets/BTC-USD/orderbook?limit=10' },
  { name: 'SoDEX Mainnet BTC-USD Klines (1h)', url: 'https://mainnet-gw.sodex.dev/api/v1/perps/markets/BTC-USD/klines?interval=1h&limit=24' },
  { name: 'SoDEX Mainnet BTC-USD Trades', url: 'https://mainnet-gw.sodex.dev/api/v1/perps/markets/BTC-USD/trades?limit=20' },
  { name: 'SoDEX Mainnet Spot Symbols', url: 'https://mainnet-gw.sodex.dev/api/v1/spot/markets/symbols' },
  { name: 'SoDEX Mainnet Spot Tickers', url: 'https://mainnet-gw.sodex.dev/api/v1/spot/markets/tickers' },
  { name: 'SoDEX Mainnet Spot vBTC_vUSDC L2 Orderbook', url: 'https://mainnet-gw.sodex.dev/api/v1/spot/markets/vBTC_vUSDC/orderbook?limit=20' },
  { name: 'SoDEX Testnet Perps Mark Prices', url: 'https://testnet-gw.sodex.dev/api/v1/perps/markets/mark-prices' },
  {
    name: 'ValueChain Mainnet RPC (eth_blockNumber)',
    url: 'https://mainnet.valuechain.xyz',
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
  },
  {
    name: 'ValueChain Testnet RPC (eth_blockNumber)',
    url: 'https://testnet.valuechain.xyz',
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
  },
];

let passed = 0;
console.log('=== BasisFlow Terminal — Live SoDEX & ValueChain Verification ===\n');

for (const probe of PROBES) {
  const t0 = Date.now();
  try {
    const res = await fetch(probe.url, {
      method: probe.method || 'GET',
      headers: {
        'User-Agent': 'BasisFlowTerminal/1.0',
        ...(probe.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: probe.body,
    });
    const ms = Date.now() - t0;
    const json = await res.json();
    let detail = '';
    if (Array.isArray(json?.data)) {
      detail = `${json.data.length} records`;
    } else if (json?.data?.blockHeight) {
      detail = `blockHeight=${json.data.blockHeight}, bids=${json.data.bids?.length}`;
    } else if (json?.result) {
      detail = `block=${parseInt(json.result, 16)} (${json.result})`;
    }
    if (res.ok) {
      passed += 1;
      console.log(`PASS | HTTP ${res.status} | ${String(ms).padStart(4)}ms | ${probe.name} (${detail})`);
    } else {
      console.log(`FAIL | HTTP ${res.status} | ${String(ms).padStart(4)}ms | ${probe.name}`);
    }
  } catch (err) {
    console.log(`FAIL | ERR      | ${probe.name} — ${err.message}`);
  }
}

// Live WebSocket 500ms l2Book verification
const wsPassed = await new Promise((resolve) => {
  const t0 = Date.now();
  let done = false;
  const finish = (ok, detail) => {
    if (done) return;
    done = true;
    const ms = Date.now() - t0;
    console.log(`${ok ? 'PASS' : 'FAIL'} | WS  101 | ${String(ms).padStart(4)}ms | SoDEX Mainnet Perps WebSocket l2Book (${detail})`);
    resolve(ok);
  };
  try {
    const ws = new WebSocket('wss://mainnet-gw.sodex.dev/ws/perps');
    const timer = setTimeout(() => { try { ws.close(); } catch {} finish(false, 'timeout'); }, 5000);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ op: 'subscribe', params: { channel: 'l2Book', symbol: 'BTC-USD' } }));
    });
    ws.addEventListener('message', (ev) => {
      try {
        const j = JSON.parse(String(ev.data));
        if (j.channel === 'l2Book' && j.data?.b?.length > 0 && j.data?.a?.length > 0) {
          clearTimeout(timer);
          ws.close();
          finish(true, `updateID=${j.data.u}, bids=${j.data.b.length}, asks=${j.data.a.length}`);
        }
      } catch {}
    });
    ws.addEventListener('error', () => { clearTimeout(timer); finish(false, 'ws error'); });
  } catch (err) {
    finish(false, err.message);
  }
});

const totalProbes = PROBES.length + 1;
const totalPassed = passed + (wsPassed ? 1 : 0);
console.log(`\nSummary: ${totalPassed}/${totalProbes} live REST/RPC/WebSocket endpoints verified.`);
if (totalPassed !== totalProbes) process.exit(1);
