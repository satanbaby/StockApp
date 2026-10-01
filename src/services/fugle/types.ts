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
}

export interface FugleCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
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
  size?: number;
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
