import { addDays, DailyCache, taipeiDate } from "./cache";
import { FugleRestClient } from "./fugle/restClient";
import type { FugleCandle, FugleQuote, FugleTrade } from "./fugle/types";
import { WsManager, type ConnectionStatus } from "./fugle/wsManager";

/** Seconds since epoch shifted by +8h so charts render Taipei wall-clock time. */
export type ChartTime = number;

export interface IntradayPoint {
  time: ChartTime;
  value: number;
}

export interface DailyBar {
  /** `yyyy-MM-dd` */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface StockSnapshot {
  symbol: string;
  name: string;
  date: string;
  referencePrice: number;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  /** Epoch milliseconds. */
  lastUpdated: number | null;
  intraday: IntradayPoint[];
  today: DailyBar | null;
}

export interface TradeUpdate {
  price: number;
  change: number;
  changePercent: number;
  lastUpdated: number;
  point: IntradayPoint;
  today: DailyBar;
}

export interface MarketListener {
  onSnapshot(symbol: string, snapshot: StockSnapshot): void;
  onTrade(symbol: string, update: TradeUpdate): void;
  onError(symbol: string, message: string): void;
  onStatus(status: ConnectionStatus): void;
}

const TAIPEI_OFFSET_S = 8 * 3600;
/** ~200 calendar days ≈ 130+ trading days; Fugle limits one query to < 1 year. */
const HISTORY_CALENDAR_DAYS = 200;

export function toChartTime(epochMs: number): ChartTime {
  return Math.floor(epochMs / 1000) + TAIPEI_OFFSET_S;
}

function minuteBucket(epochMs: number): ChartTime {
  const t = toChartTime(epochMs);
  return t - (t % 60);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Framework-agnostic market data façade: REST snapshot + streaming trades +
 * history cache. UI code only talks to this through `MarketListener`.
 */
export class MarketService {
  readonly ws: WsManager;
  private rest: FugleRestClient;
  private history = new DailyCache<DailyBar[]>();
  private state = new Map<string, StockSnapshot>();
  private watch = new Set<string>();
  private lastStatus: ConnectionStatus = "idle";

  constructor(
    private getApiKey: () => string,
    private listener: MarketListener,
  ) {
    this.rest = new FugleRestClient(getApiKey);
    this.ws = new WsManager({
      getApiKey,
      log: import.meta.env.DEV ? console.debug : undefined,
    });
    this.ws.addListener({
      onTrade: (t) => this.handleTrade(t),
      onStatus: (s) => this.handleStatus(s),
      onSubscribeError: (symbol, msg) => this.listener.onError(symbol, msg),
    });
  }

  start(): void {
    if (this.getApiKey()) this.ws.connect();
  }

  /** Call after the API key changes. */
  restart(): void {
    this.history.clear();
    this.ws.reconnectNow();
    for (const symbol of this.watch) void this.loadSymbol(symbol);
  }

  /**
   * Declare the full set of symbols on screen (≤ 5). New symbols are loaded
   * via REST; removed ones are unsubscribed by the WebSocket manager.
   */
  setWatchlist(symbols: string[]): void {
    const next = new Set(symbols);
    this.ws.setWanted(next);
    for (const symbol of next) {
      if (!this.watch.has(symbol)) void this.loadSymbol(symbol);
    }
    for (const symbol of this.watch) {
      if (!next.has(symbol)) this.state.delete(symbol);
    }
    this.watch = next;
  }

  async loadSymbol(symbol: string): Promise<void> {
    try {
      const [quote, candles] = await Promise.all([
        this.rest.getQuote(symbol),
        this.rest.getIntradayCandles(symbol).catch(() => ({ symbol, data: [] as FugleCandle[] })),
      ]);
      if (!this.watch.has(symbol)) return; // removed while loading
      const snap = buildSnapshot(quote, candles.data ?? []);
      this.state.set(symbol, snap);
      this.listener.onSnapshot(symbol, snap);
    } catch (e) {
      this.listener.onError(symbol, e instanceof Error ? e.message : String(e));
    }
  }

  /** Daily candles (ascending), cached per trading day. */
  getHistory(symbol: string): Promise<DailyBar[]> {
    return this.history.get(symbol, async () => {
      const to = taipeiDate();
      const from = addDays(to, -HISTORY_CALENDAR_DAYS);
      const res = await this.rest.getHistoricalCandles(symbol, from, to);
      return (res.data ?? [])
        .map((c) => ({ time: c.date.slice(0, 10), open: c.open, high: c.high, low: c.low, close: c.close }))
        .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    });
  }

  private handleTrade(trade: FugleTrade): void {
    const snap = this.state.get(trade.symbol);
    if (!snap || trade.price == null) return;
    const ms = trade.time ? Math.floor(trade.time / 1000) : Date.now();

    if (taipeiDate(new Date(ms)) !== snap.date) {
      // New trading day while the app stayed open: rebuild from REST.
      void this.loadSymbol(trade.symbol);
      return;
    }

    const price = trade.price;
    const change = round2(price - snap.referencePrice);
    const changePercent = snap.referencePrice ? round2((change / snap.referencePrice) * 100) : 0;
    const point = { time: minuteBucket(ms), value: price };

    const last = snap.intraday[snap.intraday.length - 1];
    if (last && last.time === point.time) last.value = price;
    else if (!last || point.time > last.time) snap.intraday.push(point);

    const today: DailyBar = snap.today
      ? { ...snap.today, high: Math.max(snap.today.high, price), low: Math.min(snap.today.low, price), close: price }
      : { time: snap.date, open: price, high: price, low: price, close: price };

    Object.assign(snap, { price, change, changePercent, lastUpdated: ms, today });
    this.listener.onTrade(trade.symbol, { price, change, changePercent, lastUpdated: ms, point, today });
  }

  private handleStatus(status: ConnectionStatus): void {
    const recovered = status === "open" && this.lastStatus === "reconnecting";
    this.lastStatus = status;
    this.listener.onStatus(status);
    // Trades were missed while offline; resync snapshots.
    if (recovered) for (const symbol of this.watch) void this.loadSymbol(symbol);
  }
}

function buildSnapshot(q: FugleQuote, candles: FugleCandle[]): StockSnapshot {
  const intraday: IntradayPoint[] = candles
    .map((c) => ({ time: minuteBucket(Date.parse(c.date)), value: c.close }))
    .filter((p) => Number.isFinite(p.time))
    .sort((a, b) => a.time - b.time);

  const price = q.lastPrice ?? q.closePrice ?? null;
  const today: DailyBar | null =
    price != null && q.openPrice != null
      ? {
          time: q.date,
          open: q.openPrice,
          high: q.highPrice ?? price,
          low: q.lowPrice ?? price,
          close: price,
        }
      : null;

  return {
    symbol: q.symbol,
    name: q.name,
    date: q.date,
    referencePrice: q.referencePrice,
    price,
    change: q.change ?? (price != null ? round2(price - q.referencePrice) : null),
    changePercent: q.changePercent ?? null,
    lastUpdated: q.lastUpdated ? Math.floor(q.lastUpdated / 1000) : null,
    intraday,
    today,
  };
}
