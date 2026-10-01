<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { BaselineSeries, createChart, LineStyle, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useMarketStore } from "../stores/market";
import { baseChartOptions, chartColors, themedChartOptions, type ChartTheme } from "./chartTheme";
import type { IntradayPoint } from "../services/marketService";

const props = defineProps<{ symbol: string; revision: number; referencePrice: number | null }>();
const store = useMarketStore();
const el = ref<HTMLDivElement>();

let chart: IChartApi | null = null;
let series: ISeriesApi<"Baseline"> | null = null;
let drawn: IntradayPoint[] | null = null;
let drawnLength = 0;

function toSeries(p: IntradayPoint) {
  return { time: p.time as UTCTimestamp, value: p.value };
}

function redraw() {
  if (!series) return;
  const data = store.getIntraday(props.symbol);
  if (props.referencePrice != null) {
    series.applyOptions({ baseValue: { type: "price", price: props.referencePrice } });
  }
  // Same array growing by trades → incremental update; otherwise full reset.
  if (data === drawn && data.length >= drawnLength && data.length - drawnLength <= 1 && data.length > 0) {
    series.update(toSeries(data[data.length - 1]));
  } else {
    series.setData(data.map(toSeries));
    chart?.timeScale().fitContent();
  }
  drawn = data;
  drawnLength = data.length;
}

function seriesColors(theme: ChartTheme) {
  const c = chartColors(theme);
  return {
    topLineColor: c.up,
    topFillColor1: c.upFill,
    topFillColor2: "rgba(0, 0, 0, 0)",
    bottomLineColor: c.down,
    bottomFillColor1: "rgba(0, 0, 0, 0)",
    bottomFillColor2: c.downFill,
  };
}

onMounted(() => {
  chart = createChart(el.value!, {
    ...baseChartOptions(store.resolvedTheme),
    timeScale: { timeVisible: true, secondsVisible: false, borderVisible: false },
  });
  series = chart.addSeries(BaselineSeries, {
    ...seriesColors(store.resolvedTheme),
    lineWidth: 2,
    priceLineVisible: false,
    baseLineStyle: LineStyle.Dashed,
  });
  redraw();
});

watch(() => [props.revision, props.referencePrice], redraw);
watch(
  () => store.resolvedTheme,
  (theme) => {
    chart?.applyOptions(themedChartOptions(theme));
    series?.applyOptions(seriesColors(theme));
  },
);

onBeforeUnmount(() => {
  chart?.remove();
  chart = null;
  series = null;
});
</script>

<template>
  <div ref="el" class="chart"></div>
</template>

<style scoped>
.chart {
  width: 100%;
  height: 100%;
}
</style>
