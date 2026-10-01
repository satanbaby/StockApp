<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { CandlestickSeries, createChart, LineSeries, type IChartApi, type ISeriesApi } from "lightweight-charts";
import { MA_COLORS, MA_PERIODS, sma, type MaPeriod } from "../indicators/ma";
import { useMarketStore } from "../stores/market";
import type { DailyBar } from "../services/marketService";
import { baseChartOptions, chartColors, themedChartOptions, type ChartTheme } from "./chartTheme";

const VISIBLE_BARS = 30;

const props = defineProps<{ symbol: string; revision: number }>();
const store = useMarketStore();
const el = ref<HTMLDivElement>();
const loading = ref(true);
const error = ref<string | null>(null);

let chart: IChartApi | null = null;
let candles: ISeriesApi<"Candlestick"> | null = null;
const maSeries = new Map<MaPeriod, ISeriesApi<"Line">>();
let history: DailyBar[] = [];

/** Cached history + live today bar (replacing the historical one for today if present). */
function mergedBars(): DailyBar[] {
  const today = store.getTodayBar(props.symbol);
  if (!today) return history;
  const last = history[history.length - 1];
  if (last && last.time === today.time) return [...history.slice(0, -1), today];
  if (last && last.time > today.time) return history;
  return [...history, today];
}

function drawMa(bars: DailyBar[]) {
  const times = bars.map((b) => b.time);
  const closes = bars.map((b) => b.close);
  for (const p of MA_PERIODS) maSeries.get(p)?.setData(sma(times, closes, p));
}

function drawAll() {
  if (!candles || !chart) return;
  const bars = mergedBars();
  candles.setData(bars);
  drawMa(bars);
  // Keep the full history for indicator warm-up, but show only the last 30 bars.
  chart.timeScale().setVisibleLogicalRange({ from: bars.length - VISIBLE_BARS - 0.5, to: bars.length - 0.5 });
}

function updateToday() {
  if (!candles || loading.value) return;
  const today = store.getTodayBar(props.symbol);
  if (!today) return;
  const last = history[history.length - 1];
  if (last && last.time > today.time) return;
  candles.update(today);
  drawMa(mergedBars());
}

function applyMaVisibility() {
  for (const p of MA_PERIODS) maSeries.get(p)?.applyOptions({ visible: store.maVisible[p] });
}

function candleColors(theme: ChartTheme) {
  const { up, down } = chartColors(theme);
  return { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down };
}

onMounted(async () => {
  chart = createChart(el.value!, {
    ...baseChartOptions(store.resolvedTheme),
    timeScale: { borderVisible: false, rightOffset: 0, fixLeftEdge: false },
  });
  candles = chart.addSeries(CandlestickSeries, {
    ...candleColors(store.resolvedTheme),
    priceLineVisible: false,
  });
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

  try {
    const symbol = props.symbol;
    const bars = await store.getHistory(symbol);
    if (!chart || symbol !== props.symbol) return;
    history = bars;
    loading.value = false;
    drawAll();
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
  },
);

onBeforeUnmount(() => {
  chart?.remove();
  chart = null;
  candles = null;
  maSeries.clear();
});
</script>

<template>
  <div class="wrap">
    <div ref="el" class="chart"></div>
    <div v-if="loading" class="overlay">載入 K 線…</div>
    <div v-else-if="error" class="overlay error">{{ error }}</div>
  </div>
</template>

<style scoped>
.wrap {
  position: relative;
  width: 100%;
  height: 100%;
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
</style>
