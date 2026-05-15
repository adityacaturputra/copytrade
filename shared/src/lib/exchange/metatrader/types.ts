export type MetaTraderConfig = {
  baseUrl: string;
  login: string;
  password: string;
  server: string;
  platform?: string;
  bridgeToken?: string;
  simulated?: boolean;
};

export type HttpMethod = "GET" | "POST" | "DELETE";

export type MetaTraderPositionRow = {
  id?: string | number;
  ticket?: string | number;
  positionId?: string | number;
  symbol?: string;
  side?: string;
  type?: string | number;
  volume?: string | number;
  lots?: string | number;
  quantity?: string | number;
  openPrice?: string | number;
  priceOpen?: string | number;
  currentPrice?: string | number;
  priceCurrent?: string | number;
  profit?: string | number;
  pnl?: string | number;
  swap?: string | number;
  commission?: string | number;
  margin?: string | number;
  leverage?: string | number;
  stopLoss?: string | number;
  sl?: string | number;
  takeProfit?: string | number;
  tp?: string | number;
  createdAt?: string | number;
  time?: string | number;
  [key: string]: unknown;
};

export type MetaTraderOrderRow = {
  id?: string | number;
  ticket?: string | number;
  orderId?: string | number;
  symbol?: string;
  side?: string;
  type?: string | number;
  orderType?: string;
  price?: string | number;
  openPrice?: string | number;
  triggerPrice?: string | number;
  stopPrice?: string | number;
  volume?: string | number;
  lots?: string | number;
  quantity?: string | number;
  filledQuantity?: string | number;
  executedQty?: string | number;
  status?: string;
  state?: string;
  createdAt?: string | number;
  time?: string | number;
  fee?: string | number;
  commission?: string | number;
  profit?: string | number;
  pnl?: string | number;
  [key: string]: unknown;
};

export type MetaTraderInstrumentRow = {
  symbol?: string;
  contractSize?: string | number;
  ctVal?: string | number;
  lotStep?: string | number;
  lotSz?: string | number;
  minLot?: string | number;
  minSz?: string | number;
  tickSize?: string | number;
  tickSz?: string | number;
  priceDecimals?: string | number;
  qtyDecimals?: string | number;
  baseCurrency?: string;
  profitCurrency?: string;
  [key: string]: unknown;
};

export type MetaTraderAccountRow = {
  balance?: string | number;
  equity?: string | number;
  freeMargin?: string | number;
  availableBalance?: string | number;
  marginFree?: string | number;
  profit?: string | number;
  pnl?: string | number;
  currency?: string;
  leverage?: string | number;
  [key: string]: unknown;
};
