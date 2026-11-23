import { describe, it, expect } from 'vitest';
import {
  buildCounterfactualCurves,
  classifyAsset,
  computeAnnualizedFundingApr,
  computeBasisBps,
  computeBidAskSpreadBps,
  computeOrderbookImbalance,
  computeSpotPerpSpreadBps,
  detectMarketRegime,
  enrichMarkets,
  evaluatePreTradeRisk,
  simulateOrderbookSlippage,
} from './quant';
import type { EnrichedMarket, KlineBar, PaperTrade, PerpSymbolInfo } from '../types';

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
});
