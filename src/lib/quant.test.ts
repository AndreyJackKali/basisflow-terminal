import { describe, it, expect } from 'vitest';
import {
  buildCounterfactualCurves,
  classifyAsset,
  computeAnnualizedFundingApr,
  computeBasisBps,
  computeBidAskSpreadBps,
  computeDeltaNeutralCarry,
  computeOrderbookImbalance,
  computeSpotPerpSpreadBps,
  detectMarketRegime,
  enrichMarkets,
  evaluatePreTradeRisk,
  runLiveBootstrapMonteCarlo,
  serializeMarketsToCsv,
  simulateOrderbookSlippage,
} from './quant';
import { parseSodexWsMessage } from './ws';
import type { EnrichedMarket, KlineBar, OrderbookData, PaperTrade, PerpSymbolInfo } from '../types';

const sampleContract: PerpSymbolInfo = {
  id: 1,
  name: 'BTC-USD',
  displayName: 'BTC-USD',
  baseCoin: 'BTC',
  quoteCoin: 'vUSDC',
  pricePrecision: 2,
  quantityPrecision: 4,
  tickSize: '0.1',
  stepSize: '0.0001',
  minNotional: '10',
  maxNotional: '1000000',
  maxLeverage: 20,
  initLeverage: 10,
  fundingInterval: 3600,
  makerFee: '0.00012',
  takerFee: '0.0004',
  status: 'TRADING',
  marginTiers: [
    { maxNotionalValue: '125000', maintenanceMarginRate: '0.025', maxLeverage: 20, maintenanceDeduction: '0' },
    { maxNotionalValue: '1000000', maintenanceMarginRate: '0.05', maxLeverage: 10, maintenanceDeduction: '3125' },
  ],
};

describe('BasisFlow Quant Engine', () => {
  it('computes hourly annualized funding APR accurately for 3600s SoDEX interval', () => {
    // 0.00001 per hour * 8760 hours/yr * 100 = 8.76% APR
    expect(computeAnnualizedFundingApr(0.00001, 3600)).toBeCloseTo(8.76, 4);
    expect(computeAnnualizedFundingApr(-0.00005, 3600)).toBeCloseTo(-43.8, 4);
  });

  it('computes mark-index basis and spot-perp spread in bps', () => {
    expect(computeBasisBps(63150, 63000)).toBeCloseTo(23.8095, 3);
    expect(computeSpotPerpSpreadBps(63126, 63000)).toBeCloseTo(20.0, 4);
    expect(computeBidAskSpreadBps(99.95, 100.05)).toBeCloseTo(10.0, 4);
  });

  it('classifies Crypto, Tokenized Equities, and Commodities correctly', () => {
    expect(classifyAsset('BTC')).toBe('Crypto');
    expect(classifyAsset('NVDA')).toBe('Tokenized Equity');
    expect(classifyAsset('vGOOGL')).toBe('Tokenized Equity');
    expect(classifyAsset('XAUT')).toBe('Commodity');
  });

  it('joins SoDEX spot markets to perp contracts and computes 0-100 sigmoid conviction', () => {
    const markets = enrichMarkets(
      [
        sampleContract,
        { ...sampleContract, id: 2, name: 'NVDA-USD', displayName: 'NVDA-USD', baseCoin: 'NVDA' },
      ],
      [
        {
          symbol: 'BTC-USD', lastPx: '63200', openPx: '62000', highPx: '63500', lowPx: '61900',
          volume: '100', quoteVolume: '6300000', vwap: '63000', change: '1200', changePct: 1.93,
          askPx: '63201', askSz: '1', bidPx: '63199', bidSz: '1', fundingRate: '0.00004', nextFundingTime: 0,
        },
        {
          symbol: 'NVDA-USD', lastPx: '180', openPx: '179', highPx: '181', lowPx: '178',
          volume: '500', quoteVolume: '90000', vwap: '180', change: '1', changePct: 0.55,
          askPx: '180.1', askSz: '10', bidPx: '179.9', bidSz: '10', fundingRate: '0.000005', nextFundingTime: 0,
        },
      ],
      [
        { symbol: 'BTC-USD', openInterest: '50', markPrice: '63250', indexPrice: '63100', fundingRate: '0.00004', nextFundingTime: 0 },
        { symbol: 'NVDA-USD', openInterest: '100', markPrice: '180', indexPrice: '180', fundingRate: '0.000005', nextFundingTime: 0 },
      ],
      [
        { symbol: 'BTC-USD', bidPx: '63199', bidSz: '2', askPx: '63201', askSz: '2' },
        { symbol: 'NVDA-USD', bidPx: '179.9', bidSz: '5', askPx: '180.1', askSz: '5' },
      ],
      [{ id: 10, name: 'vBTC_vUSDC', displayName: 'BTC/USDC', baseCoin: 'vBTC', quoteCoin: 'vUSDC', pricePrecision: 2 }],
      [{ symbol: 'vBTC_vUSDC', lastPx: '63000', bidPx: '62999', askPx: '63001', quoteVolume: '500000', changePct: 1.5 }],
      1.2,
    );

    const btc = markets.find((m) => m.symbol === 'BTC-USD')!;
    expect(btc.spotSymbol).toBe('vBTC_vUSDC');
    expect(btc.spotPerpSpreadBps).toBeCloseTo(39.68, 1);
    expect(btc.conviction.direction).toBe('BASIS ARB');
    expect(btc.conviction.score).toBeGreaterThan(50);
    expect(btc.conviction.score).toBeLessThanOrEqual(100);
  });

  it('simulates exact L2 orderbook VWAP and slippage bps across multiple levels', () => {
    const asks: [string, string][] = [
      ['100.0', '10'], // $1,000
      ['101.0', '20'], // $2,020
      ['103.0', '50'], // $5,150
    ];
    const res = simulateOrderbookSlippage(asks, 'BUY', 2010, 99.95);
    expect(res.levelsConsumed).toBe(2);
    expect(res.exhaustedBook).toBe(false);
    expect(res.filledQty).toBeCloseTo(20, 4);
    expect(res.vwapPrice).toBeCloseTo(100.5, 4);
    expect(res.slippageBps).toBeCloseTo(55.03, 1);
  });

  it('computes L2 bid/ask imbalance percentage accurately', () => {
    const imb = computeOrderbookImbalance([['100', '30']], [['100', '10']], 5);
    expect(imb.bidUsd).toBe(3000);
    expect(imb.askUsd).toBe(1000);
    expect(imb.imbalancePct).toBe(50);
  });

  it('detects UPTREND, DOWNTREND, and CHOP market regimes from OHLCV klines', () => {
    const upBars: KlineBar[] = Array.from({ length: 30 }, (_, i) => ({
      t: i * 3600_000,
      o: 100 + i * 2,
      h: 101 + i * 2,
      l: 99.5 + i * 2,
      c: 100.8 + i * 2,
      v: 10,
      q: 1000,
      n: 5,
    }));
    expect(detectMarketRegime(upBars).regime).toBe('UPTREND');

    const chopBars: KlineBar[] = Array.from({ length: 30 }, (_, i) => ({
      t: i * 3600_000,
      o: 100 + (i % 2 === 0 ? 1 : -1),
      h: 102,
      l: 98,
      c: 100 + (i % 2 === 0 ? -0.8 : 0.8),
      v: 10,
      q: 1000,
      n: 5,
    }));
    expect(detectMarketRegime(chopBars).regime).toBe('CHOP');
  });

  it('enforces fail-closed Pre-Trade Risk Guardrails (Kill Switch, Leverage, Slippage, Liq Buffer)', () => {
    const mockMarket: EnrichedMarket = enrichMarkets(
      [sampleContract],
      [{
        symbol: 'BTC-USD', lastPx: '60000', openPx: '60000', highPx: '60500', lowPx: '59500',
        volume: '10', quoteVolume: '600000', vwap: '60000', change: '0', changePct: 0,
        askPx: '60005', askSz: '1', bidPx: '59995', bidSz: '1', fundingRate: '0.00002', nextFundingTime: 0,
      }],
      [{ symbol: 'BTC-USD', openInterest: '10', markPrice: '60000', indexPrice: '60000', fundingRate: '0.00002', nextFundingTime: 0 }],
      [{ symbol: 'BTC-USD', bidPx: '59995', bidSz: '1', askPx: '60005', askSz: '1' }],
      [],
      [],
    )[0];

    const passEval = evaluatePreTradeRisk({
      market: mockMarket,
      side: 'LONG',
      accountEquityUsd: 10000,
      riskPctPerTrade: 1,
      leverage: 5,
      entryPrice: 60000,
      stopLossPrice: 58800,
      takeProfitPrice: 63000,
      estimatedSlippageBps: 5,
      killSwitchActive: false,
      existingExposureUsd: 0,
      realizedDailyLossUsd: 0,
      maxDailyDrawdownPct: 5,
      maxSlippageBps: 35,
    });
    expect(passEval.approved).toBe(true);
    expect(passEval.positionNotionalUsd).toBeCloseTo(5000, 0);
    expect(passEval.riskRewardRatio).toBeCloseTo(2.5, 2);
    expect(passEval.orderPayload.message.symbol).toBe('BTC-USD');

    // Kill switch blocks execution
    const killedEval = evaluatePreTradeRisk({
      market: mockMarket,
      side: 'LONG',
      accountEquityUsd: 10000,
      riskPctPerTrade: 1,
      leverage: 5,
      entryPrice: 60000,
      stopLossPrice: 58800,
      takeProfitPrice: 63000,
      estimatedSlippageBps: 5,
      killSwitchActive: true,
      existingExposureUsd: 0,
      realizedDailyLossUsd: 0,
      maxDailyDrawdownPct: 5,
      maxSlippageBps: 35,
    });
    expect(killedEval.approved).toBe(false);

    // Slippage breach blocks execution
    const highSlipEval = evaluatePreTradeRisk({
      market: mockMarket,
      side: 'LONG',
      accountEquityUsd: 10000,
      riskPctPerTrade: 1,
      leverage: 5,
      entryPrice: 60000,
      stopLossPrice: 58800,
      takeProfitPrice: 63000,
      estimatedSlippageBps: 60,
      killSwitchActive: false,
      existingExposureUsd: 0,
      realizedDailyLossUsd: 0,
      maxDailyDrawdownPct: 5,
      maxSlippageBps: 35,
    });
    expect(highSlipEval.approved).toBe(false);
  });

  it('builds counterfactual gated vs ungated equity curves', () => {
    const trades: PaperTrade[] = [
      {
        id: '1', createdAt: 1, closedAt: 2, network: 'mainnet', symbol: 'BTC-USD', side: 'LONG',
        entryPrice: 60000, stopLoss: 59000, takeProfit: 62000, qty: 0.1, notionalUsd: 6000,
        leverage: 3, riskUsd: 100, entrySlippageBps: 3, convictionScore: 78, status: 'CLOSED',
        exitPrice: 59000, realizedPnlUsd: -100, riskGatePassed: true,
      },
    ];
    const curves = buildCounterfactualCurves(trades, 10000);
    expect(curves).toHaveLength(2);
    expect(curves[1].gatedEquity).toBe(9900);
    expect(curves[1].ungatedEquity).toBeLessThan(9900);
  });

  it('computes 2-leg Delta-Neutral Cash-and-Carry net APR and breakeven hours from live Spot + Perp L2 books', () => {
    const market = enrichMarkets(
      [sampleContract],
      [{
        symbol: 'BTC-USD', lastPx: '63200', openPx: '62000', highPx: '63500', lowPx: '61900',
        volume: '100', quoteVolume: '6300000', vwap: '63000', change: '1200', changePct: 1.9,
        askPx: '63201', askSz: '2', bidPx: '63199', bidSz: '2', fundingRate: '0.00005', nextFundingTime: 0,
      }],
      [{ symbol: 'BTC-USD', openInterest: '50', markPrice: '63200', indexPrice: '63050', fundingRate: '0.00005', nextFundingTime: 0 }],
      [{ symbol: 'BTC-USD', bidPx: '63199', bidSz: '2', askPx: '63201', askSz: '2' }],
      [{ id: 10, name: 'vBTC_vUSDC', displayName: 'BTC/USDC', baseCoin: 'vBTC', quoteCoin: 'vUSDC', pricePrecision: 2 }],
      [{ symbol: 'vBTC_vUSDC', lastPx: '63050', bidPx: '63049', askPx: '63051', quoteVolume: '900000', changePct: 1.8 }],
    )[0];

    const spotOb: OrderbookData = {
      blockTime: 1, blockHeight: 100, updateID: 1,
      bids: [['63049', '5']],
      asks: [['63051', '5']],
    };
    const perpOb: OrderbookData = {
      blockTime: 1, blockHeight: 100, updateID: 1,
      bids: [['63199', '5']],
      asks: [['63201', '5']],
    };

    const res = computeDeltaNeutralCarry({
      market,
      notionalUsd: 25_000,
      holdingDays: 30,
      strategy: 'CASH_AND_CARRY',
      executionMode: 'TAKER',
      captureBasisConvergence: true,
      spotOrderbook: spotOb,
      perpOrderbook: perpOb,
    });

    expect(res.spotBookLive).toBe(true);
    expect(res.perpBookLive).toBe(true);
    expect(res.grossFundingAprPct).toBeCloseTo(43.8, 1);
    expect(res.netAprPct).toBeGreaterThan(30);
    expect(res.verdict).toBe('POSITIVE_EDGE');
    expect(res.atomicPlan.legs[0].symbol).toBe('vBTC_vUSDC');
    expect(res.atomicPlan.legs[1].symbol).toBe('BTC-USD');
  });

  it('flags NEGATIVE_AFTER_COSTS when thin L2 slippage and fees overwhelm short-horizon carry', () => {
    const market = enrichMarkets(
      [sampleContract],
      [{
        symbol: 'BTC-USD', lastPx: '63000', openPx: '63000', highPx: '63100', lowPx: '62900',
        volume: '10', quoteVolume: '630000', vwap: '63000', change: '0', changePct: 0,
        askPx: '63010', askSz: '1', bidPx: '62990', bidSz: '1', fundingRate: '0.000002', nextFundingTime: 0,
      }],
      [{ symbol: 'BTC-USD', openInterest: '10', markPrice: '63000', indexPrice: '63000', fundingRate: '0.000002', nextFundingTime: 0 }],
      [{ symbol: 'BTC-USD', bidPx: '62990', bidSz: '1', askPx: '63010', askSz: '1' }],
      [],
      [],
    )[0];

    const thinOb: OrderbookData = {
      blockTime: 1, blockHeight: 100, updateID: 1,
      bids: [['62900', '0.1'], ['62500', '2']],
      asks: [['63100', '0.1'], ['63500', '2']],
    };

    const res = computeDeltaNeutralCarry({
      market,
      notionalUsd: 50_000,
      holdingDays: 7,
      strategy: 'CASH_AND_CARRY',
      executionMode: 'TAKER',
      captureBasisConvergence: false,
      spotOrderbook: thinOb,
      perpOrderbook: thinOb,
    });

    expect(res.netPnlUsd).toBeLessThan(0);
    expect(res.verdict).toBe('NEGATIVE_AFTER_COSTS');
  });

  it('handles REVERSE_CARRY (short spot / long perp) when funding is deeply negative', () => {
    const market = enrichMarkets(
      [sampleContract],
      [{
        symbol: 'BTC-USD', lastPx: '63000', openPx: '63000', highPx: '63100', lowPx: '62900',
        volume: '50', quoteVolume: '3150000', vwap: '63000', change: '0', changePct: 0,
        askPx: '63001', askSz: '5', bidPx: '62999', bidSz: '5', fundingRate: '-0.00006', nextFundingTime: 0,
      }],
      [{ symbol: 'BTC-USD', openInterest: '50', markPrice: '63000', indexPrice: '63020', fundingRate: '-0.00006', nextFundingTime: 0 }],
      [{ symbol: 'BTC-USD', bidPx: '62999', bidSz: '5', askPx: '63001', askSz: '5' }],
      [],
      [],
    )[0];

    const res = computeDeltaNeutralCarry({
      market,
      notionalUsd: 10_000,
      holdingDays: 30,
      strategy: 'REVERSE_CARRY',
      executionMode: 'MAKER',
      captureBasisConvergence: true,
      spotOrderbook: null,
      perpOrderbook: null,
    });

    expect(res.spotLegSide).toBe('SELL');
    expect(res.perpLegSide).toBe('LONG');
    expect(res.grossFundingAprPct).toBeCloseTo(52.56, 1);
    expect(res.netAprPct).toBeGreaterThan(40);
    expect(res.verdict).toBe('POSITIVE_EDGE');
  });

  it('parses live SoDEX WebSocket l2Book, trade, and markPrice payloads cleanly', () => {
    const l2 = parseSodexWsMessage(
      JSON.stringify({
        channel: 'l2Book',
        type: 'snapshot',
        data: { E: 1795448165114, s: 'BTC-USD', u: 3573943375, a: [['63092', '0.8']], b: [['63091', '1.7']] },
      }),
    );
    expect(l2.kind).toBe('l2Book');
    expect(l2.l2Book?.bids[0][0]).toBe('63091');
    expect(l2.l2Book?.asks[0][0]).toBe('63092');

    const tr = parseSodexWsMessage(
      JSON.stringify({
        channel: 'trade',
        type: 'update',
        data: [{ E: 1795448165983, T: 1795448165945, t: 17908606, s: 'BTC-USD', S: 'SELL', p: '63072', q: '0.089' }],
      }),
    );
    expect(tr.kind).toBe('trade');
    expect(tr.trades?.[0].S).toBe('SELL');
    expect(tr.trades?.[0].p).toBe(63072);

    const mp = parseSodexWsMessage(
      JSON.stringify({
        channel: 'markPrice',
        type: 'update',
        data: [{ E: 1795448166245, s: 'BTC-USD', oi: '722.95', p: '63060', i: '63092', r: '0.000006', T: 1795449600000 }],
      }),
    );
    expect(mp.kind).toBe('markPrice');
    expect(mp.markPrice?.markPrice).toBe(63060);

    expect(parseSodexWsMessage('not-json').kind).toBe('ignore');
  });

  it('produces deterministic empirical bootstrap Monte Carlo VaR/CVaR from live klines', () => {
    const market = enrichMarkets(
      [sampleContract],
      [{
        symbol: 'BTC-USD', lastPx: '63000', openPx: '62500', highPx: '63500', lowPx: '62000',
        volume: '100', quoteVolume: '6300000', vwap: '63000', change: '500', changePct: 0.8,
        askPx: '63002', askSz: '5', bidPx: '62998', bidSz: '5', fundingRate: '0.00003', nextFundingTime: 0,
      }],
      [{ symbol: 'BTC-USD', openInterest: '200', markPrice: '63000', indexPrice: '62980', fundingRate: '0.00003', nextFundingTime: 0 }],
      [{ symbol: 'BTC-USD', bidPx: '62998', bidSz: '5', askPx: '63002', askSz: '5' }],
      [],
      [],
    )[0];

    const klines: KlineBar[] = Array.from({ length: 30 }, (_, i) => {
      const px = 62000 + Math.sin(i * 0.7) * 650 + i * 25;
      return { t: 1_700_000_000_000 + i * 3_600_000, o: px - 40, h: px + 120, l: px - 120, c: px, v: 50, q: 3_000_000, n: 200 };
    });

    const input = {
      market,
      klines,
      side: 'SHORT' as const,
      accountEquityUsd: 10_000,
      positionNotionalUsd: 4_000,
      positionQty: 4_000 / 63_000,
      entryPrice: 63_000,
      stopLossPrice: 64_575,
      takeProfitPrice: 59_850,
      liquidationPrice: 82_000,
      entrySlippageBps: 2,
      horizonHours: 72 as const,
      numPaths: 500,
    };

    const run1 = runLiveBootstrapMonteCarlo(input);
    const run2 = runLiveBootstrapMonteCarlo(input);

    expect(run1).toEqual(run2); // 100% deterministic seeded PRNG
    expect(run1.sampleReturnsCount).toBe(29);
    expect(run1.cvar99Usd).toBeGreaterThanOrEqual(run1.var95Usd);
    expect(run1.annualizedRealizedVolPct).toBeGreaterThan(0);
    expect(run1.bands.length).toBe(13);
    expect(run1.stressScenarios.length).toBe(4);
    expect(run1.stressScenarios.find((s) => s.id === 'short-squeeze')?.outcome).toBe('STOPPED');
  });

  it('detects liquidation risk in Monte Carlo when leverage is tight and volatility is extreme', () => {
    const market = enrichMarkets(
      [sampleContract],
      [{
        symbol: 'BTC-USD', lastPx: '63000', openPx: '63000', highPx: '65000', lowPx: '61000',
        volume: '100', quoteVolume: '6300000', vwap: '63000', change: '0', changePct: 0,
        askPx: '63002', askSz: '5', bidPx: '62998', bidSz: '5', fundingRate: '0', nextFundingTime: 0,
      }],
      [{ symbol: 'BTC-USD', openInterest: '200', markPrice: '63000', indexPrice: '63000', fundingRate: '0', nextFundingTime: 0 }],
      [{ symbol: 'BTC-USD', bidPx: '62998', bidSz: '5', askPx: '63002', askSz: '5' }],
      [],
      [],
    )[0];

    const volatileKlines: KlineBar[] = Array.from({ length: 20 }, (_, i) => {
      const px = i % 2 === 0 ? 63_000 : 60_200;
      return { t: 1_700_000_000_000 + i * 3_600_000, o: px, h: px * 1.02, l: px * 0.98, c: px, v: 50, q: 3_000_000, n: 100 };
    });

    const res = runLiveBootstrapMonteCarlo({
      market,
      klines: volatileKlines,
      side: 'LONG',
      accountEquityUsd: 10_000,
      positionNotionalUsd: 200_000,
      positionQty: 200_000 / 63_000,
      entryPrice: 63_000,
      stopLossPrice: 55_000, // stop below liq
      takeProfitPrice: 75_000,
      liquidationPrice: 61_500, // tight 20x liq
      entrySlippageBps: 5,
      horizonHours: 24,
      numPaths: 300,
    });

    expect(res.liquidationProbPct).toBeGreaterThan(20);
    expect(res.stressScenarios.find((s) => s.id === 'liq-cascade')?.outcome).toBe('LIQUIDATED');
  });

  it('serializes live scanner markets to valid RFC-4180 CSV', () => {
    const market = enrichMarkets(
      [sampleContract],
      [{
        symbol: 'BTC-USD', lastPx: '63000', openPx: '62000', highPx: '63500', lowPx: '61500',
        volume: '100', quoteVolume: '6300000', vwap: '63000', change: '1000', changePct: 1.6,
        askPx: '63002', askSz: '5', bidPx: '62998', bidSz: '5', fundingRate: '0.00002', nextFundingTime: 0,
      }],
      [{ symbol: 'BTC-USD', openInterest: '200', markPrice: '63000', indexPrice: '62990', fundingRate: '0.00002', nextFundingTime: 0 }],
      [{ symbol: 'BTC-USD', bidPx: '62998', bidSz: '5', askPx: '63002', askSz: '5' }],
      [{ id: 1, name: 'vBTC_vUSDC', displayName: 'BTC/USDC', baseCoin: 'vBTC', quoteCoin: 'vUSDC', pricePrecision: 2 }],
      [{ symbol: 'vBTC_vUSDC', lastPx: '62980', bidPx: '62975', askPx: '62985', quoteVolume: '1200000', changePct: 1.5 }],
    );

    const csv = serializeMarketsToCsv(market);
    const lines = csv.split('\n');
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('annualizedFundingAprPct');
    expect(lines[1]).toContain('BTC-USD,Crypto,63000');
    expect(lines[1]).toContain('vBTC_vUSDC');
  });
});
