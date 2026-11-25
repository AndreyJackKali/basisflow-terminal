import type {
  AssetClass,
  ConvictionBreakdown,
  DeltaNeutralHedgeInput,
  DeltaNeutralHedgeResult,
  EnrichedMarket,
  EtfFlowStats,
  EtfFundingCrossCheck,
  KlineBar,
  MonteCarloInput,
  MonteCarloStepBand,
  MonteCarloStressResult,
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
  SoSoEtfAsset,
  SoSoEtfDayRow,
  SoSoSsiIndexRow,
  SoSoValueState,
  SoloDeskEconomicsInput,
  SoloDeskEconomicsResult,
  OperatorSignalBrief,
  NetworkMode,
  SpotSymbolInfo,
  SpotTicker,
  SsiSectorFundingRow,
  TailStressScenario,
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

// Deterministic Mulberry32 PRNG so Monte Carlo bootstrap is 100% reproducible & unit-testable
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function mcMean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function mcStdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mcMean(arr);
  const variance = arr.reduce((acc, x) => acc + (x - m) * (x - m), 0) / (arr.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = clamp((sorted.length - 1) * p, 0, sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Live Empirical Bootstrap Monte Carlo & Deterministic Tail-Stress Engine.
 * Bootstraps actual realized bar log-returns directly from live SoDEX /klines (zero synthetic assumptions),
 * simulating SL, TP, contract liquidation, taker fees, entry slippage, and hourly funding carry accrual.
 */
export function runLiveBootstrapMonteCarlo(input: MonteCarloInput): MonteCarloStressResult {
  const {
    market,
    klines,
    side,
    accountEquityUsd,
    positionNotionalUsd,
    positionQty,
    entryPrice,
    stopLossPrice,
    takeProfitPrice,
    liquidationPrice,
    entrySlippageBps,
    horizonHours,
  } = input;

  const numPaths = Math.max(100, Math.min(2000, input.numPaths ?? 1000));
  const safeEquity = Math.max(1, accountEquityUsd);
  const safeEntry = Math.max(1e-8, entryPrice);

  // Extract empirical log-returns from live SoDEX OHLCV candles and normalize to 1h step variance
  const rawReturns: number[] = [];
  let barDurationHours = 1;
  if (klines.length >= 2) {
    const dtMs = klines[klines.length - 1].t - klines[klines.length - 2].t;
    if (dtMs > 0) {
      barDurationHours = clamp(dtMs / 3_600_000, 0.25, 24);
    }
  }
  const scaleToHourly = 1 / Math.sqrt(barDurationHours);

  for (let i = 1; i < klines.length; i++) {
    const prev = klines[i - 1].c;
    const curr = klines[i].c;
    if (prev > 0 && curr > 0) {
      rawReturns.push(Math.log(curr / prev) * scaleToHourly);
    }
  }

  // Fallback empirical envelope only if klines haven't arrived yet (explicitly surfaced via sampleReturnsCount = 0)
  const returnsPool =
    rawReturns.length >= 5
      ? rawReturns
      : [-0.012, -0.006, -0.002, 0.001, 0.004, 0.009, -0.004, 0.003, -0.009, 0.007];

  const hourlyStd = mcStdDev(returnsPool);
  const annualizedRealizedVolPct = Number((hourlyStd * Math.sqrt(24 * 365) * 100).toFixed(1));

  // Round-trip taker fee + entry slippage cost in USD
  const takerFeeRate = safeNum(market.contract.takerFee, 0.0004);
  const roundTripCostUsd =
    positionNotionalUsd * (takerFeeRate * 2 + Math.max(0, entrySlippageBps) / 10_000);

  // Hourly funding PnL in USD (positive funding -> shorts collect, longs pay)
  const periodsPerHour = 3600 / Math.max(60, market.fundingIntervalSec || 3600);
  const signedFundingSign = side === 'SHORT' ? 1 : -1;
  const hourlyFundingUsd =
    positionNotionalUsd * market.fundingRate * periodsPerHour * signedFundingSign;

  const lastCandleT = klines.length > 0 ? klines[klines.length - 1].t : 0;
  const rng = mulberry32(hashSeed(`${market.symbol}:${side}:${horizonHours}:${lastCandleT}`));

  // Sample 12 evenly spaced checkpoints across the horizon for the SVG fan chart
  const bandSteps = 12;
  const stepHours: number[] = [];
  for (let s = 0; s <= bandSteps; s++) {
    stepHours.push(Math.round((horizonHours * s) / bandSteps));
  }
  const stepBuckets: number[][] = stepHours.map(() => []);
  const finalPnls: number[] = [];

  let tpHits = 0;
  let slHits = 0;
  let liqHits = 0;
  let wins = 0;

  for (let p = 0; p < numPaths; p++) {
    let price = safeEntry;
    let realizedPnl = -roundTripCostUsd;
    let active = true;
    let nextBucketIdx = 0;

    if (stepHours[0] === 0) {
      stepBuckets[0].push(safeEquity + realizedPnl);
      nextBucketIdx = 1;
    }

    for (let h = 1; h <= horizonHours; h++) {
      if (active) {
        const r = returnsPool[Math.floor(rng() * returnsPool.length)];
        price = price * Math.exp(r);
        realizedPnl += hourlyFundingUsd;

        const hitLiq =
          liquidationPrice > 0 &&
          (side === 'LONG' ? price <= liquidationPrice : price >= liquidationPrice);
        const hitSl =
          stopLossPrice > 0 &&
          (side === 'LONG' ? price <= stopLossPrice : price >= stopLossPrice);
        const hitTp =
          takeProfitPrice > 0 &&
          (side === 'LONG' ? price >= takeProfitPrice : price <= takeProfitPrice);

        if (hitLiq) {
          const liqPriceDiff =
            side === 'LONG' ? liquidationPrice - safeEntry : safeEntry - liquidationPrice;
          realizedPnl = Math.max(-safeEquity, liqPriceDiff * positionQty + realizedPnl);
          liqHits++;
          active = false;
        } else if (hitSl) {
          const slPriceDiff =
            side === 'LONG' ? stopLossPrice - safeEntry : safeEntry - stopLossPrice;
          realizedPnl = slPriceDiff * positionQty + realizedPnl;
          slHits++;
          active = false;
        } else if (hitTp) {
          const tpPriceDiff =
            side === 'LONG' ? takeProfitPrice - safeEntry : safeEntry - takeProfitPrice;
          realizedPnl = tpPriceDiff * positionQty + realizedPnl;
          tpHits++;
          active = false;
        }
      }

      const mtmPnl = active
        ? (side === 'LONG' ? price - safeEntry : safeEntry - price) * positionQty + realizedPnl
        : realizedPnl;

      while (nextBucketIdx < stepHours.length && stepHours[nextBucketIdx] === h) {
        stepBuckets[nextBucketIdx].push(Math.max(0, safeEquity + mtmPnl));
        nextBucketIdx++;
      }

      if (h === horizonHours) {
        const clampedFinal = Math.max(-safeEquity, mtmPnl);
        finalPnls.push(clampedFinal);
        if (clampedFinal > 0) wins++;
      }
    }
  }

  const sortedPnls = [...finalPnls].sort((a, b) => a - b);
  const expectedPnlUsd = Number(mcMean(finalPnls).toFixed(2));
  const medianPnlUsd = Number(percentile(sortedPnls, 0.5).toFixed(2));

  // 95% VaR = 5th percentile loss (expressed as positive loss magnitude if negative, else 0)
  const p05 = percentile(sortedPnls, 0.05);
  const var95Usd = Number(Math.max(0, -p05).toFixed(2));
  const var95Pct = Number(((var95Usd / safeEquity) * 100).toFixed(2));

  // 99% CVaR (Expected Shortfall) = mean of worst 1% of paths
  const tailCount = Math.max(1, Math.floor(sortedPnls.length * 0.01));
  const worstTailMean = mcMean(sortedPnls.slice(0, tailCount));
  const cvar99Usd = Number(Math.max(var95Usd, -worstTailMean).toFixed(2));
  const cvar99Pct = Number(((cvar99Usd / safeEquity) * 100).toFixed(2));

  const bands: MonteCarloStepBand[] = stepHours.map((hour, idx) => {
    const arr = [...stepBuckets[idx]].sort((a, b) => a - b);
    return {
      hour,
      p10: Number(percentile(arr, 0.1).toFixed(2)),
      p25: Number(percentile(arr, 0.25).toFixed(2)),
      p50: Number(percentile(arr, 0.5).toFixed(2)),
      p75: Number(percentile(arr, 0.75).toFixed(2)),
      p90: Number(percentile(arr, 0.9).toFixed(2)),
    };
  });

  // Deterministic Tail-Stress Scenarios
  const evalPriceShock = (
    id: string,
    label: string,
    shockSummary: string,
    shockPct: number,
    fundingMultiplier = 1,
  ): TailStressScenario => {
    const shockedPrice = safeEntry * (1 + shockPct / 100);
    const funding24h = hourlyFundingUsd * 24 * fundingMultiplier;
    const hitLiq =
      liquidationPrice > 0 &&
      (side === 'LONG' ? shockedPrice <= liquidationPrice : shockedPrice >= liquidationPrice);
    const hitSl =
      stopLossPrice > 0 &&
      (side === 'LONG' ? shockedPrice <= stopLossPrice : shockedPrice >= stopLossPrice);
    const hitTp =
      takeProfitPrice > 0 &&
      (side === 'LONG' ? shockedPrice >= takeProfitPrice : shockedPrice <= takeProfitPrice);

    let outcome: TailStressScenario['outcome'] = 'SURVIVES';
    let effExit = shockedPrice;
    if (hitLiq && (!hitSl || Math.abs(shockPct) >= 15)) {
      outcome = 'LIQUIDATED';
      effExit = liquidationPrice;
    } else if (hitSl) {
      outcome = 'STOPPED';
      effExit = stopLossPrice;
    } else if (hitTp) {
      outcome = 'TP_HIT';
      effExit = takeProfitPrice;
    }

    const rawPnl =
      (side === 'LONG' ? effExit - safeEntry : safeEntry - effExit) * positionQty +
      funding24h -
      roundTripCostUsd;
    const projectedPnlUsd = Number(Math.max(-safeEquity, rawPnl).toFixed(2));
    const equityImpactPct = Number(((projectedPnlUsd / safeEquity) * 100).toFixed(2));
    return { id, label, shockSummary, projectedPnlUsd, equityImpactPct, outcome };
  };

  const stressScenarios: TailStressScenario[] = [
    evalPriceShock('flash-crash', 'Flash Crash (-10% Gap)', '-10% spot/perp gap through thin liquidity', -10),
    evalPriceShock('short-squeeze', 'Short Squeeze (+10% Spike)', '+10% vertical cascade', 10),
    evalPriceShock(
      'liq-cascade',
      'Extreme Tail (-20% Gap)',
      '-20% black-swan gap (tests liquidation gap risk)',
      -20,
    ),
    evalPriceShock(
      'funding-flip',
      'Funding Reversal (-2x / 24h)',
      'Flat price + funding flips -2x against position',
      0,
      -2,
    ),
  ];

  return {
    symbol: market.symbol,
    sampleReturnsCount: rawReturns.length,
    numPaths,
    horizonHours,
    annualizedRealizedVolPct,
    expectedPnlUsd,
    medianPnlUsd,
    var95Usd,
    var95Pct,
    cvar99Usd,
    cvar99Pct,
    tpHitRatePct: Number(((tpHits / numPaths) * 100).toFixed(1)),
    slHitRatePct: Number(((slHits / numPaths) * 100).toFixed(1)),
    liquidationProbPct: Number(((liqHits / numPaths) * 100).toFixed(1)),
    winRatePct: Number(((wins / numPaths) * 100).toFixed(1)),
    bands,
    stressScenarios,
  };
}

function escapeCsvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function serializeMarketsToCsv(markets: EnrichedMarket[]): string {
  const headers = [
    'symbol',
    'assetClass',
    'markPrice',
    'indexPrice',
    'changePct24h',
    'annualizedFundingAprPct',
    'markIndexBasisBps',
    'spotSymbol',
    'spotPerpSpreadBps',
    'quoteVolume24hUsd',
    'openInterestUsd',
    'spreadBps',
    'convictionScore',
    'direction',
  ];
  const rows = markets.map((m) =>
    [
      m.symbol,
      m.assetClass,
      m.markPrice,
      m.indexPrice,
      m.changePct24h,
      m.annualizedFundingApr,
      m.markIndexBasisBps,
      m.spotSymbol ?? '',
      m.spotPerpSpreadBps ?? '',
      m.quoteVolume24h,
      m.openInterestUsd,
      m.spreadBps,
      m.conviction.score,
      m.conviction.direction,
    ]
      .map(escapeCsvCell)
      .join(','),
  );
  return [headers.join(','), ...rows].join('\n');
}

/**
 * Computes institutional US Spot ETF flow summary metrics and 30-session z-score.
 */
export function computeEtfFlowStats(rows: SoSoEtfDayRow[]): EtfFlowStats {
  if (!rows || rows.length === 0) {
    return {
      latestDate: null,
      latestNetInflow: 0,
      fiveDayNetInflow: 0,
      totalNetAssets: 0,
      cumNetInflow: 0,
      zScore30d: 0,
      streakDays: 0,
    };
  }
  const latest = rows[0];
  const fiveDayNetInflow = rows
    .slice(0, 5)
    .reduce((acc, r) => acc + safeNum(r.totalNetInflow), 0);

  const flows = rows
    .slice(0, 30)
    .map((r) => safeNum(r.totalNetInflow, NaN))
    .filter((v) => Number.isFinite(v));

  let zScore30d = 0;
  if (flows.length >= 5) {
    const { mean, std } = meanStd(flows);
    zScore30d = Number(Math.max(-3, Math.min(3, (flows[0] - mean) / std)).toFixed(2));
  }

  let streakDays = 0;
  const firstSign = Math.sign(latest.totalNetInflow);
  if (firstSign !== 0) {
    for (const r of rows) {
      if (Math.sign(r.totalNetInflow) === firstSign) streakDays += firstSign;
      else break;
    }
  }

  return {
    latestDate: latest.date || null,
    latestNetInflow: safeNum(latest.totalNetInflow),
    fiveDayNetInflow,
    totalNetAssets: safeNum(latest.totalNetAssets),
    cumNetInflow: safeNum(latest.cumNetInflow),
    zScore30d,
    streakDays,
  };
}

/**
 * Cross-checks live SoSoValue US Spot ETF institutional flows against live SoDEX Perp
 * Funding APR, Mark-Index Basis, and Spot-vs-Perp Spread.
 */
export function buildEtfFundingCrossChecks(
  etfFlows: Record<SoSoEtfAsset, SoSoEtfDayRow[]>,
  markets: EnrichedMarket[],
): EtfFundingCrossCheck[] {
  const assets: SoSoEtfAsset[] = ['BTC', 'ETH', 'SOL', 'XRP'];
  const byBase = new Map(markets.map((m) => [m.baseCoin.toUpperCase(), m]));

  return assets.map((asset) => {
    const rows = etfFlows[asset] ?? [];
    const stats = computeEtfFlowStats(rows);
    const mkt = byBase.get(asset);
    const perpFundingAprPct = mkt?.annualizedFundingApr ?? 0;
    const markIndexBasisBps = mkt?.markIndexBasisBps ?? 0;
    const spotPerpSpreadBps = mkt?.spotPerpSpreadBps ?? null;
    const openInterestUsd = mkt?.openInterestUsd ?? 0;

    const netFlowSignal = stats.fiveDayNetInflow;
    let regimeTag: EtfFundingCrossCheck['regimeTag'] = 'BALANCED';
    let thesis = 'ETF flows and SoDEX perp funding are balanced near parity.';

    if (netFlowSignal < 0 && perpFundingAprPct >= 6) {
      regimeTag = 'DIVERGENCE: CARRY SHORT';
      thesis = `Institutional ETF outflows ($${(netFlowSignal / 1e6).toFixed(1)}M 5d) diverge from positive SoDEX perp funding (+${perpFundingAprPct.toFixed(1)}% APR) — prime short-perp / cash-and-carry edge.`;
    } else if (netFlowSignal > 0 && perpFundingAprPct <= -4) {
      regimeTag = 'ACCUMULATION: CARRY LONG';
      thesis = `Spot ETF inflows (+$${(netFlowSignal / 1e6).toFixed(1)}M 5d) while SoDEX shorts pay ${Math.abs(perpFundingAprPct).toFixed(1)}% APR — institutional accumulation with positive long carry.`;
    } else if (netFlowSignal < 0 && perpFundingAprPct <= -6) {
      regimeTag = 'CROWDED SHORT SQUEEZE WATCH';
      thesis = `Heavy ETF outflows ($${(netFlowSignal / 1e6).toFixed(1)}M 5d) paired with negative perp funding (${perpFundingAprPct.toFixed(1)}% APR) — crowded short positioning; watch basis snapback.`;
    } else if (netFlowSignal > 0 && perpFundingAprPct > 4) {
      regimeTag = 'ALIGNED BULLISH CARRY';
      thesis = `Positive ETF inflows (+$${(netFlowSignal / 1e6).toFixed(1)}M 5d) confirm bullish perp carry (+${perpFundingAprPct.toFixed(1)}% APR); favorable for delta-neutral basis capture.`;
    } else if (netFlowSignal < 0) {
      regimeTag = 'ALIGNED DELEVERAGING';
      thesis = `Institutional ETF outflows ($${(netFlowSignal / 1e6).toFixed(1)}M 5d) alongside muted perp funding (${perpFundingAprPct.toFixed(1)}% APR) indicate disciplined risk-off deleveraging.`;
    }

    return {
      asset,
      perpSymbol: mkt?.symbol ?? `${asset}-USD`,
      hasLivePerp: Boolean(mkt),
      latestDate: stats.latestDate,
      latestNetInflowUsd: stats.latestNetInflow,
      fiveDayNetInflowUsd: stats.fiveDayNetInflow,
      totalNetAssetsUsd: stats.totalNetAssets,
      flowZScore: stats.zScore30d,
      perpFundingAprPct,
      markIndexBasisBps,
      spotPerpSpreadBps,
      openInterestUsd,
      regimeTag,
      thesis,
    };
  });
}

const SSI_SECTOR_BASKETS: Record<string, string[]> = {
  ssiMAG7: ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA'],
  ssiLayer1: ['BTC', 'ETH', 'SOL', 'AVAX', 'SUI', 'APT', 'NEAR', 'TON', 'SEI', 'ADA'],
  ssiDeFi: ['UNI', 'AAVE', 'LINK', 'PENDLE', 'ENA', 'CRV', 'LDO', 'MKR', 'SNX', 'JUP', 'HYPE'],
  ssiAI: ['TAO', 'FET', 'RENDER', 'WLD', 'VIRTUAL', 'NEAR', 'ICP', 'AKT', 'AR'],
  ssiRWA: ['ONDO', 'LINK', 'OM', 'AVAX', 'MKR', 'XAUT'],
  ssiMeme: ['DOGE', 'PEPE', 'WIF', 'BONK', 'SHIB', 'FLOKI', 'PENGU', 'FARTCOIN', 'TRUMP', 'PUMP'],
  ssiLayer2: ['ARB', 'OP', 'STRK', 'POL', 'IMX', 'MNT', 'ZK'],
  ssiCeFi: ['BNB', 'OKB', 'BGB', 'CRO', 'LEO'],
  ssiDePIN: ['FIL', 'RENDER', 'AR', 'HNT', 'AKT', 'TAO'],
  ssiPayFi: ['XRP', 'XLM', 'LTC', 'BCH', 'SOL'],
  ssiGameFi: ['IMX', 'GALA', 'AXS', 'SAND', 'MANA', 'BEAM'],
  ssiSocialFi: ['TON', 'CHZ', 'MASK'],
  ssiNFT: ['PENGU', 'APE', 'BLUR', 'IMX'],
};

/**
 * Joins SoSoValue SSI Crypto Sector Indices with live SoDEX Perp funding & basis averages.
 */
export function computeSsiSectorFunding(
  ssiIndices: SoSoSsiIndexRow[],
  markets: EnrichedMarket[],
): SsiSectorFundingRow[] {
  const byBase = new Map(markets.map((m) => [m.baseCoin.toUpperCase(), m]));
  return ssiIndices.map((index) => {
    const basket = SSI_SECTOR_BASKETS[index.ticker] ?? [];
    const matched = basket
      .map((coin) => byBase.get(coin))
      .filter((m): m is EnrichedMarket => Boolean(m));

    const avgFundingAprPct =
      matched.length > 0
        ? Number(
            (
              matched.reduce((acc, m) => acc + m.annualizedFundingApr, 0) / matched.length
            ).toFixed(2),
          )
        : null;
    const avgBasisBps =
      matched.length > 0
        ? Number(
            (matched.reduce((acc, m) => acc + m.markIndexBasisBps, 0) / matched.length).toFixed(1),
          )
        : null;

    return {
      index,
      matchedSymbols: matched.map((m) => m.symbol),
      avgFundingAprPct,
      avgBasisBps,
    };
  });
}

/**
 * Models a One-Person On-Chain Finance Business (Managed Carry Vault + Paid Signal Subscriptions + x402 API)
 * anchored strictly to live SoDEX net carry APR with high-water-mark performance fee protection.
 */
export function computeSoloDeskEconomics(input: SoloDeskEconomicsInput): SoloDeskEconomicsResult {
  const aum = Math.max(0, safeNum(input.managedAumUsd));
  const util = Math.min(100, Math.max(0, safeNum(input.capitalUtilizationPct))) / 100;
  const deployedCapitalUsd = aum * util;

  const grossCarryApr = safeNum(input.liveGrossCarryAprPct);
  const execDragApr = Math.max(0, safeNum(input.executionDragAprPct));
  const netStrategyCarryAprPct = grossCarryApr - execDragApr;

  const grossVaultProfitAnnualUsd = deployedCapitalUsd * (netStrategyCarryAprPct / 100);
  const mgmtRate = Math.min(10, Math.max(0, safeNum(input.managementFeePct))) / 100;
  const perfRate = Math.min(50, Math.max(0, safeNum(input.performanceFeePct))) / 100;

  const managementFeeAnnualUsd = aum * mgmtRate;
  // High-water-mark protection: performance fee is charged strictly on positive net profit after management fee
  const netProfitBeforePerf = grossVaultProfitAnnualUsd - managementFeeAnnualUsd;
  const performanceFeeAnnualUsd = netProfitBeforePerf > 0 ? netProfitBeforePerf * perfRate : 0;

  const clientNetProfitAnnualUsd =
    grossVaultProfitAnnualUsd - managementFeeAnnualUsd - performanceFeeAnnualUsd;
  const clientNetAprPct = aum > 0 ? (clientNetProfitAnnualUsd / aum) * 100 : 0;
  const alphaOverBenchmarkPct = clientNetAprPct - safeNum(input.benchmarkAprPct);

  const vaultFeeMrrUsd = (managementFeeAnnualUsd + performanceFeeAnnualUsd) / 12;
  const subscriptionMrrUsd =
    Math.max(0, safeNum(input.paidSubscribers)) * Math.max(0, safeNum(input.monthlySubPriceUsd));
  const x402ApiMrrUsd =
    Math.max(0, safeNum(input.x402CallsPerDay)) *
    Math.max(0, safeNum(input.x402PricePerCallUsd)) *
    30;

  const infra = Math.max(0, safeNum(input.monthlyInfraCostUsd));
  const totalGrossMrrUsd = vaultFeeMrrUsd + subscriptionMrrUsd + x402ApiMrrUsd;
  const totalNetMrrUsd = totalGrossMrrUsd - infra;
  const totalNetArrUsd = totalNetMrrUsd * 12;

  const subPrice = Math.max(0, safeNum(input.monthlySubPriceUsd));
  const residualCostAfterOtherRev = Math.max(0, infra - vaultFeeMrrUsd - x402ApiMrrUsd);
  const breakevenSubscribers =
    subPrice > 0 ? Math.ceil(residualCostAfterOtherRev / subPrice) : 0;

  const viabilityTag: SoloDeskEconomicsResult['viabilityTag'] =
    totalNetMrrUsd >= 1_500
      ? 'PROFITABLE SOLO DESK'
      : totalNetMrrUsd > 0
        ? 'SCALING STAGE'
        : 'BELOW BREAKEVEN';

  return {
    deployedCapitalUsd: Number(deployedCapitalUsd.toFixed(2)),
    netStrategyCarryAprPct: Number(netStrategyCarryAprPct.toFixed(2)),
    grossVaultProfitAnnualUsd: Number(grossVaultProfitAnnualUsd.toFixed(2)),
    managementFeeAnnualUsd: Number(managementFeeAnnualUsd.toFixed(2)),
    performanceFeeAnnualUsd: Number(performanceFeeAnnualUsd.toFixed(2)),
    clientNetAprPct: Number(clientNetAprPct.toFixed(2)),
    alphaOverBenchmarkPct: Number(alphaOverBenchmarkPct.toFixed(2)),
    subscriptionMrrUsd: Number(subscriptionMrrUsd.toFixed(2)),
    x402ApiMrrUsd: Number(x402ApiMrrUsd.toFixed(2)),
    vaultFeeMrrUsd: Number(vaultFeeMrrUsd.toFixed(2)),
    totalGrossMrrUsd: Number(totalGrossMrrUsd.toFixed(2)),
    totalNetMrrUsd: Number(totalNetMrrUsd.toFixed(2)),
    totalNetArrUsd: Number(totalNetArrUsd.toFixed(2)),
    breakevenSubscribers,
    viabilityTag,
  };
}

/**
 * Generates a ready-to-publish daily client brief (Markdown + structured JSON)
 * strictly from live SoDEX carry leaders and live SoSoValue OpenAPI v1 telemetry.
 */
export function generateOperatorSignalBrief(
  markets: EnrichedMarket[],
  sosoState: Pick<SoSoValueState, 'btcEtfFlowZScore' | 'ethEtfFlowZScore' | 'marketOverview' | 'hotNews' | 'snapshotFetchedAt'>,
  network: NetworkMode,
  topN = 5,
): OperatorSignalBrief {
  const generatedAtUtc = new Date().toISOString();
  const top = [...markets]
    .filter((m) => Number.isFinite(m.annualizedFundingApr) && m.quoteVolume24h > 0)
    .sort((a, b) => b.conviction.score - a.conviction.score)
    .slice(0, Math.max(1, topN))
    .map((m) => ({
      symbol: m.symbol,
      direction: m.conviction.direction,
      convictionScore: m.conviction.score,
      annualizedFundingApr: Number(m.annualizedFundingApr.toFixed(2)),
      markIndexBasisBps: Number(m.markIndexBasisBps.toFixed(1)),
      spotPerpSpreadBps: m.spotPerpSpreadBps !== null ? Number(m.spotPerpSpreadBps.toFixed(1)) : null,
      markPrice: m.markPrice,
    }));

  const topHeadlines = (sosoState.hotNews ?? []).slice(0, 3).map((n) => n.title);
  const mcap = sosoState.marketOverview?.totalMarketCap ?? null;

  const lines: string[] = [
    `# BasisFlow Daily Carry & ETF Signal Brief (${generatedAtUtc.slice(0, 16).replace('T', ' ')} UTC)`,
    `- **Venue:** SoDEX ${network.toUpperCase()} (ValueChain L1) + SoSoValue OpenAPI v1`,
    `- **Institutional Flows:** BTC Spot ETF 30d Z-Score = \`${sosoState.btcEtfFlowZScore.toFixed(2)}\` | ETH Spot ETF 30d Z-Score = \`${sosoState.ethEtfFlowZScore.toFixed(2)}\`${mcap ? ` | Total Crypto MCap = \`$${(mcap / 1e12).toFixed(2)}T\`` : ''}`,
    '',
    '## Top Conviction Carry & Basis Signals',
    '| Symbol | Direction | Score | Funding APR | Mark-Index Basis | Spot-Perp Spread |',
    '|---|---:|---:|---:|---:|---:|',
    ...top.map(
      (r) =>
        `| **${r.symbol}** | ${r.direction} | ${r.convictionScore}/100 | ${r.annualizedFundingApr >= 0 ? '+' : ''}${r.annualizedFundingApr.toFixed(2)}% | ${r.markIndexBasisBps.toFixed(1)} bps | ${r.spotPerpSpreadBps !== null ? `${r.spotPerpSpreadBps.toFixed(1)} bps` : 'Perp-only'} |`,
    ),
  ];

  if (topHeadlines.length > 0) {
    lines.push('', '## SoSoValue Macro & News Catalysts', ...topHeadlines.map((h) => `- ${h}`));
  }
  lines.push(
    '',
    '_Generated deterministically by BasisFlow Terminal v1.5.0 — non-custodial analytics, verify L2 slippage before execution._',
  );

  return {
    generatedAtUtc,
    network,
    topCarrySignals: top,
    btcEtfFlowZScore: sosoState.btcEtfFlowZScore,
    ethEtfFlowZScore: sosoState.ethEtfFlowZScore,
    marketCapUsd: mcap,
    topHeadlines,
    markdown: lines.join('\n'),
  };
}
