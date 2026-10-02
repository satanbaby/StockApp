import type { FugleQuote, FugleTrade, WsMessage } from "./types";

export const MAX_SUBSCRIPTIONS = 5;
const WS_URL = "wss://api.fugle.tw/marketdata/v1.0/stock/streaming";

/**
 * Each symbol occupies exactly one subscription, on one channel: `trades` for
 * the price / chart views, `aggregates` (full quote incl. order book and
 * bid/ask volume) for the order-book view.
 */
export type Channel = "trades" | "aggregates";

export type ConnectionStatus = "idle" | "connecting" | "authenticating" | "open" | "reconnecting" | "auth-failed";

interface ServerSub {
  /** Channel id assigned by the server once `subscribed` arrives. */
  id?: string;
  channel: Channel;
  state: "subscribing" | "active" | "unsubscribing";
  timer?: ReturnType<typeof setTimeout>;
}

export interface WsManagerOptions {
  getApiKey: () => string;
  url?: string;
  maxSubscriptions?: number;
  /** Injectable for tests. */
  createSocket?: (url: string) => WebSocket;
  /** How long to wait for a subscribe/unsubscribe ack before giving up. */
  ackTimeoutMs?: number;
  log?: (...args: unknown[]) => void;
}

export interface WsManagerListener {
  onTrade?: (trade: FugleTrade) => void;
  onAggregate?: (quote: FugleQuote) => void;
  onStatus?: (status: ConnectionStatus) => void;
  onSubscribeError?: (symbol: string, message: string) => void;
}

/**
 * Owns the single Fugle streaming connection.
 *
 * Callers declare the set of symbols they *want* (`setWanted`, `subscribe`,
 * `unsubscribe`, `replace`); the manager reconciles that with what the server
 * has. Unsubscribes are always sent first and a new subscribe is only sent
 * while the server-side count (including in-flight ones) is below the limit,
 * so the number of live subscriptions can never exceed `maxSubscriptions`.
 */
export class WsManager {
  private readonly url: string;
  private readonly max: number;
  private readonly ackTimeoutMs: number;
  private readonly createSocket: (url: string) => WebSocket;
  private readonly log: (...args: unknown[]) => void;

  private socket: WebSocket | null = null;
  private authenticated = false;
  private wanted = new Map<string, Channel>();
  private server = new Map<string, ServerSub>();
  private listeners = new Set<WsManagerListener>();
  private status: ConnectionStatus = "idle";

  private reconnectAttempt = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private pingTimer?: ReturnType<typeof setInterval>;
  private lastMessageAt = 0;
  private stopped = true;

  constructor(private opts: WsManagerOptions) {
    this.url = opts.url ?? WS_URL;
    this.max = opts.maxSubscriptions ?? MAX_SUBSCRIPTIONS;
    this.ackTimeoutMs = opts.ackTimeoutMs ?? 8_000;
    this.createSocket = opts.createSocket ?? ((u) => new WebSocket(u));
    this.log = opts.log ?? (() => {});
  }

  addListener(l: WsManagerListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  get connectionStatus(): ConnectionStatus {
    return this.status;
  }

  /** Number of subscriptions the server currently holds or is about to hold. */
  get serverSubscriptionCount(): number {
    return this.server.size;
  }

  get wantedSymbols(): string[] {
    return [...this.wanted.keys()];
  }

  channelOf(symbol: string): Channel | undefined {
    return this.wanted.get(symbol);
  }

  connect(): void {
    this.stopped = false;
    if (this.socket) return;
    this.open();
  }

  disconnect(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.teardownSocket();
    this.setStatus("idle");
  }

  /** Force a fresh connection, e.g. after the API key changes. */
  reconnectNow(): void {
    this.reconnectAttempt = 0;
    clearTimeout(this.reconnectTimer);
    this.teardownSocket();
    this.stopped = false;
    this.open();
  }

  /**
   * Declare the symbols to stream. A bare symbol keeps the channel it already
   * has (or `trades` when new); a `[symbol, channel]` pair sets it explicitly.
   */
  setWanted(symbols: Iterable<string | readonly [string, Channel]>): void {
    const next = new Map<string, Channel>();
    for (const item of symbols) {
      const [symbol, channel] = typeof item === "string" ? [item, this.wanted.get(item) ?? "trades"] : item;
      next.set(symbol, channel);
    }
    if (next.size > this.max) {
      throw new Error(`WebSocket subscriptions cannot exceed ${this.max} (got ${next.size})`);
    }
    this.wanted = next;
    this.reconcile();
  }

  /** Move a wanted symbol to another channel; the old subscription is dropped first. */
  setChannel(symbol: string, channel: Channel): void {
    if (!this.wanted.has(symbol) || this.wanted.get(symbol) === channel) return;
    this.wanted.set(symbol, channel);
    this.reconcile();
  }

  subscribe(symbol: string): void {
    if (this.wanted.has(symbol)) return;
    this.setWanted([...this.wanted.keys(), symbol]);
  }

  unsubscribe(symbol: string): void {
    if (!this.wanted.delete(symbol)) return;
    this.reconcile();
  }

  /** Swap the dynamic stock: drop `oldSymbol` (unless still wanted elsewhere) and add `newSymbol`. */
  replace(oldSymbol: string | null, newSymbol: string, keep: Iterable<string> = []): void {
    const keepSet = new Set(keep);
    const next = [...this.wanted.keys()].filter((s) => s !== oldSymbol || keepSet.has(s));
    if (!next.includes(newSymbol)) next.push(newSymbol);
    this.setWanted(next);
  }

  // ---------------------------------------------------------------- internals

  private open(): void {
    this.setStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
    const ws = this.createSocket(this.url);
    this.socket = ws;
    ws.onopen = () => {
      if (this.socket !== ws) return;
      this.setStatus("authenticating");
      this.send({ event: "auth", data: { apikey: this.opts.getApiKey() } });
    };
    ws.onmessage = (ev) => {
      if (this.socket !== ws) return;
      this.lastMessageAt = Date.now();
      let msg: WsMessage;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      } catch {
        return;
      }
      this.handleMessage(msg);
    };
    ws.onclose = () => {
      if (this.socket !== ws) return;
      this.log("[ws] closed");
      this.teardownSocket();
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose follows; reconnect is handled there.
    };
  }

  private handleMessage(msg: WsMessage): void {
    switch (msg.event) {
      case "authenticated":
        this.authenticated = true;
        this.reconnectAttempt = 0;
        this.setStatus("open");
        this.startHeartbeat();
        // Fresh connection: the server holds nothing, restore everything wanted.
        this.reconcile();
        break;
      case "subscribed": {
        const symbol: string | undefined = msg.data?.symbol;
        const id: string | undefined = msg.data?.id;
        const channel: Channel = msg.data?.channel ?? "trades";
        if (!symbol) break;
        const sub = this.server.get(symbol);
        if (sub) {
          clearTimeout(sub.timer);
          sub.id = id;
          sub.channel = channel;
          sub.state = "active";
        } else {
          this.server.set(symbol, { id, channel, state: "active" });
        }
        this.log("[ws] subscribed", symbol, "count", this.server.size);
        this.reconcile();
        break;
      }
      case "unsubscribed": {
        const id: string | undefined = msg.data?.id;
        const symbol = msg.data?.symbol ?? this.symbolById(id);
        if (symbol) {
          const sub = this.server.get(symbol);
          if (sub) clearTimeout(sub.timer);
          this.server.delete(symbol);
        }
        this.log("[ws] unsubscribed", symbol, "count", this.server.size);
        this.reconcile();
        break;
      }
      case "data":
      case "snapshot":
        if (!msg.data?.symbol) break;
        if (msg.channel === "trades") this.emit((l) => l.onTrade?.(msg.data as FugleTrade));
        else if (msg.channel === "aggregates") this.emit((l) => l.onAggregate?.(msg.data as FugleQuote));
        break;
      case "error": {
        const message: string = msg.data?.message ?? "WebSocket error";
        this.log("[ws] error", message);
        if (!this.authenticated) {
          this.setStatus("auth-failed");
          this.stopped = true; // a bad key will not fix itself; wait for reconnectNow()
          this.teardownSocket();
        }
        break;
      }
      default:
        break; // heartbeat / pong only refresh lastMessageAt
    }
  }

  private reconcile(): void {
    if (!this.socket || !this.authenticated) return;

    // 1. Unsubscribe whatever is no longer wanted, or is on the wrong channel
    //    (frees slots first; the new channel is subscribed once the ack arrives).
    for (const [symbol, sub] of this.server) {
      if (this.wanted.get(symbol) === sub.channel || sub.state !== "active") continue;
      if (!sub.id) {
        this.server.delete(symbol);
        continue;
      }
      sub.state = "unsubscribing";
      this.send({ event: "unsubscribe", data: { id: sub.id } });
      sub.timer = setTimeout(() => {
        // No ack: assume the server dropped it so we are not stuck forever.
        if (this.server.get(symbol) === sub) {
          this.server.delete(symbol);
          this.reconcile();
        }
      }, this.ackTimeoutMs);
    }

    // 2. Subscribe missing symbols while there is room.
    for (const [symbol, channel] of this.wanted) {
      if (this.server.has(symbol)) continue;
      if (this.server.size >= this.max) break;
      const sub: ServerSub = { channel, state: "subscribing" };
      this.server.set(symbol, sub);
      this.send({ event: "subscribe", data: { channel, symbol } });
      sub.timer = setTimeout(() => {
        if (this.server.get(symbol) !== sub || sub.state !== "subscribing") return;
        this.server.delete(symbol);
        this.wanted.delete(symbol);
        this.emit((l) => l.onSubscribeError?.(symbol, "訂閱逾時"));
        this.reconcile();
      }, this.ackTimeoutMs);
    }
  }

  private symbolById(id?: string): string | undefined {
    if (!id) return undefined;
    for (const [symbol, sub] of this.server) if (sub.id === id) return symbol;
    return undefined;
  }

  private startHeartbeat(): void {
    clearInterval(this.pingTimer);
    this.lastMessageAt = Date.now();
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastMessageAt > 75_000) {
        this.log("[ws] heartbeat timeout");
        this.socket?.close();
        return;
      }
      this.send({ event: "ping", data: { state: "" } });
    }, 25_000);
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt++;
    this.setStatus("reconnecting");
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private teardownSocket(): void {
    clearInterval(this.pingTimer);
    for (const sub of this.server.values()) clearTimeout(sub.timer);
    this.server.clear();
    this.authenticated = false;
    const ws = this.socket;
    this.socket = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
  }

  private send(payload: unknown): void {
    if (this.socket?.readyState === 1 /* OPEN */) this.socket.send(JSON.stringify(payload));
  }

  private setStatus(s: ConnectionStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.emit((l) => l.onStatus?.(s));
  }

  private emit(fn: (l: WsManagerListener) => void): void {
    for (const l of this.listeners) fn(l);
  }
}
