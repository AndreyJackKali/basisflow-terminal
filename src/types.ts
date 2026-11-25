export type NetworkMode = 'mainnet' | 'testnet';

export type AssetClass = 'Crypto' | 'Tokenized Equity' | 'Commodity';

export type SignalDirection = 'CARRY SHORT' | 'CARRY LONG' | 'BASIS ARB' | 'NEUTRAL';

export type DataBadgeState = 'LIVE' | 'SNAPSHOT' | 'BYOK' | 'OFFLINE' | 'LOADING';

export type SoSoConnectionMode = 'LIVE_PROXY' | 'LIVE_DIRECT' | 'VERIFIED_SNAPSHOT' | 'BYOK';

export type SoSoEtfAsset = 'BTC' | 'ETH' | 'SOL' | 'XRP';

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

export interface SoSoEtfDayRow {
  date: string;
  totalNetInflow: number;
  totalValueTraded: number;
  totalNetAssets: number;
  cumNetInflow: number;
}

export interface SoSoEtfProduct {
  ticker: string;
  name: string;
  exchange: string;
}

export interface SoSoSsiConstituent {
  symbol: string;
  weight: number;
}

export interface SoSoSsiIndexRow {
  ticker: string;
  price: number;
  changePct24h: number;
  roi7d: number;
  roi1m: number;
  roi3m: number;
  roi1y: number;
  ytd: number;
  constituents?: SoSoSsiConstituent[];
}

export interface SoSoMarketOverview {
  totalMarketCap: number;
  totalMarketCapChangePct: number;
  totalVolume24h: number;
  ethGasGwei: number;
  btcGasSatVb: number;
  asOf: number;
}

export interface SoSoNewsItem {
  id: string;
  title: string;
  summary: string;
  sourceLink: string;
  releaseTime: number;
}

export interface SoSoTreasuryItem {
  ticker: string;
  name: string;
  listLocation: string;
}

export interface SoSoSnapshotPayload {
  schemaVersion: string;
  source: string;
  fetchedAt: string;
  fetchedDateUtc: string;
  endpointsVerified: number;
  marketOverview: SoSoMarketOverview | null;
  etfFlows: Record<SoSoEtfAsset, SoSoEtfDayRow[]>;
  btcEtfProducts: SoSoEtfProduct[];
  btcEtfFlowZScore: number;
  ethEtfFlowZScore: number;
  ssiIndices: SoSoSsiIndexRow[];
  hotNews: SoSoNewsItem[];
  treasuries: SoSoTreasuryItem[];
}

export interface EtfFlowStats {
  latestDate: string | null;
  latestNetInflow: number;
  fiveDayNetInflow: number;
  totalNetAssets: number;
  cumNetInflow: number;
  zScore30d: number;
  streakDays: number;
}

export interface EtfFundingCrossCheck {
  asset: SoSoEtfAsset;
  perpSymbol: string;
  hasLivePerp: boolean;
  latestDate: string | null;
  latestNetInflowUsd: number;
  fiveDayNetInflowUsd: number;
  totalNetAssetsUsd: number;
  flowZScore: number;
  perpFundingAprPct: number;
  markIndexBasisBps: number;
  spotPerpSpreadBps: number | null;
  openInterestUsd: number;
  regimeTag:
    | 'DIVERGENCE: CARRY SHORT'
    | 'ACCUMULATION: CARRY LONG'
    | 'CROWDED SHORT SQUEEZE WATCH'
    | 'ALIGNED BULLISH CARRY'
    | 'ALIGNED DELEVERAGING'
    | 'BALANCED';
  thesis: string;
}

export interface SsiSectorFundingRow {
  index: SoSoSsiIndexRow;
  matchedSymbols: string[];
  avgFundingAprPct: number | null;
  avgBasisBps: number | null;
}

export interface SoSoValueState {
  status: DataBadgeState;
  mode: SoSoConnectionMode;
  sourceLabel: string;
  proxyUrl: string;
  lastChecked: number | null;
  snapshotFetchedAt: string | null;
  endpointsVerified: number;
  error: string | null;
  marketOverview: SoSoMarketOverview | null;
  etfFlows: Record<SoSoEtfAsset, SoSoEtfDayRow[]>;
  btcEtfProducts: SoSoEtfProduct[];
  ssiIndices: SoSoSsiIndexRow[];
  hotNews: SoSoNewsItem[];
  treasuries: SoSoTreasuryItem[];
  btcEtfFlowZScore: number;
  ethEtfFlowZScore: number;
  etfFlowZScore: number;
}

export type WsConnectionStatus = 'STREAMING' | 'CONNECTING' | 'PAUSED' | 'FALLBACK';

export interface WsStreamTelemetry {
  status: WsConnectionStatus;
  endpoint: string;
  symbol: string;
  msgCount: number;
  lastTickAt: number | null;
}

export type HedgeStrategyMode = 'CASH_AND_CARRY' | 'REVERSE_CARRY';

export interface DeltaNeutralHedgeInput {
  market: EnrichedMarket;
  notionalUsd: number;
  holdingDays: number;
  strategy: HedgeStrategyMode;
  executionMode: 'TAKER' | 'MAKER';
  captureBasisConvergence: boolean;
  spotOrderbook: OrderbookData | null;
  perpOrderbook: OrderbookData | null;
}

export interface DeltaNeutralHedgeResult {
  strategy: HedgeStrategyMode;
  spotLegSide: 'BUY' | 'SELL';
  perpLegSide: 'SHORT' | 'LONG';
  notionalUsd: number;
  holdingDays: number;
  spotSlippageBps: number;
  perpSlippageBps: number;
  roundTripSlippageBps: number;
  roundTripFeeBps: number;
  totalExecutionCostBps: number;
  totalExecutionCostUsd: number;
  grossFundingAprPct: number;
  expectedFundingUsd: number;
  basisEdgeBps: number;
  expectedBasisUsd: number;
  netPnlUsd: number;
  netAprPct: number;
  breakevenHours: number | null;
  verdict: 'POSITIVE_EDGE' | 'THIN_EDGE' | 'NEGATIVE_AFTER_COSTS';
  spotBookLive: boolean;
  perpBookLive: boolean;
  atomicPlan: {
    protocol: 'SoDEX Spot + Perps (ValueChain L1)';
    strategy: HedgeStrategyMode;
    notionalUsd: number;
    holdingDays: number;
    legs: [
      { venue: 'SoDEX Spot'; symbol: string; side: 'BUY' | 'SELL'; orderType: string; estVwap: number; slippageBps: number },
      { venue: 'SoDEX Perps'; symbol: string; side: 'BUY' | 'SELL'; orderType: string; estVwap: number; slippageBps: number },
    ];
    projectedNetPnlUsd: number;
    projectedNetAprPct: number;
    breakevenHours: number | null;
  };
}

export interface MonteCarloInput {
  market: EnrichedMarket;
  klines: KlineBar[];
  side: 'LONG' | 'SHORT';
  accountEquityUsd: number;
  positionNotionalUsd: number;
  positionQty: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  liquidationPrice: number;
  entrySlippageBps: number;
  horizonHours: 24 | 72 | 168;
  numPaths?: number;
}

export interface MonteCarloStepBand {
  hour: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface TailStressScenario {
  id: string;
  label: string;
  shockSummary: string;
  projectedPnlUsd: number;
  equityImpactPct: number;
  outcome: 'SURVIVES' | 'STOPPED' | 'LIQUIDATED' | 'TP_HIT';
}

export interface MonteCarloStressResult {
  symbol: string;
  sampleReturnsCount: number;
  numPaths: number;
  horizonHours: number;
  annualizedRealizedVolPct: number;
  expectedPnlUsd: number;
  medianPnlUsd: number;
  var95Usd: number;
  var95Pct: number;
  cvar99Usd: number;
  cvar99Pct: number;
  tpHitRatePct: number;
  slHitRatePct: number;
  liquidationProbPct: number;
  winRatePct: number;
  bands: MonteCarloStepBand[];
  stressScenarios: TailStressScenario[];
}

export interface SoloDeskEconomicsInput {
  managedAumUsd: number;
  capitalUtilizationPct: number;
  liveGrossCarryAprPct: number;
  executionDragAprPct: number;
  managementFeePct: number;
  performanceFeePct: number;
  benchmarkAprPct: number;
  paidSubscribers: number;
  monthlySubPriceUsd: number;
  x402CallsPerDay: number;
  x402PricePerCallUsd: number;
  monthlyInfraCostUsd: number;
}

export interface SoloDeskEconomicsResult {
  deployedCapitalUsd: number;
  netStrategyCarryAprPct: number;
  grossVaultProfitAnnualUsd: number;
  managementFeeAnnualUsd: number;
  performanceFeeAnnualUsd: number;
  clientNetAprPct: number;
  alphaOverBenchmarkPct: number;
  subscriptionMrrUsd: number;
  x402ApiMrrUsd: number;
  vaultFeeMrrUsd: number;
  totalGrossMrrUsd: number;
  totalNetMrrUsd: number;
  totalNetArrUsd: number;
  breakevenSubscribers: number;
  viabilityTag: 'PROFITABLE SOLO DESK' | 'SCALING STAGE' | 'BELOW BREAKEVEN';
}

export interface OperatorSignalBrief {
  generatedAtUtc: string;
  network: NetworkMode;
  topCarrySignals: Array<{
    symbol: string;
    direction: SignalDirection;
    convictionScore: number;
    annualizedFundingApr: number;
    markIndexBasisBps: number;
    spotPerpSpreadBps: number | null;
    markPrice: number;
  }>;
  btcEtfFlowZScore: number;
  ethEtfFlowZScore: number;
  marketCapUsd: number | null;
  topHeadlines: string[];
  markdown: string;
}
