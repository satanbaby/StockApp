import { beforeEach, describe, expect, it, vi } from "vitest";
import { WsManager } from "../src/services/fugle/wsManager";

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  // test helpers
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
  takeSent() {
    const s = this.sent;
    this.sent = [];
    return s;
  }
}

let idSeq = 0;
/** Ack every pending subscribe/unsubscribe the way the Fugle server does. */
function ackAll(sock: FakeSocket, ids: Map<string, string>) {
  for (const m of sock.takeSent()) {
    if (m.event === "subscribe") {
      const id = `ch${++idSeq}`;
      ids.set(id, m.data.symbol);
      sock.receive({ event: "subscribed", data: { id, channel: m.data.channel, symbol: m.data.symbol } });
    } else if (m.event === "unsubscribe") {
      const symbol = ids.get(m.data.id);
      ids.delete(m.data.id);
      sock.receive({ event: "unsubscribed", data: { id: m.data.id, symbol } });
    }
  }
}

function setup() {
  const mgr = new WsManager({ getApiKey: () => "k", createSocket: () => new FakeSocket() as any });
  mgr.connect();
  const sock = FakeSocket.instances.at(-1)!;
  sock.open();
  expect(sock.takeSent()).toEqual([{ event: "auth", data: { apikey: "k" } }]);
  sock.receive({ event: "authenticated", data: {} });
  return { mgr, sock, ids: new Map<string, string>() };
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.useFakeTimers();
});

describe("WsManager", () => {
  it("refuses more than 5 wanted symbols", () => {
    const { mgr } = setup();
    mgr.setWanted(["1", "2", "3", "4", "5"]);
    expect(() => mgr.subscribe("6")).toThrow();
    expect(mgr.wantedSymbols).toHaveLength(5);
  });

  it("replacing the dynamic stock unsubscribes before subscribing and never exceeds 5", () => {
    const { mgr, sock, ids } = setup();
    mgr.setWanted(["1101", "2330", "2317", "2454", "0050"]);
    ackAll(sock, ids);
    expect(mgr.serverSubscriptionCount).toBe(5);

    mgr.replace("0050", "2603");
    const sent = sock.takeSent();
    // At the limit: only the unsubscribe goes out; the subscribe waits for the ack.
    expect(sent).toEqual([{ event: "unsubscribe", data: { id: expect.any(String) } }]);
    expect(mgr.serverSubscriptionCount).toBe(5);

    sock.sent = sent;
    ackAll(sock, ids); // ack unsubscribe -> manager sends subscribe 2603
    expect(sock.sent.map((m) => m.event)).toEqual(["subscribe"]);
    expect(sock.sent[0].data.symbol).toBe("2603");
    ackAll(sock, ids);
    expect(mgr.serverSubscriptionCount).toBe(5);
    expect([...ids.values()].sort()).toEqual(["1101", "2317", "2330", "2454", "2603"]);
  });

  it("restores subscriptions after reconnect", () => {
    const { mgr, sock, ids } = setup();
    mgr.setWanted(["2330", "2317"]);
    ackAll(sock, ids);

    sock.drop();
    vi.advanceTimersByTime(1_000);
    const next = FakeSocket.instances.at(-1)!;
    expect(next).not.toBe(sock);
    next.open();
    next.takeSent();
    next.receive({ event: "authenticated", data: {} });
    const subs = next.takeSent().filter((m) => m.event === "subscribe").map((m) => m.data.symbol);
    expect(subs.sort()).toEqual(["2317", "2330"]);
    expect(mgr.serverSubscriptionCount).toBe(2);
  });

  it("emits trades", () => {
    const { mgr, sock } = setup();
    const onTrade = vi.fn();
    mgr.addListener({ onTrade });
    sock.receive({ event: "data", channel: "trades", id: "x", data: { symbol: "2330", price: 1000, time: 1 } });
    expect(onTrade).toHaveBeenCalledWith(expect.objectContaining({ symbol: "2330", price: 1000 }));
  });

  it("switching a symbol's channel unsubscribes first and never exceeds 5", () => {
    const { mgr, sock, ids } = setup();
    mgr.setWanted(["1101", "2330", "2317", "2454", "0050"]);
    ackAll(sock, ids);

    mgr.setChannel("2330", "aggregates");
    const sent = sock.takeSent();
    expect(sent).toEqual([{ event: "unsubscribe", data: { id: expect.any(String) } }]);
    expect(mgr.serverSubscriptionCount).toBe(5);

    sock.sent = sent;
    ackAll(sock, ids);
    expect(sock.sent).toEqual([{ event: "subscribe", data: { channel: "aggregates", symbol: "2330" } }]);
    ackAll(sock, ids);
    expect(mgr.serverSubscriptionCount).toBe(5);
    expect(ids.size).toBe(5);

    // A bare symbol list keeps the channel already chosen.
    mgr.setWanted(["1101", "2330", "2317", "2454"]);
    const next = sock.takeSent();
    expect(next.map((m) => m.event)).toEqual(["unsubscribe"]);
    expect(mgr.channelOf("2330")).toBe("aggregates");
  });

  it("emits aggregates", () => {
    const { mgr, sock } = setup();
    const onAggregate = vi.fn();
    mgr.addListener({ onAggregate });
    sock.receive({ event: "data", channel: "aggregates", id: "x", data: { symbol: "2330", lastPrice: 1000, bids: [] } });
    expect(onAggregate).toHaveBeenCalledWith(expect.objectContaining({ symbol: "2330", lastPrice: 1000 }));
  });
});
