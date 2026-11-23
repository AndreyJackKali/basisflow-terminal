export type NetworkMode = 'mainnet' | 'testnet';

export type AssetClass = 'Crypto' | 'Tokenized Equity' | 'Commodity';

export type SignalDirection = 'CARRY SHORT' | 'CARRY LONG' | 'BASIS ARB' | 'NEUTRAL';

export type DataBadgeState = 'LIVE' | 'BYOK' | 'OFFLINE' | 'LOADING';

export interface MarginTier {
  maxNotionalValue: string;
  maintenanceMarginRate: string;
  maxLeverage: number;
  maintenanceDeduction: string;
}

export interface PerpSymbolInfo {
  id: number;
  name: string;
  displayName: string;
  baseCoin: string;
  quoteCoin: string;
  pricePrecision: number;
  quantityPrecision: number;
  tickSize: string;
  stepSize: string;
  minNotional: string;
  maxNotional: string;
  maxLeverage: number;
  initLeverage: number;
  fundingInterval: number;
  makerFee: string;
  takerFee: string;
  status: string;
  marginTiers?: MarginTier[];
}

export interface PerpTicker {
  symbol: string;
  lastPx: string;
  openPx: string;
  highPx: string;
  lowPx: string;
  volume: string;
  quoteVolume: string;
  vwap: string;
  change: string;
  changePct: number;
  askPx: string;
  askSz: string;
  bidPx: string;
  bidSz: string;
  fundingRate: string;
  nextFundingTime: number;
}

export interface PerpMarkPrice {
  symbol: string;
  openInterest: string;
  markPrice: string;
  indexPrice: string;
  fundingRate: string;
  nextFundingTime: number;
}

export interface BookTicker {
  symbol: string;
  askPx: string;
  askSz: string;
  bidPx: string;
  bidSz: string;
}

export interface SpotSymbolInfo {
  id: number;
  name: string;
  displayName: string;
  baseCoin: string;
  quoteCoin: string;
  pricePrecision: number;
}

export interface SpotTicker {
  symbol: string;
  lastPx: string;
  bidPx: string;
  askPx: string;
  quoteVolume: string;
  changePct: number;
}

export interface OrderbookData {
  blockTime: number;
  blockHeight: number;
  updateID: number;
  bids: [string, string][];
  asks: [string, string][];
}

export interface KlineBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  q: number;
  n: number;
}

export interface TradeTick {
  t: number;
  T: number;
  s: string;
  S: 'BUY' | 'SELL';
  p: number;
  q: number;
}

export interface ConvictionBreakdown {
  fundingZ: number;
  basisZ: number;
  liquidityZ: number;
  momentumZ: number;
  etfZ: number;
  compositeZ: number;
  score: number;
  direction: SignalDirection;
  rationale: string;
}

export interface EnrichedMarket {
  symbol: string;
  baseCoin: string;
  assetClass: AssetClass;
  contract: PerpSymbolInfo;
  markPrice: number;
  indexPrice: number;
  lastPrice: number;
  changePct24h: number;
  quoteVolume24h: number;
  openInterestCoins: number;
  openInterestUsd: number;
  oiToVolumeRatio: number;
  fundingRate: number;
  fundingIntervalSec: number;
  annualizedFundingApr: number;
  markIndexBasisBps: number;
  bidPx: number;
  askPx: number;
  spreadBps: number;
  nextFundingTime: number;
  spotSymbol: string | null;
  spotDisplayName: string | null;
  spotPrice: number | null;
  spotVolume24h: number | null;
  spotPerpSpreadBps: number | null;
  conviction: ConvictionBreakdown;
}

export interface SlippageResult {
  side: 'BUY' | 'SELL';
  requestedNotionalUsd: number;
  filledNotionalUsd: number;
  filledQty: number;
  midPrice: number;
  bestPrice: number;
  vwapPrice: number;
  slippageBps: number;
  levelsConsumed: number;
  exhaustedBook: boolean;
}

export interface RegimeResult {
  regime: 'UPTREND' | 'DOWNTREND' | 'CHOP';
  emaFast: number[];
  emaSlow: number[];
  atrPct: number;
  efficiencyRatio: number;
  emaSlopePct: number;
  summary: string;
}

export interface RiskGateCheck {
  id: string;
  label: string;
  passed: boolean;
  severity: 'HARD' | 'WARN';
  detail: string;
}

export interface RiskEvaluationInput {
  market: EnrichedMarket;
  side: 'LONG' | 'SHORT';
  accountEquityUsd: number;
  riskPctPerTrade: number;
  leverage: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  estimatedSlippageBps: number;
  killSwitchActive: boolean;
  existingExposureUsd: number;
  realizedDailyLossUsd: number;
  maxDailyDrawdownPct: number;
  maxSlippageBps: number;
}

export interface SodedEip712Payload {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  primaryType: 'PerpOrder';
  message: {
    symbol: string;
    symbolId: number;
    side: 'BUY' | 'SELL';
    orderType: 'LIMIT_IOC' | 'POST_ONLY';
    price: string;
    quantity: string;
    notionalUsd: string;
    leverage: number;
    reduceOnly: boolean;
    stopLossTrigger: string;
    takeProfitTrigger: string;
    nonce: number;
    expiresAt: number;
  };
}

export interface RiskEvaluationResult {
  approved: boolean;
  checks: RiskGateCheck[];
  riskUsd: number;
  stopDistancePct: number;
  positionQty: number;
  positionNotionalUsd: number;
  requiredMarginUsd: number;
  maintenanceMarginRate: number;
  liquidationPrice: number;
  liqBufferPct: number;
  riskRewardRatio: number;
  estimatedTakerFeeUsd: number;
  estimated24hFundingUsd: number;
  orderPayload: SodedEip712Payload;
}

export interface PaperTrade {
  id: string;
  createdAt: number;
  network: NetworkMode;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  qty: number;
  notionalUsd: number;
  leverage: number;
  riskUsd: number;
  entrySlippageBps: number;
  convictionScore: number;
  status: 'OPEN' | 'CLOSED';
  exitPrice?: number;
  closedAt?: number;
  realizedPnlUsd?: number;
  riskGatePassed: boolean;
}

export interface ApiProbeLog {
  id: string;
  source: 'SoDEX Perps' | 'SoDEX Spot' | 'ValueChain RPC' | 'SoSoValue OpenAPI';
  endpoint: string;
  method: 'GET' | 'POST';
  status: number;
  ok: boolean;
  latencyMs: number;
  timestamp: number;
  recordCount?: number;
  note: string;
  sampleJson: string;
}

export interface ValueChainTelemetry {
  network: NetworkMode;
  rpcUrl: string;
  blockNumber: number;
  blockHex: string;
  chainIdHex: string;
  latencyMs: number;
  fetchedAt: number;
}

export interface SoSoValueState {
  status: DataBadgeState;
  lastChecked: number | null;
  error: string | null;
  etfSummary: Record<string, unknown>[];
  indices: Record<string, unknown>[];
  hotNews: Record<string, unknown>[];
  treasuries: Record<string, unknown>[];
  etfFlowZScore: number;
}
