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
  /** Lots (張). */
  volume: number;
}

export interface DepthLevel {
  price: number;
  /** Lots (張). */
  size: number;
}

/** Order book + cumulative bid/ask volume, shown in the order-book view. */
export interface Depth {
  /** Best bids, highest price first. */
  bids: DepthLevel[];
  /** Best asks, lowest price first. */
  asks: DepthLevel[];
  /** Cumulative volume traded at the bid (內盤), lots. */
  atBid: number;
  /** Cumulative volume traded at the ask (外盤), lots. */
  atAsk: number;
  /** Epoch milliseconds. */
  updated: number | null;
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
  depth: Depth | null;
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
  onDepth(symbol: string, depth: Depth): void;
  onError(symbol: string, message: string): void;
  onStatus(status: ConnectionStatus): void;
}

const TAIPEI_OFFSET_S = 8 * 3600;
/** ~200 calendar days ≈ 130+ trading days; Fugle limits one query to < 1 year. */
const HISTORY_CALENDAR_DAYS = 200;
/** Each "load older" request; Fugle requires the range to be under one year. */
const OLDER_CHUNK_CALENDAR_DAYS = 360;

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
      onAggregate: (q) => this.handleAggregate(q),
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

  /**
   * The order-book view streams `aggregates` (full quote incl. order book)
   * instead of `trades`, so each symbol still uses a single subscription.
   */
  setDepthView(symbol: string, on: boolean): void {
    if (!this.watch.has(symbol)) return;
    this.ws.setChannel(symbol, on ? "aggregates" : "trades");
    if (on) void this.refreshDepth(symbol);
  }

  /** One REST quote so the book shows before the first push (or after the close). */
  private async refreshDepth(symbol: string): Promise<void> {
    try {
      const depth = toDepth(await this.rest.getQuote(symbol));
      const snap = this.state.get(symbol);
      if (!depth || !snap) return;
      snap.depth = depth;
      this.listener.onDepth(symbol, depth);
    } catch {
      /* the stream will fill it in */
    }
  }

  /** Daily candles (ascending), cached per trading day. */
  getHistory(symbol: string): Promise<DailyBar[]> {
    return this.history.get(symbol, async () => {
      const to = taipeiDate();
      const from = addDays(to, -HISTORY_CALENDAR_DAYS);
      const res = await this.rest.getHistoricalCandles(symbol, from, to);
      return toDailyBars(res.data ?? []);
    });
  }

  /**
   * One chunk (~1 year) of daily candles strictly before `before` (`yyyy-MM-dd`),
   * ascending. An empty array means there is no older data. Cached per chunk.
   */
  getOlderHistory(symbol: string, before: string): Promise<DailyBar[]> {
    return this.history.get(`${symbol}@${before}`, async () => {
      const to = addDays(before, -1);
      const from = addDays(before, -OLDER_CHUNK_CALENDAR_DAYS);
      const res = await this.rest.getHistoricalCandles(symbol, from, to);
      return toDailyBars(res.data ?? []).filter((b) => b.time < before);
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

    this.applyPrice(snap, trade.price, ms, trade.volume);
  }

  private handleAggregate(q: FugleQuote): void {
    const snap = this.state.get(q.symbol);
    if (!snap) return;
    if (q.date && q.date !== snap.date) {
      void this.loadSymbol(q.symbol);
      return;
    }
    const depth = toDepth(q);
    if (depth) {
      snap.depth = depth;
      this.listener.onDepth(q.symbol, depth);
    }
    // Keep price, intraday line and today's bar moving while trades are not streamed.
    const price = q.lastPrice ?? q.lastTrade?.price;
    const micros = q.lastTrade?.time ?? q.lastUpdated;
    if (price != null && micros) this.applyPrice(snap, price, Math.floor(micros / 1000), q.total?.tradeVolume);
  }

  private applyPrice(snap: StockSnapshot, price: number, ms: number, volume?: number): void {
    const change = round2(price - snap.referencePrice);
    const changePercent = snap.referencePrice ? round2((change / snap.referencePrice) * 100) : 0;
    const point = { time: minuteBucket(ms), value: price };

    const last = snap.intraday[snap.intraday.length - 1];
    if (last && last.time === point.time) last.value = price;
    else if (!last || point.time > last.time) snap.intraday.push(point);

    const vol = volume ?? snap.today?.volume ?? 0;
    const today: DailyBar = snap.today
      ? {
          ...snap.today,
          high: Math.max(snap.today.high, price),
          low: Math.min(snap.today.low, price),
          close: price,
          volume: vol,
        }
      : { time: snap.date, open: price, high: price, low: price, close: price, volume: vol };

    Object.assign(snap, { price, change, changePercent, lastUpdated: ms, today });
    this.listener.onTrade(snap.symbol, { price, change, changePercent, lastUpdated: ms, point, today });
  }

  private handleStatus(status: ConnectionStatus): void {
    const recovered = status === "open" && this.lastStatus === "reconnecting";
    this.lastStatus = status;
    this.listener.onStatus(status);
    // Trades were missed while offline; resync snapshots.
    if (recovered) for (const symbol of this.watch) void this.loadSymbol(symbol);
  }
}

function toDailyBars(candles: FugleCandle[]): DailyBar[] {
  return candles
    .map((c) => ({
      time: c.date.slice(0, 10),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      // Daily candles report shares; the live quote reports lots.
      volume: Math.round((c.volume ?? 0) / 1000),
    }))
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
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
          volume: q.total?.tradeVolume ?? 0,
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
    depth: toDepth(q),
  };
}

function toDepth(q: FugleQuote): Depth | null {
  if (!q.bids && !q.asks && !q.total) return null;
  const micros = q.lastUpdated ?? q.lastTrade?.time;
  return {
    bids: (q.bids ?? []).slice(0, 5),
    asks: (q.asks ?? []).slice(0, 5),
    atBid: q.total?.tradeVolumeAtBid ?? 0,
    atAsk: q.total?.tradeVolumeAtAsk ?? 0,
    updated: micros ? Math.floor(micros / 1000) : null,
  };
}
