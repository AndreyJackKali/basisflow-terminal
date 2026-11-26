import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildCounterfactualCurves,
  buildEtfFundingCrossChecks,
  classifyAsset,
  computeAnnualizedFundingApr,
  computeBasisBps,
  computeBidAskSpreadBps,
  computeCarryStressScenario,
  computeDeltaNeutralCarry,
  computeEtfFlowStats,
  computeOrderbookImbalance,
  computeSoloDeskEconomics,
  computeSpotPerpSpreadBps,
  computeSsiSectorFunding,
  detectMarketRegime,
  enrichMarkets,
  evaluatePreTradeRisk,
  generateOperatorSignalBrief,
  runLiveBootstrapMonteCarlo,
  serializeCarryTicketCsv,
  serializeMarketsToCsv,
  simulateOrderbookSlippage,
  STALE_BASIS_BPS,
  summarizeQualityAlerts,
  THIN_BOOK_SCORE_CAP,
  THIN_BOOK_USD,
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

  it('flags stale spot prints and thin books instead of ranking them as tradable edges', () => {
    const markets = enrichMarkets(
      [
        sampleContract,
        { ...sampleContract, id: 3, name: 'ADA-USD', displayName: 'ADA-USD', baseCoin: 'ADA' },
      ],
      [
        {
          symbol: 'BTC-USD', lastPx: '63200', openPx: '62000', highPx: '63500', lowPx: '61900',
          volume: '100', quoteVolume: '6300000', vwap: '63000', change: '1200', changePct: 1.93,
          askPx: '63201', askSz: '1', bidPx: '63199', bidSz: '1', fundingRate: '0.00004', nextFundingTime: 0,
        },
        {
          symbol: 'ADA-USD', lastPx: '0.1421', openPx: '0.15', highPx: '0.15', lowPx: '0.14',
          volume: '40000', quoteVolume: '6300', vwap: '0.142', change: '-0.007', changePct: -4.56,
          askPx: '0.1422', askSz: '100', bidPx: '0.1420', bidSz: '100', fundingRate: '0.000001', nextFundingTime: 0,
        },
      ],
      [
        { symbol: 'BTC-USD', openInterest: '50', markPrice: '63250', indexPrice: '63100', fundingRate: '0.00004', nextFundingTime: 0 },
        { symbol: 'ADA-USD', openInterest: '1500', markPrice: '0.1421', indexPrice: '0.1421', fundingRate: '0.000001', nextFundingTime: 0 },
      ],
      [
        { symbol: 'BTC-USD', bidPx: '63199', bidSz: '2', askPx: '63201', askSz: '2' },
        { symbol: 'ADA-USD', bidPx: '0.1420', bidSz: '100', askPx: '0.1422', askSz: '100' },
      ],
      [{ id: 11, name: 'vADA_vUSDC', displayName: 'ADA/USDC', baseCoin: 'vADA', quoteCoin: 'vUSDC', pricePrecision: 4 }],
      [{ symbol: 'vADA_vUSDC', lastPx: '0.2538', bidPx: '0.2500', askPx: '0.2576', quoteVolume: '120', changePct: 0 }],
      0,
    );
    const ada = markets.find((m) => m.symbol === 'ADA-USD')!;
    expect(Math.abs(ada.spotPerpSpreadBps!)).toBeGreaterThan(STALE_BASIS_BPS);
    expect(ada.conviction.direction).not.toBe('BASIS ARB');
    expect(ada.conviction.qualityFlags).toEqual(['STALE_SPOT', 'THIN_BOOK']);
    expect(ada.conviction.score).toBeLessThanOrEqual(THIN_BOOK_SCORE_CAP);
    expect(ada.conviction.rationale).toContain('stale');
    const btc = markets.find((m) => m.symbol === 'BTC-USD')!;
    expect(btc.conviction.qualityFlags).toEqual([]);
    expect(btc.quoteVolume24h).toBeGreaterThanOrEqual(THIN_BOOK_USD);
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

  it('computes SoSoValue US Spot ETF flow stats, streak, and 30d z-score accurately', () => {
    const rows = [
      { date: '2026-11-20', totalNetInflow: -669_000_000, totalValueTraded: 4_700_000_000, totalNetAssets: 71_345_000_000, cumNetInflow: 52_843_000_000 },
      { date: '2026-11-19', totalNetInflow: -582_000_000, totalValueTraded: 3_235_000_000, totalNetAssets: 76_549_000_000, cumNetInflow: 53_512_000_000 },
      { date: '2026-11-18', totalNetInflow: 120_000_000, totalValueTraded: 2_800_000_000, totalNetAssets: 77_000_000_000, cumNetInflow: 54_094_000_000 },
      { date: '2026-11-17', totalNetInflow: 210_000_000, totalValueTraded: 2_500_000_000, totalNetAssets: 76_800_000_000, cumNetInflow: 53_974_000_000 },
      { date: '2026-11-16', totalNetInflow: 95_000_000, totalValueTraded: 2_200_000_000, totalNetAssets: 76_500_000_000, cumNetInflow: 53_764_000_000 },
    ];
    const stats = computeEtfFlowStats(rows);
    expect(stats.latestDate).toBe('2026-11-20');
    expect(stats.fiveDayNetInflow).toBe(-826_000_000);
    expect(stats.streakDays).toBe(-2);
    expect(stats.zScore30d).toBeLessThan(-1);
    expect(stats.totalNetAssets).toBe(71_345_000_000);
  });

  it('cross-checks SoSoValue ETF outflows against positive SoDEX perp funding to flag carry-short divergence', () => {
    const markets = enrichMarkets(
      [sampleContract],
      [{
        symbol: 'BTC-USD', lastPx: '88000', openPx: '87000', highPx: '89000', lowPx: '86000',
        volume: '500', quoteVolume: '44000000', vwap: '88000', change: '1000', changePct: 1.15,
        askPx: '88005', askSz: '5', bidPx: '87995', bidSz: '5', fundingRate: '0.00002', nextFundingTime: 0,
      }],
      [{ symbol: 'BTC-USD', openInterest: '300', markPrice: '88040', indexPrice: '88000', fundingRate: '0.00002', nextFundingTime: 0 }],
      [{ symbol: 'BTC-USD', bidPx: '87995', bidSz: '5', askPx: '88005', askSz: '5' }],
      [{ id: 1, name: 'vBTC_vUSDC', displayName: 'BTC/USDC', baseCoin: 'vBTC', quoteCoin: 'vUSDC', pricePrecision: 2 }],
      [{ symbol: 'vBTC_vUSDC', lastPx: '87980', bidPx: '87975', askPx: '87985', quoteVolume: '4000000', changePct: 1.1 }],
    );

    const checks = buildEtfFundingCrossChecks(
      {
        BTC: [
          { date: '2026-11-20', totalNetInflow: -500_000_000, totalValueTraded: 4e9, totalNetAssets: 71e9, cumNetInflow: 52e9 },
          { date: '2026-11-19', totalNetInflow: -300_000_000, totalValueTraded: 3e9, totalNetAssets: 72e9, cumNetInflow: 52.5e9 },
        ],
        ETH: [],
        SOL: [],
        XRP: [],
      },
      markets,
    );

    const btc = checks.find((c) => c.asset === 'BTC')!;
    expect(btc.hasLivePerp).toBe(true);
    expect(btc.perpFundingAprPct).toBeCloseTo(17.52, 1);
    expect(btc.regimeTag).toBe('DIVERGENCE: CARRY SHORT');
  });

  it('joins SoSoValue SSI indices with overlapping SoDEX sector perp funding averages', () => {
    const markets = enrichMarkets(
      [
        sampleContract,
        { ...sampleContract, id: 2, name: 'ETH-USD', displayName: 'ETH-USD', baseCoin: 'ETH' },
      ],
      [
        {
          symbol: 'BTC-USD', lastPx: '88000', openPx: '88000', highPx: '88500', lowPx: '87500',
          volume: '100', quoteVolume: '8800000', vwap: '88000', change: '0', changePct: 0,
          askPx: '88001', askSz: '1', bidPx: '87999', bidSz: '1', fundingRate: '0.00001', nextFundingTime: 0,
        },
        {
          symbol: 'ETH-USD', lastPx: '3000', openPx: '3000', highPx: '3050', lowPx: '2950',
          volume: '1000', quoteVolume: '3000000', vwap: '3000', change: '0', changePct: 0,
          askPx: '3001', askSz: '5', bidPx: '2999', bidSz: '5', fundingRate: '0.00003', nextFundingTime: 0,
        },
      ],
      [
        { symbol: 'BTC-USD', openInterest: '100', markPrice: '88000', indexPrice: '88000', fundingRate: '0.00001', nextFundingTime: 0 },
        { symbol: 'ETH-USD', openInterest: '1000', markPrice: '3000', indexPrice: '3000', fundingRate: '0.00003', nextFundingTime: 0 },
      ],
      [
        { symbol: 'BTC-USD', bidPx: '87999', bidSz: '2', askPx: '88001', askSz: '2' },
        { symbol: 'ETH-USD', bidPx: '2999', bidSz: '5', askPx: '3001', askSz: '5' },
      ],
      [],
      [],
    );

    const rows = computeSsiSectorFunding(
      [{ ticker: 'ssiMAG7', price: 10.67, changePct24h: -0.014, roi7d: -0.179, roi1m: -0.268, roi3m: -0.19, roi1y: -0.469, ytd: -0.393 }],
      markets,
    );
    expect(rows[0].matchedSymbols).toEqual(['BTC-USD', 'ETH-USD']);
    // Average of +8.76% and +26.28% = +17.52% APR
    expect(rows[0].avgFundingAprPct).toBeCloseTo(17.52, 1);
  });

  it('computes solo carry-desk fee split, MRR, ARR, and client net alpha accurately', () => {
    const res = computeSoloDeskEconomics({
      managedAumUsd: 250_000,
      capitalUtilizationPct: 80,
      liveGrossCarryAprPct: 22.2,
      executionDragAprPct: 2.2,
      managementFeePct: 1.0,
      performanceFeePct: 15,
      benchmarkAprPct: 4.5,
      paidSubscribers: 30,
      monthlySubPriceUsd: 50,
      x402CallsPerDay: 200,
      x402PricePerCallUsd: 0.05,
      monthlyInfraCostUsd: 200,
    });
    // Deployed = 200k @ 20% net carry = $40k gross; mgmt = $2,500; perf = 15% * 37,500 = $5,625
    expect(res.deployedCapitalUsd).toBe(200_000);
    expect(res.grossVaultProfitAnnualUsd).toBe(40_000);
    expect(res.managementFeeAnnualUsd).toBe(2_500);
    expect(res.performanceFeeAnnualUsd).toBe(5_625);
    expect(res.subscriptionMrrUsd).toBe(1_500);
    expect(res.x402ApiMrrUsd).toBe(300);
    expect(res.clientNetAprPct).toBeCloseTo(12.75, 2);
    expect(res.alphaOverBenchmarkPct).toBeCloseTo(8.25, 2);
    expect(res.viabilityTag).toBe('PROFITABLE SOLO DESK');
  });

  it('enforces high-water-mark protection (zero performance fee when carry is negative)', () => {
    const res = computeSoloDeskEconomics({
      managedAumUsd: 100_000,
      capitalUtilizationPct: 100,
      liveGrossCarryAprPct: -5,
      executionDragAprPct: 2,
      managementFeePct: 1,
      performanceFeePct: 20,
      benchmarkAprPct: 4.5,
      paidSubscribers: 0,
      monthlySubPriceUsd: 49,
      x402CallsPerDay: 0,
      x402PricePerCallUsd: 0.05,
      monthlyInfraCostUsd: 300,
    });
    expect(res.performanceFeeAnnualUsd).toBe(0);
    expect(res.totalNetMrrUsd).toBeLessThan(0);
    expect(res.viabilityTag).toBe('BELOW BREAKEVEN');
    expect(res.breakevenSubscribers).toBeGreaterThan(0);
  });

  it('calculates zero breakeven subscribers when vault + x402 already covers infra', () => {
    const res = computeSoloDeskEconomics({
      managedAumUsd: 500_000,
      capitalUtilizationPct: 80,
      liveGrossCarryAprPct: 15,
      executionDragAprPct: 2,
      managementFeePct: 1,
      performanceFeePct: 15,
      benchmarkAprPct: 4.5,
      paidSubscribers: 0,
      monthlySubPriceUsd: 49,
      x402CallsPerDay: 100,
      x402PricePerCallUsd: 0.05,
      monthlyInfraCostUsd: 150,
    });
    expect(res.breakevenSubscribers).toBe(0);
  });

  it('clamps out-of-range utilization and fee percentages cleanly', () => {
    const res = computeSoloDeskEconomics({
      managedAumUsd: -100,
      capitalUtilizationPct: 150,
      liveGrossCarryAprPct: 10,
      executionDragAprPct: 1,
      managementFeePct: 25,
      performanceFeePct: 90,
      benchmarkAprPct: 4.5,
      paidSubscribers: 10,
      monthlySubPriceUsd: 30,
      x402CallsPerDay: 0,
      x402PricePerCallUsd: 0,
      monthlyInfraCostUsd: 100,
    });
    expect(res.deployedCapitalUsd).toBe(0);
    expect(res.clientNetAprPct).toBe(0);
    expect(res.subscriptionMrrUsd).toBe(300);
    expect(res.viabilityTag).toBe('SCALING STAGE');
  });

  it('generates a deterministic Markdown & JSON operator signal brief from live data', () => {
    const markets = enrichMarkets(
      [sampleContract],
      [{
        symbol: 'BTC-USD', lastPx: '88000', openPx: '87000', highPx: '89000', lowPx: '86500',
        volume: '500', quoteVolume: '44000000', vwap: '88000', change: '1000', changePct: 1.15,
        askPx: '88005', askSz: '5', bidPx: '87995', bidSz: '5', fundingRate: '0.00002', nextFundingTime: 0,
      }],
      [{ symbol: 'BTC-USD', openInterest: '300', markPrice: '88040', indexPrice: '88000', fundingRate: '0.00002', nextFundingTime: 0 }],
      [{ symbol: 'BTC-USD', bidPx: '87995', bidSz: '5', askPx: '88005', askSz: '5' }],
      [],
      [],
    );
    const brief = generateOperatorSignalBrief(
      markets,
      {
        btcEtfFlowZScore: -1.31,
        ethEtfFlowZScore: -0.21,
        marketOverview: { totalMarketCap: 2.05e12, totalMarketCapChangePct: -2.1, totalVolume24h: 74e9, ethGasGwei: 0.2, btcGasSatVb: 0.1, asOf: 0 },
        hotNews: [{ id: '1', title: 'Live BTC Spot ETF Outflow Catalyst', summary: '', sourceLink: '', releaseTime: 0 }],
        snapshotFetchedAt: '2026-11-25T00:43:00Z',
      },
      'mainnet',
      3,
    );
    expect(brief.topCarrySignals.length).toBe(1);
    expect(brief.topCarrySignals[0].symbol).toBe('BTC-USD');
    expect(brief.markdown).toContain('BTC-USD');
    expect(brief.markdown).toContain('Live BTC Spot ETF Outflow Catalyst');
    expect(brief.markdown).toContain('-1.31');
  });
});

describe('v1.6.0 Carry-Trade Stress Simulator, Quality Alerts & Zero-Leak Snapshot', () => {
  const makeLiquidBtc = (fundingRate = '0.00004', quoteVolume = '44000000', spread = 2): EnrichedMarket =>
    enrichMarkets(
      [sampleContract],
      [{
        symbol: 'BTC-USD', lastPx: '88000', openPx: '87000', highPx: '89000', lowPx: '86500',
        volume: '500', quoteVolume, vwap: '88000', change: '1000', changePct: 1.15,
        askPx: String(88000 * (1 + spread / 20_000)), askSz: '5',
        bidPx: String(88000 * (1 - spread / 20_000)), bidSz: '5',
        fundingRate, nextFundingTime: 0,
      }],
      [{ symbol: 'BTC-USD', openInterest: '300', markPrice: '88000', indexPrice: '87980', fundingRate, nextFundingTime: 0 }],
      [{
        symbol: 'BTC-USD',
        bidPx: String(88000 * (1 - spread / 20_000)), bidSz: '5',
        askPx: String(88000 * (1 + spread / 20_000)), askSz: '5',
      }],
      [],
      [],
    )[0];

  const sampleEtfOutflows = {
    BTC: [
      { date: '2026-11-25', totalNetInflow: -450_000_000, totalValueTraded: 3e9, totalNetAssets: 72e9, cumNetInflow: 51e9 },
      { date: '2026-11-24', totalNetInflow: -230_000_000, totalValueTraded: 2.5e9, totalNetAssets: 72.4e9, cumNetInflow: 51.5e9 },
      { date: '2026-11-23', totalNetInflow: -310_000_000, totalValueTraded: 2.8e9, totalNetAssets: 73e9, cumNetInflow: 51.8e9 },
      { date: '2026-11-20', totalNetInflow: 80_000_000, totalValueTraded: 2.2e9, totalNetAssets: 73.5e9, cumNetInflow: 52e9 },
      { date: '2026-11-19', totalNetInflow: 110_000_000, totalValueTraded: 2.1e9, totalNetAssets: 73.4e9, cumNetInflow: 51.9e9 },
    ],
    ETH: [],
    SOL: [],
    XRP: [],
  };

  it('computes net carry APY, ROE, break-even days, and liquidation buffer accurately', () => {
    // 0.00004/hr * 8760 = 35.04% gross APR; 25% decay => 26.28% decayed APR
    const btc = makeLiquidBtc('0.00004');
    const res = computeCarryStressScenario({
      market: btc,
      notionalUsd: 60_000,
      leverage: 3,
      holdingDays: 30,
      feeSlippageBps: 12,
      borrowCostAprPct: 4.5,
      fundingDecayPct: 25,
      side: 'SHORT_PERP',
      etfFlows: sampleEtfOutflows,
    });

    expect(res.collateralUsd).toBe(20_000);
    expect(res.grossFundingAprPct).toBeCloseTo(35.04, 1);
    expect(res.decayedFundingAprPct).toBeCloseTo(26.28, 1);
    expect(res.executionCostUsd).toBeCloseTo(72, 1);
    expect(res.netCarryUsd).toBeGreaterThan(950);
    expect(res.netApyOnNotionalPct).toBeGreaterThan(19);
    expect(res.netRoeAnnualizedPct).toBeCloseTo(res.netApyOnNotionalPct * 3, 0);
    expect(res.breakEvenDays).not.toBeNull();
    expect(res.breakEvenDays!).toBeGreaterThan(1);
    expect(res.breakEvenDays!).toBeLessThan(5);
    // 3x leverage, MMR=0.025 => buffer = (1/3 - 0.025)*100 = 30.83%
    expect(res.liquidationBufferPct).toBeCloseTo(30.83, 1);
    expect(res.liquidationRiskTier).toBe('LOW');
    expect(res.etfConfirmation.signal).toBe('CONFIRMED');
    expect(res.verdict).toBe('INSTITUTIONAL_GRADE');
  });

  it('orders funding-flip sensitivity rows monotonically from steady carry to severe -2x flip', () => {
    const btc = makeLiquidBtc('0.00003');
    const res = computeCarryStressScenario({
      market: btc,
      notionalUsd: 50_000,
      leverage: 4,
      holdingDays: 30,
      feeSlippageBps: 10,
      borrowCostAprPct: 4,
      fundingDecayPct: 20,
      side: 'SHORT_PERP',
    });

    expect(res.sensitivity).toHaveLength(5);
    for (let i = 1; i < res.sensitivity.length; i++) {
      expect(res.sensitivity[i].horizonPnlUsd).toBeLessThan(res.sensitivity[i - 1].horizonPnlUsd);
    }
    expect(res.fundingFlipDrawdown1xUsd).toBeLessThan(0);
    expect(res.fundingFlipDrawdown2xUsd).toBeLessThan(res.fundingFlipDrawdown1xUsd);
    expect(res.sensitivity[4].status).toBe('DRAWDOWN');
  });

  it('captures positive carry on LONG_PERP reverse carry when funding is deeply negative', () => {
    const btc = makeLiquidBtc('-0.00005'); // -43.8% raw => +43.8% for LONG_PERP
    const res = computeCarryStressScenario({
      market: btc,
      notionalUsd: 30_000,
      leverage: 2,
      holdingDays: 30,
      feeSlippageBps: 10,
      borrowCostAprPct: 3,
      fundingDecayPct: 0,
      side: 'LONG_PERP',
    });

    expect(res.grossFundingAprPct).toBeCloseTo(43.8, 1);
    expect(res.netCarryUsd).toBeGreaterThan(950);
    expect(res.liquidationPrice).toBeLessThan(btc.markPrice);
    expect(res.verdict).toBe('INSTITUTIONAL_GRADE');
  });

  it('does not artificially decay adverse negative funding and returns null breakEvenDays', () => {
    const btc = makeLiquidBtc('-0.00002'); // adverse for SHORT_PERP
    const res = computeCarryStressScenario({
      market: btc,
      notionalUsd: 25_000,
      leverage: 2,
      holdingDays: 30,
      feeSlippageBps: 12,
      borrowCostAprPct: 4,
      fundingDecayPct: 50,
      side: 'SHORT_PERP',
    });

    expect(res.grossFundingAprPct).toBeCloseTo(-17.52, 1);
    expect(res.decayedFundingAprPct).toBeCloseTo(-17.52, 1);
    expect(res.netCarryUsd).toBeLessThan(0);
    expect(res.breakEvenDays).toBeNull();
    expect(res.verdict).toBe('UNFAVORABLE_RISK');
  });

  it('flags CRITICAL liquidation risk and MAX_LEVERAGE_EXCEEDED on over-leveraged setups', () => {
    const btc = makeLiquidBtc('0.00004');
    const res = computeCarryStressScenario({
      market: btc,
      notionalUsd: 200_000, // tier 2 MMR = 5%
      leverage: 25, // exceeds contract maxLeverage 20x, 1/25 - 0.05 < 0 => 0% buffer
      holdingDays: 14,
      feeSlippageBps: 15,
      borrowCostAprPct: 4,
      fundingDecayPct: 10,
      side: 'SHORT_PERP',
    });

    expect(res.leverageExceeded).toBe(true);
    expect(res.liquidationBufferPct).toBe(0);
    expect(res.liquidationRiskTier).toBe('CRITICAL');
    expect(res.qualityWarnings.some((w) => w.startsWith('MAX_LEVERAGE_EXCEEDED'))).toBe(true);
    expect(res.qualityWarnings.some((w) => w.startsWith('TIGHT_LIQ_BUFFER'))).toBe(true);
    expect(res.verdict).toBe('UNFAVORABLE_RISK');
  });

  it('flags THIN_BOOK, STALE_SPOT, and WIDE_SPREAD warnings on illiquid/stale markets', () => {
    const illiquid = enrichMarkets(
      [{ ...sampleContract, id: 7, name: 'MICRO-USD', displayName: 'MICRO-USD', baseCoin: 'MICRO' }],
      [{
        symbol: 'MICRO-USD', lastPx: '1.00', openPx: '1.00', highPx: '1.05', lowPx: '0.95',
        volume: '150000', quoteVolume: '150000', vwap: '1.00', change: '0', changePct: 0,
        askPx: '1.0025', askSz: '100', bidPx: '0.9975', bidSz: '100', fundingRate: '0.00005', nextFundingTime: 0,
      }],
      [{ symbol: 'MICRO-USD', openInterest: '50000', markPrice: '1.00', indexPrice: '1.00', fundingRate: '0.00005', nextFundingTime: 0 }],
      [{ symbol: 'MICRO-USD', bidPx: '0.9975', bidSz: '100', askPx: '1.0025', askSz: '100' }],
      [{ id: 77, name: 'vMICRO_vUSDC', displayName: 'MICRO/USDC', baseCoin: 'vMICRO', quoteCoin: 'vUSDC', pricePrecision: 4 }],
      [{ symbol: 'vMICRO_vUSDC', lastPx: '1.35', bidPx: '1.34', askPx: '1.36', quoteVolume: '1000', changePct: 0 }],
    )[0];

    const res = computeCarryStressScenario({
      market: illiquid,
      notionalUsd: 10_000,
      leverage: 2,
      holdingDays: 30,
      feeSlippageBps: 20,
      borrowCostAprPct: 4,
      fundingDecayPct: 0,
      side: 'SHORT_PERP',
    });

    expect(res.qualityWarnings.some((w) => w.startsWith('THIN_BOOK'))).toBe(true);
    expect(res.qualityWarnings.some((w) => w.startsWith('STALE_SPOT'))).toBe(true);
    expect(res.qualityWarnings.some((w) => w.startsWith('WIDE_SPREAD'))).toBe(true);
    expect(res.verdict).not.toBe('INSTITUTIONAL_GRADE');
  });

  it('handles zero-volume markets and zero notional safely without NaN or Infinity', () => {
    const deadMarket = makeLiquidBtc('0.00002', '0');
    const res = computeCarryStressScenario({
      market: deadMarket,
      notionalUsd: 0,
      leverage: 3,
      holdingDays: 30,
      feeSlippageBps: 10,
      borrowCostAprPct: 4,
      fundingDecayPct: 20,
      side: 'SHORT_PERP',
    });

    expect(Number.isFinite(res.netApyOnNotionalPct)).toBe(true);
    expect(Number.isFinite(res.netRoeAnnualizedPct)).toBe(true);
    expect(res.qualityWarnings.some((w) => w.startsWith('ZERO_VOLUME'))).toBe(true);
    expect(res.verdict).toBe('UNFAVORABLE_RISK');
  });

  it('classifies SoSoValue ETF confirmation as DIVERGENT on strong inflows vs short perp, and NO_ETF_COVERAGE on equities', () => {
    const btc = makeLiquidBtc('0.00003');
    const strongInflows = {
      BTC: [
        { date: '2026-11-25', totalNetInflow: 950_000_000, totalValueTraded: 4e9, totalNetAssets: 75e9, cumNetInflow: 54e9 },
        { date: '2026-11-24', totalNetInflow: 120_000_000, totalValueTraded: 2.5e9, totalNetAssets: 74e9, cumNetInflow: 53e9 },
        { date: '2026-11-23', totalNetInflow: 100_000_000, totalValueTraded: 2.3e9, totalNetAssets: 73.8e9, cumNetInflow: 52.9e9 },
        { date: '2026-11-20', totalNetInflow: 90_000_000, totalValueTraded: 2.1e9, totalNetAssets: 73.7e9, cumNetInflow: 52.8e9 },
        { date: '2026-11-19', totalNetInflow: 85_000_000, totalValueTraded: 2.0e9, totalNetAssets: 73.6e9, cumNetInflow: 52.7e9 },
      ],
      ETH: [],
      SOL: [],
      XRP: [],
    };
    const divRes = computeCarryStressScenario({
      market: btc,
      notionalUsd: 50_000,
      leverage: 3,
      holdingDays: 30,
      feeSlippageBps: 10,
      borrowCostAprPct: 4,
      fundingDecayPct: 10,
      side: 'SHORT_PERP',
      etfFlows: strongInflows,
    });
    expect(divRes.etfConfirmation.signal).toBe('DIVERGENT');

    const nvda = enrichMarkets(
      [{ ...sampleContract, id: 8, name: 'NVDA-USD', displayName: 'NVDA-USD', baseCoin: 'NVDA' }],
      [{
        symbol: 'NVDA-USD', lastPx: '180', openPx: '180', highPx: '182', lowPx: '178',
        volume: '20000', quoteVolume: '3600000', vwap: '180', change: '0', changePct: 0,
        askPx: '180.05', askSz: '50', bidPx: '179.95', bidSz: '50', fundingRate: '0.00002', nextFundingTime: 0,
      }],
      [{ symbol: 'NVDA-USD', openInterest: '10000', markPrice: '180', indexPrice: '180', fundingRate: '0.00002', nextFundingTime: 0 }],
      [{ symbol: 'NVDA-USD', bidPx: '179.95', bidSz: '50', askPx: '180.05', askSz: '50' }],
      [],
      [],
    )[0];
    const eqRes = computeCarryStressScenario({
      market: nvda,
      notionalUsd: 20_000,
      leverage: 2,
      holdingDays: 30,
      feeSlippageBps: 10,
      borrowCostAprPct: 4,
      fundingDecayPct: 0,
      side: 'SHORT_PERP',
      etfFlows: strongInflows,
    });
    expect(eqRes.etfConfirmation.signal).toBe('NO_ETF_COVERAGE');
  });

  it('serializes carry stress ticket & 5 sensitivity rows to valid RFC-4180 CSV', () => {
    const btc = makeLiquidBtc('0.00004');
    const res = computeCarryStressScenario({
      market: btc,
      notionalUsd: 50_000,
      leverage: 3,
      holdingDays: 30,
      feeSlippageBps: 12,
      borrowCostAprPct: 4.5,
      fundingDecayPct: 25,
      side: 'SHORT_PERP',
      etfFlows: sampleEtfOutflows,
    });
    const csv = serializeCarryTicketCsv(res);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(6); // header + 5 scenarios
    expect(lines[0]).toContain('scenarioId,scenarioLabel');
    expect(lines[1]).toContain('BTC-USD,SHORT_PERP,steady');
    expect(lines[5]).toContain('flip_2x');
  });

  it('summarizes executable, thin-book, stale-spot, and divergence quality alerts accurately', () => {
    const markets = enrichMarkets(
      [
        sampleContract,
        { ...sampleContract, id: 9, name: 'THIN-USD', displayName: 'THIN-USD', baseCoin: 'THIN' },
      ],
      [
        {
          symbol: 'BTC-USD', lastPx: '88000', openPx: '88000', highPx: '89000', lowPx: '87000',
          volume: '500', quoteVolume: '44000000', vwap: '88000', change: '0', changePct: 0,
          askPx: '88005', askSz: '5', bidPx: '87995', bidSz: '5', fundingRate: '0.00002', nextFundingTime: 0,
        },
        {
          symbol: 'THIN-USD', lastPx: '1.00', openPx: '1.00', highPx: '1.05', lowPx: '0.95',
          volume: '50000', quoteVolume: '50000', vwap: '1.00', change: '0', changePct: 0,
          askPx: '1.003', askSz: '100', bidPx: '0.997', bidSz: '100', fundingRate: '0.00001', nextFundingTime: 0,
        },
      ],
      [
        { symbol: 'BTC-USD', openInterest: '300', markPrice: '88000', indexPrice: '88000', fundingRate: '0.00002', nextFundingTime: 0 },
        { symbol: 'THIN-USD', openInterest: '10000', markPrice: '1.00', indexPrice: '0.99', fundingRate: '0.00001', nextFundingTime: 0 },
      ],
      [
        { symbol: 'BTC-USD', bidPx: '87995', bidSz: '5', askPx: '88005', askSz: '5' },
        { symbol: 'THIN-USD', bidPx: '0.997', bidSz: '100', askPx: '1.003', askSz: '100' },
      ],
      [{ id: 99, name: 'vTHIN_vUSDC', displayName: 'THIN/USDC', baseCoin: 'vTHIN', quoteCoin: 'vUSDC', pricePrecision: 4 }],
      [{ symbol: 'vTHIN_vUSDC', lastPx: '1.40', bidPx: '1.39', askPx: '1.41', quoteVolume: '500', changePct: 0 }],
    );

    const summary = summarizeQualityAlerts(markets);
    expect(summary.totalMarkets).toBe(2);
    expect(summary.executableCount).toBe(1);
    expect(summary.thinBookCount).toBe(1);
    expect(summary.staleSpotCount).toBe(1);
    expect(summary.divergenceAlertCount).toBe(1);
  });

  it('validates bundled public/data/soso-snapshot.json schema integrity (24/24 endpoints)', () => {
    const snapPath = path.resolve(process.cwd(), 'public/data/soso-snapshot.json');
    const raw = fs.readFileSync(snapPath, 'utf-8');
    const snap = JSON.parse(raw);

    expect(snap.endpointsVerified).toBe(24);
    expect(typeof snap.fetchedAt).toBe('string');
    expect(snap.marketOverview).toBeTruthy();
    expect(snap.marketOverview.totalMarketCap).toBeGreaterThan(0);
    expect(snap.etfFlows.BTC.length).toBeGreaterThan(0);
    expect(snap.etfFlows.ETH.length).toBeGreaterThan(0);
    expect(snap.etfFlows.SOL.length).toBeGreaterThan(0);
    expect(snap.etfFlows.XRP.length).toBeGreaterThan(0);
    expect(snap.ssiIndices.length).toBeGreaterThanOrEqual(13);
    expect(snap.hotNews.length).toBeGreaterThan(0);
    expect(snap.treasuries.length).toBeGreaterThan(0);
  });

  it('enforces zero-secret regression guard on bundled SoSoValue snapshot and judge HTML assets', () => {
    const filesToAudit = [
      'public/data/soso-snapshot.json',
      'public/judge-brief.html',
      'public/deck.html',
    ];
    const forbiddenPatterns = [
      /SOSO-[A-Za-z0-9]{10,}/,
      /ghp_[A-Za-z0-9]{10,}/,
      /github_pat_[A-Za-z0-9_]{10,}/,
      /Bearer\s+[A-Za-z0-9._-]{20,}/,
      /x-soso-api-key["']?\s*[:=]\s*["'][A-Za-z0-9_-]{8,}/i,
    ];

    for (const rel of filesToAudit) {
      const content = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf-8');
      for (const re of forbiddenPatterns) {
        expect(re.test(content), `Potential secret pattern ${re} matched in ${rel}`).toBe(false);
      }
    }
  });
});
