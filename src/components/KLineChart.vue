<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  CandlestickSeries,
  createChart,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
} from "lightweight-charts";
import { MA_COLORS, MA_PERIODS, sma, type MaPeriod } from "../indicators/ma";
import { useMarketStore } from "../stores/market";
import type { DailyBar } from "../services/marketService";
import { baseChartOptions, chartColors, themedChartOptions, type ChartTheme } from "./chartTheme";

const VISIBLE_BARS = 30;
/** Start fetching older candles when fewer than this many bars remain off-screen on the left. */
const LOAD_OLDER_THRESHOLD = 10;

const props = defineProps<{ symbol: string; revision: number }>();
const store = useMarketStore();
const wrap = ref<HTMLDivElement>();
const el = ref<HTMLDivElement>();
const loading = ref(true);
const loadingOlder = ref(false);
const error = ref<string | null>(null);

let chart: IChartApi | null = null;
let candles: ISeriesApi<"Candlestick"> | null = null;
let volume: ISeriesApi<"Histogram"> | null = null;
const maSeries = new Map<MaPeriod, ISeriesApi<"Line">>();
let history: DailyBar[] = [];
/** No older data available (reached the start of listing / Fugle's coverage). */
let exhausted = false;

/** Cached history + live today bar (replacing the historical one for today if present). */
function mergedBars(): DailyBar[] {
  const today = store.getTodayBar(props.symbol);
  if (!today) return history;
  const last = history[history.length - 1];
  if (last && last.time === today.time) return [...history.slice(0, -1), today];
  if (last && last.time > today.time) return history;
  return [...history, today];
}

function volumeBar(b: DailyBar, theme = store.resolvedTheme) {
  const { upFill, downFill } = chartColors(theme);
  return { time: b.time, value: b.volume, color: b.close >= b.open ? upFill : downFill };
}

function drawVolume(bars: DailyBar[]) {
  volume?.setData(bars.map((b) => volumeBar(b)));
}

function drawMa(bars: DailyBar[]) {
  const times = bars.map((b) => b.time);
  const closes = bars.map((b) => b.close);
  for (const p of MA_PERIODS) maSeries.get(p)?.setData(sma(times, closes, p));
}

/** Redraw everything; keeps the viewport at `range` if given, otherwise shows the last 30 bars. */
function drawAll(range?: LogicalRange | null) {
  if (!candles || !chart) return;
  const bars = mergedBars();
  candles.setData(bars);
  drawVolume(bars);
  drawMa(bars);
  chart.timeScale().setVisibleLogicalRange(range ?? defaultRange(bars.length));
}

function defaultRange(count: number): LogicalRange {
  return { from: count - VISIBLE_BARS - 0.5, to: count - 0.5 } as LogicalRange;
}

function resetView() {
  chart?.timeScale().setVisibleLogicalRange(defaultRange(mergedBars().length));
}

function updateToday() {
  if (!candles || loading.value) return;
  const today = store.getTodayBar(props.symbol);
  if (!today) return;
  const last = history[history.length - 1];
  if (last && last.time > today.time) return;
  candles.update(today);
  volume?.update(volumeBar(today));
  drawMa(mergedBars());
}

async function loadOlder() {
  if (loadingOlder.value || exhausted || !chart || history.length === 0) return;
  loadingOlder.value = true;
  const symbol = props.symbol;
  try {
    const older = await store.getOlderHistory(symbol, history[0].time);
    if (!chart || symbol !== props.symbol) return;
    if (older.length === 0) {
      exhausted = true;
      return;
    }
    // Prepending shifts logical indexes; move the viewport by the same amount so it does not jump.
    const range = chart.timeScale().getVisibleLogicalRange();
    history = [...older, ...history];
    drawAll(range && ({ from: range.from + older.length, to: range.to + older.length } as LogicalRange));
  } catch {
    exhausted = true; // e.g. before Fugle's data coverage; stop asking
  } finally {
    loadingOlder.value = false;
  }
}

function onVisibleRangeChange(range: LogicalRange | null) {
  if (range && range.from < LOAD_OLDER_THRESHOLD) void loadOlder();
}

/**
 * Vertical wheel keeps scrolling the card list. The chart only receives
 * Ctrl+wheel (zoom; also what a trackpad pinch produces) and horizontal
 * swipes (pan). Stopping propagation in the capture phase keeps the event from
 * the chart canvas without cancelling the default page scroll.
 */
function onWheelCapture(e: WheelEvent) {
  if (e.ctrlKey) {
    e.preventDefault(); // otherwise Ctrl+wheel zooms the whole webview
    return;
  }
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // horizontal swipe → pan
  e.stopPropagation();
}

function applyMaVisibility() {
  for (const p of MA_PERIODS) maSeries.get(p)?.applyOptions({ visible: store.maVisible[p] });
}

function candleColors(theme: ChartTheme) {
  const { up, down } = chartColors(theme);
  return { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down };
}

onMounted(async () => {
  wrap.value!.addEventListener("wheel", onWheelCapture, { capture: true, passive: false });
  chart = createChart(el.value!, {
    ...baseChartOptions(store.resolvedTheme),
    timeScale: { borderVisible: false, rightOffset: 0, minBarSpacing: 1.5 },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: {
      mouseWheel: true,
      pinch: true,
      axisPressedMouseMove: { time: true, price: false },
      axisDoubleClickReset: { time: false, price: true },
    },
  });
  candles = chart.addSeries(CandlestickSeries, {
    ...candleColors(store.resolvedTheme),
    priceLineVisible: false,
  });
  // Keep the candles clear of the MA legend at the top and the volume band at the bottom.
  candles.priceScale().applyOptions({ scaleMargins: { top: 0.16, bottom: 0.24 } });
  volume = chart.addSeries(HistogramSeries, {
    priceScaleId: "vol",
    priceFormat: { type: "volume" },
    priceLineVisible: false,
    lastValueVisible: false,
  });
  volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  for (const p of MA_PERIODS) {
    maSeries.set(
      p,
      chart.addSeries(LineSeries, {
        color: MA_COLORS[p],
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        visible: store.maVisible[p],
      }),
    );
  }
  chart.subscribeDblClick(resetView);

  try {
    const symbol = props.symbol;
    const bars = await store.getHistory(symbol);
    if (!chart || symbol !== props.symbol) return;
    history = bars;
    loading.value = false;
    drawAll();
    chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleRangeChange);
  } catch (e) {
    loading.value = false;
    error.value = e instanceof Error ? e.message : String(e);
  }
});

watch(() => props.revision, updateToday);
watch(() => ({ ...store.maVisible }), applyMaVisibility, { deep: true });
watch(
  () => store.resolvedTheme,
  (theme) => {
    chart?.applyOptions(themedChartOptions(theme));
    candles?.applyOptions(candleColors(theme));
    if (volume) drawVolume(mergedBars());
  },
);

onBeforeUnmount(() => {
  wrap.value?.removeEventListener("wheel", onWheelCapture, { capture: true });
  chart?.remove();
  chart = null;
  candles = null;
  volume = null;
  maSeries.clear();
});
</script>

<template>
  <div ref="wrap" class="wrap" title="拖曳或左右滑動瀏覽・Ctrl+滾輪／雙指縮放・雙擊回到最近 30 日">
    <div ref="el" class="chart"></div>
    <div v-if="loading" class="overlay">載入 K 線…</div>
    <div v-else-if="error" class="overlay error">{{ error }}</div>
    <div v-if="loadingOlder" class="older">載入更早資料…</div>
  </div>
</template>

<style scoped>
.wrap {
  position: relative;
  width: 100%;
  height: 100%;
  cursor: grab;
}
.wrap:active {
  cursor: grabbing;
}
.chart {
  width: 100%;
  height: 100%;
}
.overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 12px;
  color: var(--muted);
}
.overlay.error {
  color: var(--up);
}
.older {
  position: absolute;
  top: 2px;
  left: 4px;
  font-size: 10px;
  color: var(--muted);
  pointer-events: none;
}
</style>
