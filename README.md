# BasisFlow Terminal

**Institutional Funding-Basis, L2 Microstructure & Risk-Gated Execution Desk for Solo On-Chain Traders**  
Built for **SoSoValue × ValueChain × SoDEX WaveHack (Wave 3)**

- **Live Demo (Zero-Auth, Loads Real SoDEX Mainnet Data Immediately):** https://andreyjackkali.github.io/basisflow-terminal/
- **Repository:** https://github.com/AndreyJackKali/basisflow-terminal

![BasisFlow Terminal Live Preview](docs/preview.png)

---

## Why BasisFlow Exists

Solo on-chain traders operating across **SoDEX's 107 perpetual markets and 48 spot markets** (spanning crypto, commodities like `XAUT`, and tokenized equities like `NVDA`, `AAPL`, `TSLA`, `MSFT`, `GOOGL`) face three concrete operational problems:

1. **Fragmented Basis & Carry Discovery:** Funding rates accrue hourly (`fundingInterval: 3600s`) and **31 assets trade simultaneously on both SoDEX Spot (`vBTC_vUSDC`, `vNVDA_vUSDC`, etc.) and SoDEX Perps (`BTC-USD`, `NVDA-USD`)**, creating live Spot-vs-Perp basis dislocations that are invisible on a standard price chart.
2. **Hidden L2 Execution Slippage:** Quoted top-of-book spreads hide real depth depletion on mid-cap crypto and tokenized equities. Without sweeping the actual L2 orderbook levels before sizing, traders routinely give back their entire funding carry in entry slippage.
3. **Unchecked Risk & Opaque AI Wrappers:** Traders do not need another generic chat wrapper or mocked dashboard — they need **deterministic, auditable quantitative scoring**, **fail-closed pre-trade risk guardrails**, and **radical data honesty**.

---

## Core Architecture & Features

### 1. Radical Data Honesty & Live API Verification Console
- Zero mocked or fabricated numbers disguised as live data.
- Header telemetry bar shows live **SoDEX Mainnet / Testnet** switch, **ValueChain L1 Block Height** (`eth_blockNumber`), and clickable **`LIVE` / `BYOK` / `OFFLINE`** source badges.
- Clicking any badge or **API Console** opens a live inspection drawer logging every real HTTP request, status code, latency (`ms`), row count, and raw JSON payload snippet.

### 2. Tab 1 — Live Basis & Carry Scanner (107 Perps + 48 Spot + 31 Joined Pairs)
- Consumes 6 live SoDEX Mainnet/Testnet REST endpoints simultaneously (`/perps/markets/symbols`, `/tickers`, `/mark-prices`, `/bookTickers`, `/spot/markets/symbols`, `/spot/markets/tickers`).
- Automatically joins all **31 Spot↔Perp overlapping assets** (Crypto + Tokenized Equities + Commodities) to calculate:
  - Exact **Annualized Funding Carry APR (%)** using each contract's real `fundingInterval` (`3600s` → `8,760` periods/year).
  - **Mark-vs-Index Basis (bps)** and **Live Spot-vs-Perp Arbitrage Spread (bps)**.
  - **Transparent 0–100 Sigmoid Quant Conviction Score:** `σ(0.38·zFunding + 0.24·zBasis + 0.22·zLiquidity + 0.10·zMomentum + 0.06·|zETF|)` with per-factor z-score attribution.

### 3. Tab 2 — L2 Microstructure, Regime Classifier & Exact Slippage Forensics
- Interactive SVG **OHLCV Candlestick Chart** (`/klines`, `15m / 1h / 4h / 1d`) with **EMA-9 / EMA-21** overlays and an automated **Market Regime Classifier** (`UPTREND` / `DOWNTREND` / `CHOP` via EMA slope, ATR-14%, and Kaufman Efficiency Ratio).
- Live **L2 Depth Chart** (`/orderbook?limit=20`) with Top-10 Bid/Ask Imbalance % and on-chain SoDEX `blockHeight`.
- **Exact L2 Slippage Simulator:** Sweeps real live L2 levels for any notional (`$1k / $10k / $50k / $250k` or custom) to calculate exact **VWAP fill price**, **slippage in bps**, and **levels consumed**.
- Live **Trade Tape** (`/trades?limit=40`) with Buy/Sell aggressor flow meter.

### 4. Tab 3 — Fail-Closed Pre-Trade Risk Desk, EIP-712 Order Payload & Counterfactual Ledger
- **6 Fail-Closed Risk Guardrails** (blocks execution if any hard rule fails):
  1. Global **Kill Switch**
  2. Stop-Loss Geometry & Liquidation Buffer (computed from each contract's live `marginTiers` maintenance margin rate)
  3. SoDEX Contract `maxLeverage` Cap
  4. Live L2 Slippage & Top-of-Book Spread Gate
  5. SoDEX `minNotional` & Gross Exposure Cap
  6. Daily Drawdown Circuit Breaker
- Outputs a **non-custodial deterministic SoDEX EIP-712 `PerpOrder` payload** (1-click Copy JSON + 1-click Launch on SoDEX) plus a **`localStorage` Paper Portfolio Ledger** with live Mark-to-Market PnL and a **Counterfactual Risk-Gate Equity Curve** (comparing Risk-Gated performance vs. an ungated 2.5× oversized / high-slippage counterfactual).

### 5. Tab 4 — Native SoSoValue OpenAPI v1 Intelligence Hub (BYOK)
- Native browser CORS integration with `https://openapi.sosovalue.com/openapi/v1/*`:
  - `/etfs/summary-history?type=us-btc-spot` (computes 30d ETF net-flow z-score and feeds it directly into Tab 1 Conviction)
  - `/indices` (SoSoValue SSI indices)
  - `/news/hot` (real-time catalyst headlines)
  - `/btc-treasuries` (corporate treasury tracking paired with SoDEX equity perps)
- Supports **Bring-Your-Own-Key (`x-soso-api-key`)** stored only in browser `localStorage`, plus a 1-click **`Test Live CORS & Auth Gate`** button.

---

## Reproducible Verification (CLI & Tests)

```bash
npm install
npm test              # Runs Vitest unit suite (funding APR, basis bps, L2 slippage, regime, fail-closed risk gates)
npm run verify:sodex  # Live probes 12 SoDEX Mainnet/Testnet & ValueChain L1 RPC endpoints (no key needed)
npm run verify:soso   # Verifies SoSoValue OpenAPI v1 CORS & auth contract (pass SOSO_API_KEY=... for live 200 OK)
npm run build         # TypeScript strict check + Vite production bundle
```

---

## Wave 4–5 Roadmap
- **Wave 4:** Real-time WebSocket streaming (`wss://mainnet-gw.sodex.dev/ws/perps` & `/ws/spot`) with sub-second L2 diff updates, automated basis-alert webhook notifications, and multi-leg Spot-Perp delta-neutral hedge builder.
- **Wave 5:** WalletConnect / EIP-712 client-side signing directly into SoDEX Testnet & Mainnet order submission with post-trade execution quality attribution (quoted vs. realized fill slippage).
