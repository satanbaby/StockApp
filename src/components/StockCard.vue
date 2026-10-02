<script setup lang="ts">
import { computed } from "vue";
import { useMarketStore, type ChartMode } from "../stores/market";
import DepthPanel from "./DepthPanel.vue";
import IntradayChart from "./IntradayChart.vue";
import KLineChart from "./KLineChart.vue";
import MaToggles from "./MaToggles.vue";

const props = defineProps<{ symbol: string; kind: "pinned" | "dynamic" }>();
const store = useMarketStore();

const stock = computed(() => store.stocks[props.symbol]);
const mode = computed<ChartMode>(() => store.chartMode[props.symbol] ?? "intraday");

const trend = computed(() => {
  const c = stock.value?.change;
  if (c == null || c === 0) return "flat";
  return c > 0 ? "up" : "down";
});

function fmtPrice(v: number | null | undefined) {
  return v == null ? "--" : v.toFixed(2);
}
function fmtSigned(v: number | null | undefined, suffix = "") {
  if (v == null) return "--";
  const arrow = v > 0 ? "▲" : v < 0 ? "▼" : "";
  return `${arrow}${Math.abs(v).toFixed(2)}${suffix}`;
}
const updatedText = computed(() => {
  const t = stock.value?.lastUpdated;
  if (!t) return "--:--:--";
  return new Date(t).toLocaleTimeString("zh-TW", { hour12: false, timeZone: "Asia/Taipei" });
});

function setMode(m: ChartMode) {
  store.setChartMode(props.symbol, m);
}

function onKey(e: KeyboardEvent) {
  if (e.target !== e.currentTarget) return; // ignore keys on inner controls
  if (e.key === "ArrowLeft") {
    store.cycleChartMode(props.symbol, -1);
    e.preventDefault();
  } else if (e.key === "ArrowRight") {
    store.cycleChartMode(props.symbol, 1);
    e.preventDefault();
  } else if (e.key === "Enter" && props.kind === "dynamic") {
    store.pinDynamic();
    e.preventDefault();
  } else if ((e.key === "Delete" || e.key === "Backspace") && props.kind === "pinned") {
    store.unpin(props.symbol);
    e.preventDefault();
  }
}
</script>

<template>
  <article v-if="stock" class="card" :class="[trend, kind]" :data-symbol="symbol" tabindex="0" @keydown="onKey">
    <header class="head">
      <div class="id">
        <span class="sym">{{ symbol }}</span>
        <span class="name">{{ stock.name || "…" }}</span>
        <span v-if="kind === 'dynamic'" class="tag">查詢</span>
      </div>
      <div class="actions">
        <button tabindex="-1" v-if="kind === 'dynamic'" class="ghost" title="釘選為常駐 (Enter)" @click="store.pinDynamic()">📌 釘選</button>
        <button tabindex="-1" v-if="kind === 'dynamic'" class="ghost icon" title="關閉" @click="store.closeDynamic()">✕</button>
        <button tabindex="-1" v-else class="ghost" title="取消釘選 (Delete)" @click="store.unpin(symbol)">取消釘選</button>
      </div>
    </header>

    <div class="quote">
      <span class="price">{{ fmtPrice(stock.price) }}</span>
      <span class="chg">{{ fmtSigned(stock.change) }}</span>
      <span class="chg">{{ fmtSigned(stock.changePercent, "%") }}</span>
    </div>

    <div class="chart-area">
      <div v-if="stock.error" class="state error">
        {{ stock.error }}
        <button tabindex="-1" class="ghost" @click="store.retry(symbol)">重試</button>
      </div>
      <div v-else-if="stock.loading" class="state">載入中…</div>
      <template v-else>
        <IntradayChart
          v-if="mode === 'intraday'"
          :symbol="symbol"
          :revision="stock.revision"
          :reference-price="stock.referencePrice"
        />
        <KLineChart v-else-if="mode === 'kline'" :symbol="symbol" :revision="stock.revision" />
        <DepthPanel v-else-if="mode === 'chips'" :depth="stock.depth" :reference-price="stock.referencePrice" />
        <!-- MA legend overlays the K-line's top-left corner. -->
        <MaToggles v-if="mode === 'kline'" class="legend" />
      </template>
      <div v-if="mode !== 'chips'" class="hint">
        <span>{{ mode === "kline" ? "← 即時走勢" : "" }}</span>
        <span>{{ mode === "intraday" ? "30 日 K 線 →" : "盤中籌碼 →" }}</span>
      </div>
    </div>

    <footer class="foot">
      <div class="seg">
        <button tabindex="-1" :class="{ active: mode === 'intraday' }" @click="setMode('intraday')">即時走勢</button>
        <button tabindex="-1" :class="{ active: mode === 'kline' }" @click="setMode('kline')">30 日 K 線</button>
        <button tabindex="-1" :class="{ active: mode === 'chips' }" @click="setMode('chips')">盤中籌碼</button>
      </div>
      <span class="time">{{ updatedText }}</span>
    </footer>
  </article>
</template>

<style scoped>
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 10px 6px;
  outline: none;
  transition: border-color 0.15s;
}
.card:hover {
  border-color: var(--border-strong);
}
.card:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}
.card.dynamic {
  border-style: dashed;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.id {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.sym {
  font-weight: 700;
  font-size: 14px;
}
.name {
  color: var(--muted);
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tag {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--accent-bg);
  color: var(--accent);
}
.actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.quote {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 2px 0 4px;
  font-variant-numeric: tabular-nums;
}
.price {
  font-size: 22px;
  font-weight: 700;
}
.chg {
  font-size: 13px;
}
.up .price,
.up .chg {
  color: var(--up);
}
.down .price,
.down .chg {
  color: var(--down);
}
.flat .price,
.flat .chg {
  color: var(--flat);
}
.chart-area {
  position: relative;
  height: 120px;
}
.state {
  height: 100%;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 6px;
  color: var(--muted);
  font-size: 12px;
}
.state.error {
  color: var(--up);
}
.legend {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
}
.hint {
  position: absolute;
  inset: auto 0 0 0;
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--muted);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s;
  padding: 0 2px;
}
.card:hover .hint,
.card:focus-visible .hint,
.card:focus .hint {
  opacity: 1;
}
.foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 11px;
}
.seg {
  display: flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.seg button {
  border: none;
  background: none;
  color: var(--muted);
  padding: 2px 7px;
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
}
.seg button.active {
  background: var(--accent-bg);
  color: var(--accent);
}
.time {
  margin-left: auto;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
</style>
