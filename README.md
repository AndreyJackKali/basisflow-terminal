# BasisFlow Terminal (v1.6.0)

**Institutional Funding-Basis, 500ms Live WebSocket L2 Microstructure, Carry-Trade & Liquidation Stress Engine, Delta-Neutral Hedge Builder, Empirical Bootstrap Monte Carlo Risk Desk, 60-Second Guided Judge Tour & Live SoSoValue OpenAPI v1 Intelligence**  
Built for **SoSoValue × ValueChain × SoDEX WaveHack (Wave 3)**

- **Live Terminal (Zero-Auth, Loads Real SoDEX Mainnet + 500ms WS L2 + Live Verified SoSoValue Snapshot Immediately):** https://andreyjackkali.github.io/basisflow-terminal/
- **Judge Presentation & Architecture Brief (24/24 Endpoints + Zero-Leak Diagram + Benchmarks):** https://andreyjackkali.github.io/basisflow-terminal/judge-brief.html
- **Interactive 8-Slide Pitch Deck:** https://andreyjackkali.github.io/basisflow-terminal/deck.html
- **60s Narrated HD Walkthrough Video:** https://andreyjackkali.github.io/basisflow-terminal/demo.mp4 (and [`docs/demo.mp4`](docs/demo.mp4))
- **Repository:** https://github.com/AndreyJackKali/basisflow-terminal

![BasisFlow Terminal Live Preview](docs/preview.png)

---

## Why BasisFlow Exists

Solo on-chain traders operating across **SoDEX's 107 perpetual markets and 48 spot markets** (spanning crypto, commodities like `XAUT`, and tokenized equities like `NVDA`, `AAPL`, `TSLA`, `MSFT`, `GOOGL`, `AMD`, `TSM`, `SKHX`) face three concrete operational problems:

1. **Fragmented Basis & Carry Discovery:** Funding rates accrue hourly (`fundingInterval: 3600s`) and **29–31 assets trade simultaneously on both SoDEX Spot (`vBTC_vUSDC`, `vNVDA_vUSDC`, etc.) and SoDEX Perps (`BTC-USD`, `NVDA-USD`)**, creating live Spot-vs-Perp basis dislocations invisible on a standard chart.
2. **Hidden 2-Leg Execution Slippage:** Quoted top-of-book spreads hide depth depletion on both Spot and Perp orderbooks. Without sweeping BOTH live L2 books before sizing a Spot↔Perp hedge, traders routinely give back weeks of funding carry in entry/exit slippage and fees.
3. **Unchecked Risk & Opaque Wrappers:** Traders do not need another generic chat wrapper or mocked dashboard — they need **500ms live orderbook streaming**, **deterministic quantitative scoring**, **fail-closed pre-trade risk guardrails**, and **radical data honesty**.

---

## Live Application Walkthrough

| Tab 1: Live Basis & Carry Scanner (107 Perps + 31 Spot↔Perp Pairs) | Tab 2: 500ms WebSocket L2 Microstructure & Regime Classifier |
|---|---|
| ![Scanner Tab](docs/screen_scanner.png) | ![Microstructure Tab](docs/screen_micro.png) |

| Tab 3: Fail-Closed Risk Gate & EIP-712 Execution Desk | Multi-Leg Spot↔Perp Delta-Neutral Hedge & Net Carry Builder |
|---|---|
| ![Execution Desk](docs/screen_execution.png) | ![Delta-Neutral Hedge Builder](docs/screen_hedge.png) |

| Empirical Bootstrap Monte Carlo (1,000 Paths) & Tail-Stress Matrix | Tab 4: Native SoSoValue OpenAPI v1 Hub (BYOK) |
|---|---|
| ![Monte Carlo VaR/CVaR & Tail-Stress](docs/screen_montecarlo.png) | ![SoSoValue OpenAPI Hub](docs/screen_soso.png) |

| Clickable Radical Data Honesty API Console | HD Product Walkthrough Video |
|---|---|
| ![API Console Drawer](docs/screen_console.png) | [`docs/demo.mp4`](docs/demo.mp4) (1080p MP4 — full 4-tab live walkthrough) |

---

## Core Architecture & Features

### 1. Radical Data Honesty, 500ms WebSocket Telemetry & Live API Console
- Zero mocked or fabricated numbers disguised as live data.
- Header telemetry bar displays live **SoDEX Mainnet / Testnet** switch, real-time **`WS: N ticks`** WebSocket counter (`wss://mainnet-gw.sodex.dev/ws/perps`), **ValueChain L1 Block Height** (`eth_blockNumber`), and clickable **`LIVE` / `BYOK` / `OFFLINE`** source badges.
- Clicking any badge or **API Console** opens a live inspection drawer logging every real HTTP request, status code, latency (`ms`), row count, and raw JSON payload snippet.
- **Data-quality gates (v1.5.1–v1.6.0):** Spot↔Perp gaps wider than `1,500 bps` are flagged **`STALE SPOT`** (illiquid/stale spot print) and excluded from basis scoring instead of being ranked as a fake arbitrage; markets under `$1M` 24h volume are flagged **`THIN BOOK`** with conviction capped at `55`, the headline *Peak Tradable Carry* KPI only considers markets with executable size, and v1.6.0 adds a live **Data-Quality Guard Strip** with 1-click alert inspection (`37/37` Vitest tests PASS).
- **1-Click 60-Second Guided Judge Tour & Judge Architecture Brief (v1.6.0):** Click **`60s Judge Tour`** in the top bar to step interactively across (1) Live SoSoValue ETF Flow & Basis Regimes, (2) Institutional Carry-Trade & Liquidation Stress Simulator, (3) Thin-Book & Anomaly Quality Guards, and (4) 1-click Trade Ticket JSON & CSV exports — paired with [`judge-brief.html`](https://andreyjackkali.github.io/basisflow-terminal/judge-brief.html).

### 2. Tab 1 — Live Basis & Carry Scanner (107 Perps + 48 Spot + Joined Spot↔Perp Pairs)
- Consumes 6 live SoDEX Mainnet/Testnet REST endpoints simultaneously (`/perps/markets/symbols`, `/tickers`, `/mark-prices`, `/bookTickers`, `/spot/markets/symbols`, `/spot/markets/tickers`).
- Automatically joins all overlapping **Spot↔Perp assets** (Crypto + Tokenized Equities + Commodities) to calculate:
  - Exact **Annualized Funding Carry APR (%)** using each contract's live `fundingInterval` (`3600s` → `8,760` periods/year).
  - **Mark-vs-Index Basis (bps)** and **Live Spot-vs-Perp Arbitrage Spread (bps)**.
  - **Transparent 0–100 Sigmoid Quant Conviction Score:** `σ(0.38·zFunding + 0.24·zBasis + 0.22·zLiquidity + 0.10·zMomentum + 0.06·|zETF|)` with per-factor z-score attribution.

### 3. Tab 2 — Real-Time 500ms WebSocket L2 Microstructure, Regime Classifier & Exact Slippage Forensics
- **Native SoDEX WebSocket Client (`src/lib/ws.ts`):** Connects directly to `wss://mainnet-gw.sodex.dev/ws/perps` (and `testnet-gw.sodex.dev/ws/perps` on Testnet) subscribing to `l2Book` (500ms snapshots), `trade`, and `markPrice` channels with Pause/Resume control and automatic exponential-backoff reconnect.
- Interactive SVG **OHLCV Candlestick Chart** (`/klines`, `15m / 1h / 4h / 1d`) with **EMA-9 / EMA-21** overlays and an automated **Market Regime Classifier** (`UPTREND` / `DOWNTREND` / `CHOP` via EMA slope, ATR-14%, and Kaufman Efficiency Ratio).
- Live **L2 Depth Chart** with Top-10 Bid/Ask Imbalance %, **Exact L2 Slippage Simulator** (`$1k / $10k / $50k / $250k` or custom notional), and live **Trade Tape** with aggressor flow meter.

### 4. Tab 3 — Fail-Closed Pre-Trade Risk Desk, Multi-Leg Delta-Neutral Hedge Builder & Counterfactual Ledger
- **6 Fail-Closed Risk Guardrails** (blocks execution if any hard rule fails):
  1. Global **Kill Switch**
  2. Stop-Loss Geometry & Liquidation Buffer (computed from each contract's live `marginTiers` maintenance margin rate)
  3. SoDEX Contract `maxLeverage` Cap
  4. Live L2 Slippage & Top-of-Book Spread Gate
  5. SoDEX `minNotional` & Gross Exposure Cap
  6. Daily Drawdown Circuit Breaker
- **Institutional Carry-Trade & Liquidation Stress-Test Calculator (`CarryStressCalculatorCard`, v1.6.0):** Select BTC/ETH/SOL/XRP (or any of the 107 SoDEX perps), configure notional, leverage, holding horizon, fee/slippage bps, borrow drag, and funding decay → computes **Net Annualized Carry APY & Collateral ROE**, **Break-Even Days**, **Liquidation Price & Buffer** (from live contract `marginTiers`), a **5-Tier Funding-Flip Drawdown Sensitivity Matrix**, live **SoSoValue ETF-Flow Confirmation**, and 1-click **Trade Ticket JSON / Stress CSV** exports.
- **Multi-Leg Spot↔Perp Delta-Neutral Hedge & Net Carry Builder (`DeltaNeutralHedgeCard`):** Fetches BOTH live **SoDEX Spot L2** (`/api/v1/spot/markets/{pair}/orderbook?limit=20`) and **SoDEX Perp L2** books to compute true **2-leg round-trip slippage + maker/taker fees**, **Net Carry APR (%)**, **Breakeven Holding Hours**, an edge verdict (`POSITIVE EDGE` / `THIN EDGE` / `NEGATIVE AFTER COSTS`), and a 1-click **Atomic 2-Leg Hedge Plan JSON**.
- **Empirical Bootstrap Monte Carlo & Tail-Stress Risk Engine (`MonteCarloStressCard`, v1.2.0):** Runs **1,000 deterministic seeded paths** (`24h / 72h / 168h`) bootstrapped directly from live SoDEX `/klines` realized log-returns (zero synthetic assumptions) to compute **95% VaR**, **99% CVaR (Expected Shortfall)**, **Liquidation Probability**, **TP/SL Hit Rates**, an SVG **P10–P90 Equity Fan Chart**, and a **4-Scenario Deterministic Tail-Stress Matrix** (`-10% Flash Crash`, `+10% Short Squeeze`, `-20% Extreme Tail`, `Funding Flip -2x`) with 1-click **Risk Audit JSON** and **Scanner CSV** exports.
- **One-Person On-Chain Finance Business Desk & x402 Signal Publisher (`SoloDeskBusinessCard`, v1.5.0):** Models live unit economics across three solo-operator revenue lines — a high-water-mark Carry Vault (management + performance fees anchored to live top-5 SoDEX carry APR), USDC paid research subscriptions, and per-call x402 agent API feeds — with Client Net APR vs. 4.5% T-Bill alpha, breakeven subscriber count, and 1-click live Markdown Client Brief + x402 JSON export.
- Outputs a **non-custodial deterministic SoDEX EIP-712 `PerpOrder` payload** (1-click Copy JSON + 1-click Launch on SoDEX), persistent **`localStorage` Mark-to-Market Paper Ledger**, and **Counterfactual Risk-Gate Equity Curve**.

### 5. Tab 4 — Institutional ETF & SSI Flow Intelligence (Live SoSoValue OpenAPI v1 — v1.3.0)
- **Zero-Secret Hybrid Live Architecture:**
  - **Live Proxy (`server/soso-proxy.mjs`):** Zero-dependency Node ESM HTTP proxy reading `process.env.SOSO_API_KEY` from environment (CORS-enabled, 60s TTL cache, per-IP rate limiting, default port `9105`, strict `/openapi/v1/*` allowlist).
  - **Verified Live Snapshot (`public/data/soso-snapshot.json`):** Populated directly via `scripts/fetch-soso-snapshot.mjs` from **24 verified live SoSoValue OpenAPI v1 endpoints** (zero credentials bundled) so the public GitHub Pages deployment loads real US Spot BTC/ETH/SOL/XRP ETF flows, all 13 SSI Crypto Indices, Market Overview, Hot News, and Corporate BTC Treasuries immediately on page load!
  - **In-Memory Direct Key (RAM-only BYOK):** Judges can optionally connect to a local/custom `soso-proxy` URL or enter a RAM-only `x-soso-api-key` (never saved to `localStorage` or disk), with seamless fallback to the verified live snapshot.
- **Cross-Venue ETF Flow × SoDEX Funding/Basis Matrix:** Joins live SoSoValue US Spot ETF net inflows/outflows (30d Flow Z-Score, 5d Cumulative Flow, AUM) directly against live SoDEX Perp Funding APR (%), Mark-Index Basis (bps), and Spot↔Perp Spread (bps) to classify actionable divergence & accumulation regimes, plus maps all **13 live SSI sector indices** (`ssiMAG7`, `ssiDeFi`, `ssiAI`, `ssiLayer1`, `ssiRWA`, `ssiMeme`, etc.) to overlapping SoDEX Perp sector funding averages.

---

## Reproducible Verification (CLI, Proxy & Unit Tests)

```bash
npm install
npm test                    # 37/37 Vitest unit & regression tests (funding APR, basis bps, L2 slippage, regime, fail-closed risk gates, carry-trade & liquidation stress calculator, 2-leg delta-neutral carry, WS parser, Monte Carlo VaR/CVaR, CSV export, SoSoValue ETF Z-score, ETF/SSI cross-check, data-quality gates, Solo Desk economics, snapshot schema & zero-secret leak audit)
npm run verify:sodex        # 14/14 live REST, ValueChain RPC & 500ms WebSocket l2Book endpoints verified (zero auth required)
npm run verify:soso         # Verifies SoSoValue OpenAPI v1 CORS & auth contract (pass SOSO_API_KEY=... for 7/7 live 200 OK)
SOSO_API_KEY=... npm run soso:proxy     # Starts zero-dep CORS/cached/rate-limited SoSoValue proxy on http://127.0.0.1:9105
SOSO_API_KEY=... npm run soso:snapshot  # Refreshes sanitized public/data/soso-snapshot.json from 24 live v1 endpoints
npm run build               # TypeScript strict check + Vite production bundle
```

---

## Wave 4–5 Roadmap
- **Wave 4:** Automated funding-flip & basis-dislocation webhook alerts (Telegram/Discord), multi-asset portfolio correlation matrix across tokenized equities & crypto, and live Spot WebSocket L2 orderbook streaming (`wss://mainnet-gw.sodex.dev/ws/spot`).
- **Wave 5:** WalletConnect / EIP-712 client-side signing directly into SoDEX Testnet & Mainnet order submission with post-trade execution quality attribution (quoted vs. realized fill slippage).
