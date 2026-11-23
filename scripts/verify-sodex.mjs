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

console.log(`\nSummary: ${passed}/${PROBES.length} live endpoints verified.`);
if (passed !== PROBES.length) process.exit(1);
