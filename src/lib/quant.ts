import type {
  AssetClass,
  ConvictionBreakdown,
  DeltaNeutralHedgeInput,
  DeltaNeutralHedgeResult,
  EnrichedMarket,
  KlineBar,
  PaperTrade,
  PerpMarkPrice,
  PerpSymbolInfo,
  PerpTicker,
  BookTicker,
  RegimeResult,
  RiskEvaluationInput,
  RiskEvaluationResult,
  RiskGateCheck,
  SignalDirection,
  SlippageResult,
  SpotSymbolInfo,
  SpotTicker,
} from '../types';

const EQUITY_BASE_COINS = new Set([
  'AAPL', 'AMZN', 'AMD', 'ASML', 'BABA', 'COIN', 'CRCL', 'CXMT', 'GOOGL', 'HOOD', 'INTC',
  'META', 'MSFT', 'MSTR', 'MU', 'NFLX', 'NVDA', 'ORCL', 'PLTR', 'QQQ',
  'RDDT', 'SAMSUNG', 'SKHX', 'SMCI', 'SONY', 'SPCX', 'SPY', 'TSLA', 'TSM', 'UBER', 'ARM', 'AVGO',
  'CRWD', 'LITE', 'SNDK', 'STX', 'WDC', 'GLD', 'SLV', 'CRWV', 'NBIS',
]);

const COMMODITY_BASE_COINS = new Set([
  'XAU', 'XAUT', 'PAXG', 'GOLD', 'SILVER', 'XAG', 'WTI', 'OIL', 'BRENT', 'COPPER', 'NGAS',
]);

export function classifyAsset(baseCoin: string): AssetClass {
  const clean = baseCoin.toUpperCase().replace(/^V(?=[A-Z]{2,})/, '');
  if (COMMODITY_BASE_COINS.has(clean)) return 'Commodity';
  if (EQUITY_BASE_COINS.has(clean)) return 'Tokenized Equity';
  return 'Crypto';
}

export function safeNum(val: unknown, fallback = 0): number {
  const n = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Computes annualized funding APR in percent.
 * SoDEX contracts carry fundingInterval in seconds (typically 3600 = 1h => 8760 periods/year).
 */
export function computeAnnualizedFundingApr(fundingRate: number, fundingIntervalSec = 3600): number {
  if (!Number.isFinite(fundingRate) || !Number.isFinite(fundingIntervalSec) || fundingIntervalSec <= 0) {
    return 0;
  }
  const periodsPerYear = (365 * 24 * 3600) / fundingIntervalSec;
  return fundingRate * periodsPerYear * 100;
}

export function computeBasisBps(markPrice: number, indexPrice: number): number {
  if (markPrice <= 0 || indexPrice <= 0) return 0;
  return ((markPrice - indexPrice) / indexPrice) * 10_000;
}

export function computeSpotPerpSpreadBps(perpMark: number, spotPrice: number): number {
  if (perpMark <= 0 || spotPrice <= 0) return 0;
  return ((perpMark - spotPrice) / spotPrice) * 10_000;
}

export function computeBidAskSpreadBps(bidPx: number, askPx: number): number {
  if (bidPx <= 0 || askPx <= 0 || askPx < bidPx) return 0;
  const mid = (bidPx + askPx) / 2;
  return ((askPx - bidPx) / mid) * 10_000;
}

export function sigmoidScore(z: number): number {
  const clamped = Math.max(-6, Math.min(6, z));
  return Math.round((100 / (1 + Math.exp(-clamped))) * 10) / 10;
}

function meanStd(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 1 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  return { mean, std: std > 1e-9 ? std : 1 };
}

function zScore(value: number, mean: number, std: number): number {
  return Math.max(-3.5, Math.min(3.5, (value - mean) / (std > 1e-9 ? std : 1)));
}

export function normalizeSpotBase(baseCoin: string): string {
  // SoDEX spot coins use prefix 'v' (e.g. vBTC, vGOOGL, vXAUt)
  const stripped = baseCoin.startsWith('v') || baseCoin.startsWith('V') ? baseCoin.slice(1) : baseCoin;
  return stripped.toUpperCase();
}

export function enrichMarkets(
  perpSymbols: PerpSymbolInfo[],
  perpTickers: PerpTicker[],
  perpMarks: PerpMarkPrice[],
  perpBooks: BookTicker[],
  spotSymbols: SpotSymbolInfo[],
  spotTickers: SpotTicker[],
  etfFlowZScore = 0,
): EnrichedMarket[] {
  const tickerMap = new Map(perpTickers.map((t) => [t.symbol, t]));
  const markMap = new Map(perpMarks.map((m) => [m.symbol, m]));
  const bookMap = new Map(perpBooks.map((b) => [b.symbol, b]));
  const spotTickerMap = new Map(spotTickers.map((t) => [t.symbol, t]));

  // Map normalized base coin -> spot market info & ticker
  const spotByBase = new Map<string, { sym: SpotSymbolInfo; ticker: SpotTicker }>();
  for (const s of spotSymbols) {
    const t = spotTickerMap.get(s.name);
    if (t && safeNum(t.lastPx) > 0) {
      spotByBase.set(normalizeSpotBase(s.baseCoin), { sym: s, ticker: t });
    }
  }

  const prelim = perpSymbols
    .filter((c) => c.status === 'TRADING')
    .map((contract) => {
      const mark = markMap.get(contract.name);
      const ticker = tickerMap.get(contract.name);
      const book = bookMap.get(contract.name);

      const markPrice = safeNum(mark?.markPrice ?? ticker?.lastPx);
      const indexPrice = safeNum(mark?.indexPrice ?? markPrice);
      const lastPrice = safeNum(ticker?.lastPx ?? markPrice);
      const fundingRate = safeNum(mark?.fundingRate ?? ticker?.fundingRate);
      const fundingIntervalSec = safeNum(contract.fundingInterval, 3600);
      const annualizedFundingApr = computeAnnualizedFundingApr(fundingRate, fundingIntervalSec);
      const markIndexBasisBps = computeBasisBps(markPrice, indexPrice);

      const bidPx = safeNum(book?.bidPx ?? ticker?.bidPx);
      const askPx = safeNum(book?.askPx ?? ticker?.askPx);
      const spreadBps = computeBidAskSpreadBps(bidPx, askPx);

      const quoteVolume24h = safeNum(ticker?.quoteVolume);
      const openInterestCoins = safeNum(mark?.openInterest);
      const openInterestUsd = openInterestCoins * markPrice;
      const oiToVolumeRatio = quoteVolume24h > 0 ? openInterestUsd / quoteVolume24h : 0;
      const changePct24h = safeNum(ticker?.changePct);

      const spotMatch = spotByBase.get(contract.baseCoin.toUpperCase());
      const spotPrice = spotMatch ? safeNum(spotMatch.ticker.lastPx) : null;
      const spotPerpSpreadBps =
        spotPrice && markPrice > 0 ? computeSpotPerpSpreadBps(markPrice, spotPrice) : null;

      return {
        symbol: contract.name,
        baseCoin: contract.baseCoin,
        assetClass: classifyAsset(contract.baseCoin),
        contract,
        markPrice,
        indexPrice,
        lastPrice,
        changePct24h,
        quoteVolume24h,
        openInterestCoins,
        openInterestUsd,
        oiToVolumeRatio,
        fundingRate,
        fundingIntervalSec,
        annualizedFundingApr,
        markIndexBasisBps,
        bidPx,
        askPx,
        spreadBps,
        nextFundingTime: safeNum(mark?.nextFundingTime ?? ticker?.nextFundingTime),
        spotSymbol: spotMatch ? spotMatch.sym.name : null,
        spotDisplayName: spotMatch ? spotMatch.sym.displayName : null,
        spotPrice,
        spotVolume24h: spotMatch ? safeNum(spotMatch.ticker.quoteVolume) : null,
        spotPerpSpreadBps,
      };
    })
    .filter((m) => m.markPrice > 0);

  // Cross-sectional stats for transparent z-score normalization
  const absFundingStats = meanStd(prelim.map((m) => Math.abs(m.annualizedFundingApr)));
  const absBasisStats = meanStd(
    prelim.map((m) => Math.abs(m.spotPerpSpreadBps ?? m.markIndexBasisBps)),
  );
  const logVolStats = meanStd(prelim.map((m) => Math.log10(Math.max(10, m.quoteVolume24h))));
  const spreadStats = meanStd(prelim.map((m) => Math.min(200, m.spreadBps || 25)));
  const momStats = meanStd(prelim.map((m) => Math.abs(m.changePct24h)));

  return prelim.map((m) => {
    const fundingZ = zScore(Math.abs(m.annualizedFundingApr), absFundingStats.mean, absFundingStats.std);
    const effectiveBasis = Math.abs(m.spotPerpSpreadBps ?? m.markIndexBasisBps);
    const basisZ = zScore(effectiveBasis, absBasisStats.mean, absBasisStats.std);
    const volZ = zScore(Math.log10(Math.max(10, m.quoteVolume24h)), logVolStats.mean, logVolStats.std);
    const tightSpreadZ = -zScore(Math.min(200, m.spreadBps || 25), spreadStats.mean, spreadStats.std);
    const liquidityZ = 0.65 * volZ + 0.35 * tightSpreadZ;
    const momentumZ = zScore(Math.abs(m.changePct24h), momStats.mean, momStats.std);
    const etfFactor = m.assetClass === 'Crypto' ? Math.max(-2, Math.min(2, etfFlowZScore)) : 0;

    // Weighted composite z-score (funding carry + basis dislocation + execution liquidity + momentum + optional SoSo ETF overlay)
    const compositeZ =
      0.38 * fundingZ +
      0.24 * basisZ +
      0.22 * liquidityZ +
      0.10 * momentumZ +
      0.06 * Math.abs(etfFactor);

    const score = sigmoidScore(compositeZ);

    let direction: SignalDirection = 'NEUTRAL';
    let rationale = 'Balanced funding and tight mark-to-index parity.';

    if (m.spotPerpSpreadBps !== null && Math.abs(m.spotPerpSpreadBps) >= 18) {
      direction = 'BASIS ARB';
      rationale =
        m.spotPerpSpreadBps > 0
          ? `Perp trades +${m.spotPerpSpreadBps.toFixed(1)} bps above SoDEX spot (${m.spotDisplayName}); cash-and-carry short perp / long spot edge.`
          : `Perp trades ${m.spotPerpSpreadBps.toFixed(1)} bps below SoDEX spot (${m.spotDisplayName}); reverse basis dislocation.`;
    } else if (m.annualizedFundingApr >= 10) {
      direction = 'CARRY SHORT';
      rationale = `Longs pay +${m.annualizedFundingApr.toFixed(1)}% APR funding; short carry collects positive hourly accrual.`;
    } else if (m.annualizedFundingApr <= -10) {
      direction = 'CARRY LONG';
      rationale = `Shorts pay ${Math.abs(m.annualizedFundingApr).toFixed(1)}% APR funding; long carry collects hourly accrual.`;
    } else if (score >= 65 && m.quoteVolume24h > 50_000) {
      direction = m.fundingRate >= 0 ? 'CARRY SHORT' : 'CARRY LONG';
      rationale = `High execution liquidity ($${(m.quoteVolume24h / 1000).toFixed(0)}k 24h vol, ${m.spreadBps.toFixed(1)} bps spread) with active regime volatility.`;
    }

    const conviction: ConvictionBreakdown = {
      fundingZ: Number(fundingZ.toFixed(2)),
      basisZ: Number(basisZ.toFixed(2)),
      liquidityZ: Number(liquidityZ.toFixed(2)),
      momentumZ: Number(momentumZ.toFixed(2)),
      etfZ: Number(etfFactor.toFixed(2)),
      compositeZ: Number(compositeZ.toFixed(2)),
      score,
      direction,
      rationale,
    };

    return { ...m, conviction };
  });
}

/**
 * Simulates exact order fill VWAP and slippage bps against live L2 orderbook levels.
 */
export function simulateOrderbookSlippage(
  levels: [string, string][],
  side: 'BUY' | 'SELL',
  requestedNotionalUsd: number,
  midPrice: number,
): SlippageResult {
  const safeNotional = Math.max(0, requestedNotionalUsd);
  if (levels.length === 0 || safeNotional === 0) {
    return {
      side,
      requestedNotionalUsd: safeNotional,
      filledNotionalUsd: 0,
      filledQty: 0,
      midPrice,
      bestPrice: midPrice,
      vwapPrice: midPrice,
      slippageBps: 0,
      levelsConsumed: 0,
      exhaustedBook: levels.length === 0,
    };
  }

  let remainingUsd = safeNotional;
  let filledUsd = 0;
  let filledQty = 0;
  let levelsConsumed = 0;
  const bestPrice = safeNum(levels[0][0], midPrice);

  for (const [pxStr, szStr] of levels) {
    const px = safeNum(pxStr);
    const sz = safeNum(szStr);
    if (px <= 0 || sz <= 0) continue;
    levelsConsumed += 1;
    const levelUsd = px * sz;
    if (levelUsd >= remainingUsd) {
      const takeQty = remainingUsd / px;
      filledQty += takeQty;
      filledUsd += remainingUsd;
      remainingUsd = 0;
      break;
    } else {
      filledQty += sz;
      filledUsd += levelUsd;
      remainingUsd -= levelUsd;
    }
  }

  const vwapPrice = filledQty > 0 ? filledUsd / filledQty : bestPrice;
  const refPrice = midPrice > 0 ? midPrice : bestPrice;
  const rawSlip =
    side === 'BUY' ? (vwapPrice - refPrice) / refPrice : (refPrice - vwapPrice) / refPrice;
  const slippageBps = Math.max(0, rawSlip * 10_000);

  return {
    side,
    requestedNotionalUsd: safeNotional,
    filledNotionalUsd: filledUsd,
    filledQty,
    midPrice: refPrice,
    bestPrice,
    vwapPrice,
    slippageBps: Number(slippageBps.toFixed(2)),
    levelsConsumed,
    exhaustedBook: remainingUsd > 1e-6,
  };
}

export function computeOrderbookImbalance(
  bids: [string, string][],
  asks: [string, string][],
  depth = 10,
): { bidUsd: number; askUsd: number; imbalancePct: number } {
  const bidUsd = bids
    .slice(0, depth)
    .reduce((acc, [p, q]) => acc + safeNum(p) * safeNum(q), 0);
  const askUsd = asks
    .slice(0, depth)
    .reduce((acc, [p, q]) => acc + safeNum(p) * safeNum(q), 0);
  const total = bidUsd + askUsd;
  const imbalancePct = total > 0 ? ((bidUsd - askUsd) / total) * 100 : 0;
  return {
    bidUsd,
    askUsd,
    imbalancePct: Number(imbalancePct.toFixed(1)),
  };
}

export function computeEma(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

export function detectMarketRegime(klines: KlineBar[]): RegimeResult {
  if (klines.length < 10) {
    return {
      regime: 'CHOP',
      emaFast: klines.map((k) => k.c),
      emaSlow: klines.map((k) => k.c),
      atrPct: 0,
      efficiencyRatio: 0,
      emaSlopePct: 0,
      summary: 'Insufficient candles for regime classification.',
    };
  }

  const closes = klines.map((k) => k.c);
  const emaFast = computeEma(closes, 9);
  const emaSlow = computeEma(closes, 21);

  // ATR-14 %
  const trs: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const h = klines[i].h;
    const l = klines[i].l;
    const pc = klines[i - 1].c;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const atrSlice = trs.slice(-14);
  const atr = atrSlice.reduce((a, b) => a + b, 0) / Math.max(1, atrSlice.length);
  const lastClose = closes[closes.length - 1];
  const atrPct = lastClose > 0 ? (atr / lastClose) * 100 : 0;

  // Kaufman Efficiency Ratio over last 15 bars
  const lookback = Math.min(15, closes.length - 1);
  const netMove = Math.abs(lastClose - closes[closes.length - 1 - lookback]);
  let pathLength = 0;
  for (let i = closes.length - lookback; i < closes.length; i++) {
    pathLength += Math.abs(closes[i] - closes[i - 1]);
  }
  const efficiencyRatio = pathLength > 0 ? netMove / pathLength : 0;

  const fastNow = emaFast[emaFast.length - 1];
  const slowNow = emaSlow[emaSlow.length - 1];
  const slowPrev = emaSlow[Math.max(0, emaSlow.length - 6)];
  const emaSlopePct = slowPrev > 0 ? ((slowNow - slowPrev) / slowPrev) * 100 : 0;

  let regime: 'UPTREND' | 'DOWNTREND' | 'CHOP' = 'CHOP';
  if (fastNow > slowNow && emaSlopePct > 0.12 && efficiencyRatio >= 0.25) {
    regime = 'UPTREND';
  } else if (fastNow < slowNow && emaSlopePct < -0.12 && efficiencyRatio >= 0.25) {
    regime = 'DOWNTREND';
  }

  const summary =
    regime === 'UPTREND'
      ? `EMA-9 > EMA-21 (+${emaSlopePct.toFixed(2)}% slope), ER ${efficiencyRatio.toFixed(2)}, ATR ${atrPct.toFixed(2)}% — directional uptrend.`
      : regime === 'DOWNTREND'
        ? `EMA-9 < EMA-21 (${emaSlopePct.toFixed(2)}% slope), ER ${efficiencyRatio.toFixed(2)}, ATR ${atrPct.toFixed(2)}% — directional downtrend.`
        : `Low directional efficiency (ER ${efficiencyRatio.toFixed(2)}), ATR ${atrPct.toFixed(2)}% — mean-reverting chop favors carry & passive limit fills.`;

  return {
    regime,
    emaFast,
    emaSlow,
    atrPct: Number(atrPct.toFixed(2)),
    efficiencyRatio: Number(efficiencyRatio.toFixed(2)),
    emaSlopePct: Number(emaSlopePct.toFixed(2)),
    summary,
  };
}

export function getMaintenanceMarginRate(market: EnrichedMarket, notionalUsd: number): number {
  const tiers = market.contract.marginTiers;
  if (!tiers || tiers.length === 0) return 0.05;
  for (const t of tiers) {
    if (notionalUsd <= safeNum(t.maxNotionalValue, Infinity)) {
      return safeNum(t.maintenanceMarginRate, 0.05);
    }
  }
  return safeNum(tiers[tiers.length - 1].maintenanceMarginRate, 0.1);
}

/**
 * Fail-closed Pre-Trade Risk Engine + Deterministic SoDEX EIP-712 Order Payload Builder.
 */
export function evaluatePreTradeRisk(input: RiskEvaluationInput): RiskEvaluationResult {
  const {
    market,
    side,
    accountEquityUsd,
    riskPctPerTrade,
    leverage,
    entryPrice,
    stopLossPrice,
    takeProfitPrice,
    estimatedSlippageBps,
    killSwitchActive,
    existingExposureUsd,
    realizedDailyLossUsd,
    maxDailyDrawdownPct,
    maxSlippageBps,
  } = input;

  const safeEquity = Math.max(0, accountEquityUsd);
  const safeEntry = Math.max(1e-9, entryPrice);
  const safeLev = Math.max(1, leverage);
  const riskUsd = safeEquity * (Math.max(0, riskPctPerTrade) / 100);

  const stopDelta =
    side === 'LONG' ? safeEntry - stopLossPrice : stopLossPrice - safeEntry;
  const tpDelta =
    side === 'LONG' ? takeProfitPrice - safeEntry : safeEntry - takeProfitPrice;

  const stopValid = stopDelta > 0;
  const stopDistancePct = stopValid ? (stopDelta / safeEntry) * 100 : 0;

  // Risk-based sizing capped by account buying power at chosen leverage
  const rawQtyByRisk = stopValid ? riskUsd / stopDelta : 0;
  const maxNotionalByEquity = safeEquity * safeLev;
  const uncappedNotional = rawQtyByRisk * safeEntry;
  const positionNotionalUsd = Math.min(uncappedNotional, maxNotionalByEquity);
  const positionQty = positionNotionalUsd / safeEntry;
  const requiredMarginUsd = positionNotionalUsd / safeLev;

  const mmr = getMaintenanceMarginRate(market, positionNotionalUsd);
  const liquidationPrice =
    side === 'LONG'
      ? safeEntry * (1 - 1 / safeLev + mmr)
      : safeEntry * (1 + 1 / safeLev - mmr);

  const liqBufferPct =
    side === 'LONG'
      ? ((stopLossPrice - liquidationPrice) / safeEntry) * 100
      : ((liquidationPrice - stopLossPrice) / safeEntry) * 100;

  const riskRewardRatio = stopValid && tpDelta > 0 ? tpDelta / stopDelta : 0;
  const takerFeeRate = safeNum(market.contract.takerFee, 0.0004);
  const estimatedTakerFeeUsd = positionNotionalUsd * takerFeeRate * 2; // round-trip
  // Funding received (+) or paid (-) over 24h
  const periodsPerDay = 86400 / Math.max(60, market.fundingIntervalSec);
  const dailyFundingRate = market.fundingRate * periodsPerDay;
  const estimated24hFundingUsd =
    side === 'SHORT'
      ? positionNotionalUsd * dailyFundingRate
      : -positionNotionalUsd * dailyFundingRate;

  const minNotional = safeNum(market.contract.minNotional, 10);
  const maxContractLev = Math.max(1, safeNum(market.contract.maxLeverage, 10));
  const dailyLossPct = safeEquity > 0 ? (Math.max(0, realizedDailyLossUsd) / safeEquity) * 100 : 0;
  const projectedExposureRatio =
    safeEquity > 0 ? (existingExposureUsd + positionNotionalUsd) / safeEquity : 999;

  const checks: RiskGateCheck[] = [
    {
      id: 'kill-switch',
      label: 'Global Kill Switch',
      passed: !killSwitchActive,
      severity: 'HARD',
      detail: killSwitchActive
        ? 'BLOCKED: Global Kill Switch is engaged.'
        : 'Armed and clear.',
    },
    {
      id: 'stop-direction',
      label: 'Stop-Loss Geometry & Liquidation Buffer',
      passed: stopValid && liqBufferPct > 0.25,
      severity: 'HARD',
      detail: !stopValid
        ? `Invalid SL: must be ${side === 'LONG' ? 'below' : 'above'} entry.`
        : liqBufferPct <= 0.25
          ? `Liquidation ($${liquidationPrice.toFixed(2)}) sits too close to or inside Stop-Loss (${liqBufferPct.toFixed(2)}% buffer). Reduce leverage.`
          : `SL triggers ${liqBufferPct.toFixed(2)}% safely before est. liquidation ($${liquidationPrice.toFixed(2)}, MMR ${(mmr * 100).toFixed(1)}%).`,
    },
    {
      id: 'leverage-cap',
      label: 'SoDEX Contract Max Leverage',
      passed: safeLev <= maxContractLev,
      severity: 'HARD',
      detail:
        safeLev <= maxContractLev
          ? `${safeLev}x <= ${market.symbol} contract limit (${maxContractLev}x).`
          : `BLOCKED: ${safeLev}x exceeds SoDEX contract max ${maxContractLev}x.`,
    },
    {
      id: 'slippage-gate',
      label: 'Live L2 Slippage & Spread Gate',
      passed: estimatedSlippageBps <= maxSlippageBps && market.spreadBps <= maxSlippageBps * 1.5,
      severity: 'HARD',
      detail:
        estimatedSlippageBps <= maxSlippageBps
          ? `Est. L2 slippage ${estimatedSlippageBps.toFixed(1)} bps (limit ${maxSlippageBps} bps), top spread ${market.spreadBps.toFixed(1)} bps.`
          : `BLOCKED: Live L2 slippage ${estimatedSlippageBps.toFixed(1)} bps exceeds ${maxSlippageBps} bps guardrail.`,
    },
    {
      id: 'min-notional',
      label: 'SoDEX Minimum Notional & Exposure Cap',
      passed: positionNotionalUsd >= minNotional && projectedExposureRatio <= maxContractLev,
      severity: 'HARD',
      detail:
        positionNotionalUsd < minNotional
          ? `Position $${positionNotionalUsd.toFixed(2)} below SoDEX minNotional $${minNotional}.`
          : `Position $${positionNotionalUsd.toFixed(0)} >= $${minNotional} min; portfolio gross leverage ${projectedExposureRatio.toFixed(2)}x.`,
    },
    {
      id: 'drawdown-guard',
      label: 'Daily Drawdown Circuit Breaker',
      passed: dailyLossPct < maxDailyDrawdownPct,
      severity: 'HARD',
      detail:
        dailyLossPct < maxDailyDrawdownPct
          ? `Realized daily loss ${dailyLossPct.toFixed(2)}% < ${maxDailyDrawdownPct}% breaker.`
          : `BLOCKED: Daily drawdown limit (${maxDailyDrawdownPct}%) reached.`,
    },
  ];

  const approved = checks.every((c) => c.severity !== 'HARD' || c.passed);

  const qtyDecimals = Math.max(0, Math.min(6, market.contract.quantityPrecision ?? 3));
  const pxDecimals = Math.max(0, Math.min(6, market.contract.pricePrecision ?? 2));
  const nowSec = Math.floor(Date.now() / 1000);

  const orderPayload = {
    domain: {
      name: 'SoDEX Perps',
      version: '1',
      chainId: 286623, // ValueChain Mainnet EIP-712 domain
      verifyingContract: '0x00000000000000000000000000000000000050dE',
    },
    primaryType: 'PerpOrder' as const,
    message: {
      symbol: market.symbol,
      symbolId: market.contract.id,
      side: side === 'LONG' ? ('BUY' as const) : ('SELL' as const),
      orderType: 'LIMIT_IOC' as const,
      price: safeEntry.toFixed(pxDecimals),
      quantity: positionQty.toFixed(qtyDecimals),
      notionalUsd: positionNotionalUsd.toFixed(2),
      leverage: safeLev,
      reduceOnly: false,
      stopLossTrigger: stopLossPrice.toFixed(pxDecimals),
      takeProfitTrigger: takeProfitPrice.toFixed(pxDecimals),
      nonce: nowSec,
      expiresAt: nowSec + 300,
    },
  };

  return {
    approved,
    checks,
    riskUsd: Number(riskUsd.toFixed(2)),
    stopDistancePct: Number(stopDistancePct.toFixed(2)),
    positionQty: Number(positionQty.toFixed(qtyDecimals)),
    positionNotionalUsd: Number(positionNotionalUsd.toFixed(2)),
    requiredMarginUsd: Number(requiredMarginUsd.toFixed(2)),
    maintenanceMarginRate: mmr,
    liquidationPrice: Number(liquidationPrice.toFixed(pxDecimals)),
    liqBufferPct: Number(liqBufferPct.toFixed(2)),
    riskRewardRatio: Number(riskRewardRatio.toFixed(2)),
    estimatedTakerFeeUsd: Number(estimatedTakerFeeUsd.toFixed(2)),
    estimated24hFundingUsd: Number(estimated24hFundingUsd.toFixed(2)),
    orderPayload,
  };
}

export function buildCounterfactualCurves(
  trades: PaperTrade[],
  initialEquity = 10_000,
): { label: string; gatedEquity: number; ungatedEquity: number }[] {
  const closed = [...trades]
    .filter((t) => t.status === 'CLOSED' && typeof t.realizedPnlUsd === 'number')
    .sort((a, b) => (a.closedAt ?? a.createdAt) - (b.closedAt ?? b.createdAt));

  let gated = initialEquity;
  let ungated = initialEquity;
  const points = [{ label: 'Start', gatedEquity: gated, ungatedEquity: ungated }];

  for (let i = 0; i < closed.length; i++) {
    const t = closed[i];
    const pnl = t.realizedPnlUsd ?? 0;
    // Counterfactual ungated model simulates 2.5x oversized position & extra 18 bps unguarded slippage drag
    const slippageDrag = (t.notionalUsd * 2.5 * 18) / 10_000;
    ungated += pnl * 2.5 - slippageDrag;
    if (t.riskGatePassed) {
      gated += pnl;
    }
    points.push({
      label: `#${i + 1} ${t.symbol.replace('-USD', '')}`,
      gatedEquity: Number(gated.toFixed(2)),
      ungatedEquity: Number(Math.max(0, ungated).toFixed(2)),
    });
  }
  return points;
}

/**
 * Multi-Leg Spot↔Perp Delta-Neutral Hedge & Net Carry Calculator.
 * Sweeps both live SoDEX Spot L2 and SoDEX Perp L2 orderbooks to compute true net carry APR
 * and breakeven holding hours after 2-leg entry/exit slippage + maker/taker fees.
 */
export function computeDeltaNeutralCarry(input: DeltaNeutralHedgeInput): DeltaNeutralHedgeResult {
  const {
    market,
    notionalUsd,
    holdingDays,
    strategy,
    executionMode,
    captureBasisConvergence,
    spotOrderbook,
    perpOrderbook,
  } = input;

  const safeNotional = Math.max(10, notionalUsd);
  const safeDays = Math.max(1, holdingDays);

  const spotLegSide: 'BUY' | 'SELL' = strategy === 'CASH_AND_CARRY' ? 'BUY' : 'SELL';
  const perpLegSide: 'SHORT' | 'LONG' = strategy === 'CASH_AND_CARRY' ? 'SHORT' : 'LONG';

  const spotMid =
    spotOrderbook && spotOrderbook.bids.length > 0 && spotOrderbook.asks.length > 0
      ? (safeNum(spotOrderbook.bids[0][0]) + safeNum(spotOrderbook.asks[0][0])) / 2
      : (market.spotPrice ?? market.indexPrice ?? market.markPrice);

  const perpMid =
    perpOrderbook && perpOrderbook.bids.length > 0 && perpOrderbook.asks.length > 0
      ? (safeNum(perpOrderbook.bids[0][0]) + safeNum(perpOrderbook.asks[0][0])) / 2
      : market.markPrice;

  const spotBookLive = Boolean(
    spotOrderbook && spotOrderbook.bids.length > 0 && spotOrderbook.asks.length > 0,
  );
  const perpBookLive = Boolean(
    perpOrderbook && perpOrderbook.bids.length > 0 && perpOrderbook.asks.length > 0,
  );

  // Entry slippage from live L2 books (or 0 bps if passive MAKER limit order)
  const spotSim =
    spotBookLive && spotOrderbook
      ? simulateOrderbookSlippage(
          spotLegSide === 'BUY' ? spotOrderbook.asks : spotOrderbook.bids,
          spotLegSide,
          safeNotional,
          spotMid,
        )
      : null;

  const perpSim =
    perpBookLive && perpOrderbook
      ? simulateOrderbookSlippage(
          perpLegSide === 'LONG' ? perpOrderbook.asks : perpOrderbook.bids,
          perpLegSide === 'LONG' ? 'BUY' : 'SELL',
          safeNotional,
          perpMid,
        )
      : null;

  const spotSlippageBps =
    executionMode === 'MAKER' ? 0 : (spotSim?.slippageBps ?? Math.max(3, market.spreadBps * 0.5));
  const perpSlippageBps =
    executionMode === 'MAKER' ? 0 : (perpSim?.slippageBps ?? Math.max(2, market.spreadBps * 0.5));

  // Round-trip slippage accounts for both opening & unwinding both legs
  const roundTripSlippageBps = Number(((spotSlippageBps + perpSlippageBps) * 2).toFixed(2));

  // Fees: SoDEX perp contract maker/taker + standard spot 0.02%/0.05% (round-trip = 2x per leg)
  const perpFeeRate =
    executionMode === 'MAKER'
      ? safeNum(market.contract.makerFee, 0.00012)
      : safeNum(market.contract.takerFee, 0.0004);
  const spotFeeRate = executionMode === 'MAKER' ? 0.0002 : 0.0005;
  const roundTripFeeBps = Number((((perpFeeRate + spotFeeRate) * 2) * 10_000).toFixed(2));

  const totalExecutionCostBps = Number((roundTripSlippageBps + roundTripFeeBps).toFixed(2));
  const totalExecutionCostUsd = Number(((safeNotional * totalExecutionCostBps) / 10_000).toFixed(2));

  // Funding accrual sign: CASH_AND_CARRY (short perp) collects positive funding; REVERSE_CARRY (long perp) collects negative funding
  const signedFundingApr =
    strategy === 'CASH_AND_CARRY' ? market.annualizedFundingApr : -market.annualizedFundingApr;
  const expectedFundingUsd = Number(
    ((safeNotional * (signedFundingApr / 100) * safeDays) / 365).toFixed(2),
  );

  // Basis convergence edge (bps): CASH_AND_CARRY benefits when perp > spot (+spread); REVERSE_CARRY benefits when perp < spot (-spread)
  const rawBasisBps = market.spotPerpSpreadBps ?? market.markIndexBasisBps;
  const basisEdgeBps = Number(
    (captureBasisConvergence
      ? strategy === 'CASH_AND_CARRY'
        ? rawBasisBps
        : -rawBasisBps
      : 0
    ).toFixed(2),
  );
  const expectedBasisUsd = Number(((safeNotional * basisEdgeBps) / 10_000).toFixed(2));

  const netPnlUsd = Number((expectedFundingUsd + expectedBasisUsd - totalExecutionCostUsd).toFixed(2));
  const netAprPct = Number((((netPnlUsd / safeNotional) * (365 / safeDays)) * 100).toFixed(2));

  // Breakeven hours to recover execution costs (minus immediate basis edge) via hourly funding carry
  const hourlyFundingUsd = (safeNotional * (signedFundingApr / 100)) / (365 * 24);
  const residualCostToRecover = totalExecutionCostUsd - expectedBasisUsd;
  let breakevenHours: number | null = null;
  if (residualCostToRecover <= 0) {
    breakevenHours = 0;
  } else if (hourlyFundingUsd > 0) {
    breakevenHours = Number((residualCostToRecover / hourlyFundingUsd).toFixed(1));
  }

  let verdict: DeltaNeutralHedgeResult['verdict'] = 'NEGATIVE_AFTER_COSTS';
  if (netPnlUsd > 0 && netAprPct >= 8) {
    verdict = 'POSITIVE_EDGE';
  } else if (netPnlUsd > 0) {
    verdict = 'THIN_EDGE';
  }

  return {
    strategy,
    spotLegSide,
    perpLegSide,
    notionalUsd: safeNotional,
    holdingDays: safeDays,
    spotSlippageBps: Number(spotSlippageBps.toFixed(2)),
    perpSlippageBps: Number(perpSlippageBps.toFixed(2)),
    roundTripSlippageBps,
    roundTripFeeBps,
    totalExecutionCostBps,
    totalExecutionCostUsd,
    grossFundingAprPct: Number(signedFundingApr.toFixed(2)),
    expectedFundingUsd,
    basisEdgeBps,
    expectedBasisUsd,
    netPnlUsd,
    netAprPct,
    breakevenHours,
    verdict,
    spotBookLive,
    perpBookLive,
    atomicPlan: {
      protocol: 'SoDEX Spot + Perps (ValueChain L1)',
      strategy,
      notionalUsd: safeNotional,
      holdingDays: safeDays,
      legs: [
        {
          venue: 'SoDEX Spot',
          symbol: market.spotSymbol ?? `${market.baseCoin}_vUSDC`,
          side: spotLegSide,
          orderType: executionMode === 'MAKER' ? 'POST_ONLY_LIMIT' : 'LIMIT_IOC',
          estVwap: Number((spotSim?.vwapPrice ?? spotMid).toFixed(4)),
          slippageBps: Number(spotSlippageBps.toFixed(2)),
        },
        {
          venue: 'SoDEX Perps',
          symbol: market.symbol,
          side: perpLegSide === 'LONG' ? 'BUY' : 'SELL',
          orderType: executionMode === 'MAKER' ? 'POST_ONLY_LIMIT' : 'LIMIT_IOC',
          estVwap: Number((perpSim?.vwapPrice ?? perpMid).toFixed(4)),
          slippageBps: Number(perpSlippageBps.toFixed(2)),
        },
      ],
      projectedNetPnlUsd: netPnlUsd,
      projectedNetAprPct: netAprPct,
      breakevenHours,
    },
  };
}
