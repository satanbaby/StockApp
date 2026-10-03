import { defineStore } from "pinia";
import { computed, reactive, ref, shallowRef, watchEffect } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { MaPeriod } from "../indicators/ma";
import type { ConnectionStatus } from "../services/fugle/wsManager";
import { MarketService, type DailyBar, type Depth, type IntradayPoint } from "../services/marketService";
import { DEFAULT_SETTINGS, loadSettings, saveSetting, type ThemeSetting } from "../services/settings";

export const MAX_PINNED = 4;

export type ChartMode = "intraday" | "kline" | "chips";
/** Order of the card views as ←/→ walks through them. */
export const CHART_MODES: ChartMode[] = ["intraday", "kline", "chips"];

export interface StockView {
  symbol: string;
  name: string;
  referencePrice: number | null;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  lastUpdated: number | null;
  /** Order book; only kept fresh while the card is in the "chips" view. */
  depth: Depth | null;
  /** Bumped on every update so charts know to redraw without deep watching. */
  revision: number;
  loading: boolean;
  error: string | null;
}

export const useMarketStore = defineStore("market", () => {
  const apiKey = ref("");
  const pinned = ref<string[]>([]);
  const dynamic = ref<string | null>(null);
  const alwaysOnTop = ref(false);
  const maVisible = reactive<Record<MaPeriod, boolean>>({ ...DEFAULT_SETTINGS.maVisible });
  const status = ref<ConnectionStatus>("idle");
  const notice = ref<string | null>(null);
  const replaceDialogOpen = ref(false);
  const settingsOpen = ref(false);
  const ready = ref(false);
  const focusRequest = ref<{ symbol: string | null; seq: number } | null>(null);
  const shortcut = ref(DEFAULT_SETTINGS.shortcut);
  const shortcutError = ref<string | null>(null);
  const theme = ref<ThemeSetting>(DEFAULT_SETTINGS.theme);

  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const systemDark = ref(darkQuery.matches);
  darkQuery.addEventListener("change", (e) => (systemDark.value = e.matches));
  const resolvedTheme = computed<"light" | "dark">(() =>
    theme.value === "light" || theme.value === "dark" ? theme.value : systemDark.value ? "dark" : "light",
  );
  const glass = computed(() => theme.value === "glass");
  const clear = computed(() => theme.value === "clear");
  watchEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme.value;
    if (glass.value) root.dataset.glass = "";
    else delete root.dataset.glass;
    if (clear.value) root.dataset.clear = "";
    else delete root.dataset.clear;
    // Native blur behind the (now translucent) page; off for the opaque themes and for
    // `clear`, where the transparent window shows the desktop as-is.
    void invoke("set_glass", { tint: glass.value ? resolvedTheme.value : null }).catch(() => {});
  });

  const stocks = reactive<Record<string, StockView>>({});
  const chartMode = reactive<Record<string, ChartMode>>({});
  // Chart series live outside deep reactivity (they can be large and mutate per trade).
  const intraday = new Map<string, IntradayPoint[]>();
  const todayBars = new Map<string, DailyBar | null>();

  const service = shallowRef<MarketService | null>(null);

  const watchlist = computed(() => {
    const list = [...pinned.value];
    if (dynamic.value && !list.includes(dynamic.value)) list.push(dynamic.value);
    return list;
  });

  function ensureView(symbol: string): StockView {
    stocks[symbol] ??= {
      symbol,
      name: "",
      referencePrice: null,
      price: null,
      change: null,
      changePercent: null,
      lastUpdated: null,
      depth: null,
      revision: 0,
      loading: true,
      error: null,
    };
    chartMode[symbol] ??= "intraday";
    return stocks[symbol];
  }

  function syncWatchlist() {
    const list = watchlist.value;
    list.forEach(ensureView);
    for (const symbol of Object.keys(stocks)) {
      if (!list.includes(symbol)) {
        delete stocks[symbol];
        delete chartMode[symbol]; // re-added symbols start on the trades channel again
        intraday.delete(symbol);
        todayBars.delete(symbol);
      }
    }
    service.value?.setWatchlist(list);
  }

  async function init() {
    const settings = await loadSettings();
    apiKey.value = settings.apiKey;
    pinned.value = settings.pinned;
    alwaysOnTop.value = settings.alwaysOnTop;
    Object.assign(maVisible, settings.maVisible);
    theme.value = settings.theme;
    shortcut.value = settings.shortcut;
    void registerShortcut(settings.shortcut).then((err) => (shortcutError.value = err));

    service.value = new MarketService(() => apiKey.value, {
      onSnapshot(symbol, snap) {
        const v = stocks[symbol];
        if (!v) return;
        intraday.set(symbol, snap.intraday);
        todayBars.set(symbol, snap.today);
        Object.assign(v, {
          name: snap.name,
          referencePrice: snap.referencePrice,
          price: snap.price,
          change: snap.change,
          changePercent: snap.changePercent,
          lastUpdated: snap.lastUpdated,
          depth: snap.depth,
          loading: false,
          error: null,
        });
        v.revision++;
      },
      onTrade(symbol, u) {
        const v = stocks[symbol];
        if (!v) return;
        todayBars.set(symbol, u.today);
        Object.assign(v, {
          price: u.price,
          change: u.change,
          changePercent: u.changePercent,
          lastUpdated: u.lastUpdated,
        });
        v.revision++;
      },
      onDepth(symbol, depth) {
        const v = stocks[symbol];
        if (v) v.depth = depth;
      },
      onError(symbol, message) {
        const v = stocks[symbol];
        if (!v) return;
        v.loading = false;
        v.error = message;
      },
      onStatus(s) {
        status.value = s;
      },
    });

    if (alwaysOnTop.value) void invoke("set_always_on_top", { on: true });
    void listen<boolean>("always-on-top-changed", (e) => {
      alwaysOnTop.value = e.payload;
      void saveSetting("alwaysOnTop", e.payload);
    });

    syncWatchlist();
    service.value.start();
    if (!apiKey.value) {
      settingsOpen.value = true;
      void invoke("show_panel");
    }
    ready.value = true;
  }

  function flash(message: string) {
    notice.value = message;
    setTimeout(() => {
      if (notice.value === message) notice.value = null;
    }, 2500);
  }

  /** Ask the UI to move keyboard focus to a stock card (or the input when symbol is null). */
  function requestFocus(symbol: string | null) {
    focusRequest.value = { symbol, seq: (focusRequest.value?.seq ?? 0) + 1 };
  }

  /** Switch the dynamic (5th) stock; the previous one is unsubscribed. */
  function setDynamic(raw: string): boolean {
    const symbol = raw.trim().toUpperCase();
    if (!/^[0-9A-Z]{4,6}$/.test(symbol)) {
      flash("股票代號格式不正確");
      return false;
    }
    if (!pinned.value.includes(symbol) && dynamic.value !== symbol) {
      dynamic.value = symbol;
      syncWatchlist();
    }
    requestFocus(symbol);
    return true;
  }

  function closeDynamic() {
    dynamic.value = null;
    syncWatchlist();
    requestFocus(pinned.value[0] ?? null);
  }

  function persistPinned() {
    void saveSetting("pinned", [...pinned.value]);
  }

  function pinDynamic() {
    if (!dynamic.value) return;
    if (pinned.value.length < MAX_PINNED) {
      const symbol = dynamic.value;
      pinned.value.push(symbol);
      dynamic.value = null;
      persistPinned();
      syncWatchlist();
      requestFocus(symbol);
    } else {
      replaceDialogOpen.value = true;
    }
  }

  function cancelReplace() {
    replaceDialogOpen.value = false;
    requestFocus(dynamic.value);
  }

  /** Replace pinned[index] with the dynamic stock (after the "already 4" prompt). */
  function replacePinned(index: number) {
    replaceDialogOpen.value = false;
    if (!dynamic.value || index < 0 || index >= pinned.value.length) return;
    const symbol = dynamic.value;
    pinned.value.splice(index, 1, symbol);
    dynamic.value = null;
    persistPinned();
    syncWatchlist();
    requestFocus(symbol);
  }

  function unpin(symbol: string) {
    const order = watchlistOrder();
    const next = order[order.indexOf(symbol) + 1] ?? order[order.indexOf(symbol) - 1] ?? null;
    pinned.value = pinned.value.filter((s) => s !== symbol);
    persistPinned();
    syncWatchlist();
    requestFocus(next);
  }

  /** Cards in on-screen order: dynamic first, then pinned. */
  function watchlistOrder(): string[] {
    return dynamic.value ? [dynamic.value, ...pinned.value] : [...pinned.value];
  }

  function setChartMode(symbol: string, mode: ChartMode) {
    const prev = chartMode[symbol];
    if (prev === mode) return;
    chartMode[symbol] = mode;
    // The order-book view streams a different channel; swap it so each stock keeps one subscription.
    if ((prev === "chips") !== (mode === "chips")) service.value?.setDepthView(symbol, mode === "chips");
  }

  /** ←/→: step through the views, stopping at either end. */
  function cycleChartMode(symbol: string, dir: 1 | -1) {
    const i = CHART_MODES.indexOf(chartMode[symbol] ?? "intraday");
    const next = CHART_MODES[Math.min(CHART_MODES.length - 1, Math.max(0, i + dir))];
    setChartMode(symbol, next);
  }

  function toggleMa(period: MaPeriod) {
    maVisible[period] = !maVisible[period];
    void saveSetting("maVisible", { ...maVisible });
  }

  /** Returns an error message, or null on success. */
  async function registerShortcut(acc: string): Promise<string | null> {
    try {
      await invoke("set_global_shortcut", { accelerator: acc || null });
      return null;
    } catch (e) {
      return `快捷鍵 ${acc} 無法註冊：${e}`;
    }
  }

  /** Register first; only persist when the OS accepted it, otherwise restore the old one. */
  async function setShortcut(acc: string): Promise<boolean> {
    const previous = shortcut.value;
    const err = await registerShortcut(acc);
    if (err) {
      shortcutError.value = err;
      await registerShortcut(previous);
      return false;
    }
    shortcut.value = acc;
    shortcutError.value = null;
    await saveSetting("shortcut", acc);
    return true;
  }

  function setTheme(t: ThemeSetting) {
    theme.value = t;
    void saveSetting("theme", t);
  }

  function setAlwaysOnTop(on: boolean) {
    void invoke("set_always_on_top", { on });
  }

  async function setApiKey(key: string) {
    apiKey.value = key.trim();
    await saveSetting("apiKey", apiKey.value);
    settingsOpen.value = false;
    requestFocus(null);
    for (const v of Object.values(stocks)) {
      v.loading = true;
      v.error = null;
    }
    service.value?.restart();
  }

  function retry(symbol: string) {
    const v = stocks[symbol];
    if (v) {
      v.loading = true;
      v.error = null;
    }
    void service.value?.loadSymbol(symbol);
  }

  function getIntraday(symbol: string): IntradayPoint[] {
    return intraday.get(symbol) ?? [];
  }

  function getTodayBar(symbol: string): DailyBar | null {
    return todayBars.get(symbol) ?? null;
  }

  function getHistory(symbol: string): Promise<DailyBar[]> {
    if (!service.value) return Promise.reject(new Error("service not ready"));
    return service.value.getHistory(symbol);
  }

  function getOlderHistory(symbol: string, before: string): Promise<DailyBar[]> {
    if (!service.value) return Promise.reject(new Error("service not ready"));
    return service.value.getOlderHistory(symbol, before);
  }

  return {
    apiKey,
    pinned,
    dynamic,
    alwaysOnTop,
    maVisible,
    status,
    notice,
    replaceDialogOpen,
    settingsOpen,
    ready,
    focusRequest,
    shortcut,
    shortcutError,
    theme,
    resolvedTheme,
    stocks,
    chartMode,
    watchlist,
    init,
    setDynamic,
    requestFocus,
    watchlistOrder,
    cancelReplace,
    closeDynamic,
    pinDynamic,
    replacePinned,
    unpin,
    setChartMode,
    cycleChartMode,
    toggleMa,
    setAlwaysOnTop,
    setShortcut,
    setTheme,
    setApiKey,
    retry,
    getIntraday,
    getTodayBar,
    getHistory,
    getOlderHistory,
  };
});
