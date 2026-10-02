// Fugle MarketData API v1.0 response shapes (only the fields this app uses).

export interface FugleQuote {
  date: string;
  symbol: string;
  name: string;
  referencePrice: number;
  previousClose?: number;
  openPrice?: number;
  highPrice?: number;
  lowPrice?: number;
  closePrice?: number;
  lastPrice?: number;
  change?: number;
  changePercent?: number;
  /** Epoch microseconds. */
  lastUpdated?: number;
  /** Best five bids, highest first. Sizes in lots (張). */
  bids?: FugleLevel[];
  /** Best five asks, lowest first. Sizes in lots (張). */
  asks?: FugleLevel[];
  total?: FugleQuoteTotal;
  lastTrade?: { price?: number; size?: number; time?: number };
}

export interface FugleLevel {
  price: number;
  size: number;
}

/** Cumulative day totals; volumes in lots (張). */
export interface FugleQuoteTotal {
  tradeValue?: number;
  tradeVolume?: number;
  /** Volume traded at the bid (內盤). */
  tradeVolumeAtBid?: number;
  /** Volume traded at the ask (外盤). */
  tradeVolumeAtAsk?: number;
  transaction?: number;
}

export interface FugleCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Lots (張) for intraday candles, shares (股) for daily historical candles. */
  volume: number;
}

export interface FugleCandlesResponse {
  symbol: string;
  timeframe?: string;
  data: FugleCandle[];
}

/** Payload of a `trades` channel `data` / `snapshot` event. */
export interface FugleTrade {
  symbol: string;
  price?: number;
  bid?: number;
  ask?: number;
  /** Lots (張). */
  size?: number;
  /** Cumulative day volume, lots (張). */
  volume?: number;
  /** Epoch microseconds. */
  time?: number;
}

export interface WsMessage {
  event: string;
  id?: string;
  channel?: string;
  data?: any;
}
