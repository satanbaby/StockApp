import { fetch } from "@tauri-apps/plugin-http";
import type { FugleCandlesResponse, FugleQuote } from "./types";

const BASE_URL = "https://api.fugle.tw/marketdata/v1.0/stock";

export class FugleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Sliding-window limiter: at most `limit` requests per `windowMs`.
 * Fugle's basic plan allows 60 REST calls / minute; we stay a little below.
 */
class RateLimiter {
  private stamps: number[] = [];

  constructor(
    private limit: number,
    private windowMs: number,
  ) {}

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
      if (this.stamps.length < this.limit) {
        this.stamps.push(now);
        return;
      }
      const wait = this.windowMs - (now - this.stamps[0]) + 10;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

export class FugleRestClient {
  private limiter = new RateLimiter(55, 60_000);
  private inFlight = new Map<string, Promise<unknown>>();

  constructor(private getApiKey: () => string) {}

  getQuote(symbol: string): Promise<FugleQuote> {
    return this.get(`/intraday/quote/${encodeURIComponent(symbol)}`);
  }

  getIntradayCandles(symbol: string): Promise<FugleCandlesResponse> {
    return this.get(`/intraday/candles/${encodeURIComponent(symbol)}?timeframe=1`);
  }

  getHistoricalCandles(symbol: string, from: string, to: string): Promise<FugleCandlesResponse> {
    const q = new URLSearchParams({
      timeframe: "D",
      from,
      to,
      sort: "asc",
      fields: "open,high,low,close,volume",
    });
    return this.get(`/historical/candles/${encodeURIComponent(symbol)}?${q}`);
  }

  /** Identical concurrent requests share one HTTP call. */
  private get<T>(path: string): Promise<T> {
    const existing = this.inFlight.get(path);
    if (existing) return existing as Promise<T>;
    const p = this.request<T>(path).finally(() => this.inFlight.delete(path));
    this.inFlight.set(path, p);
    return p;
  }

  private async request<T>(path: string): Promise<T> {
    const apiKey = this.getApiKey();
    if (!apiKey) throw new FugleApiError("尚未設定 Fugle API Key", 401);
    await this.limiter.acquire();
    const res = await fetch(BASE_URL + path, { headers: { "X-API-KEY": apiKey } });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.message) msg = body.message;
      } catch {
        /* ignore non-JSON error body */
      }
      if (res.status === 404) msg = "查無此股票";
      throw new FugleApiError(msg, res.status);
    }
    return (await res.json()) as T;
  }
}
