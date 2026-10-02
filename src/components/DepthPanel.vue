<script setup lang="ts">
import { computed } from "vue";
import type { Depth, DepthLevel } from "../services/marketService";

const LEVELS = 5;

const props = defineProps<{ depth: Depth | null; referencePrice: number | null }>();

function pad(levels: DepthLevel[]): (DepthLevel | null)[] {
  return Array.from({ length: LEVELS }, (_, i) => levels[i] ?? null);
}

const bids = computed(() => pad(props.depth?.bids ?? []));
const asks = computed(() => pad(props.depth?.asks ?? []));
const hasBook = computed(() => !!props.depth && (props.depth.bids.length > 0 || props.depth.asks.length > 0));

/** Bars on both sides share one scale so their lengths are comparable. */
const maxSize = computed(() => {
  const all = [...(props.depth?.bids ?? []), ...(props.depth?.asks ?? [])].map((l) => l.size);
  return Math.max(1, ...all);
});

const ratio = computed(() => {
  const atBid = props.depth?.atBid ?? 0;
  const atAsk = props.depth?.atAsk ?? 0;
  const total = atBid + atAsk;
  return total > 0 ? { atBid, atAsk, bidPct: (atBid / total) * 100, askPct: (atAsk / total) * 100 } : null;
});

function bar(level: DepthLevel | null): string {
  return level ? `${(level.size / maxSize.value) * 100}%` : "0%";
}

function trend(price: number | undefined): string {
  const ref = props.referencePrice;
  if (price == null || ref == null || price === ref) return "flat";
  return price > ref ? "up" : "down";
}

function fmtPrice(level: DepthLevel | null): string {
  // Fugle reports market orders during auctions with price 0.
  if (!level) return "";
  return level.price ? level.price.toFixed(2) : "市價";
}

function fmtSize(level: DepthLevel | null): string {
  return level ? level.size.toLocaleString("zh-TW") : "";
}

const fmtLots = (v: number) => v.toLocaleString("zh-TW");
</script>

<template>
  <div class="depth">
    <div class="ratio" :title="ratio ? '內盤：在委買價成交（賣方主動）・外盤：在委賣價成交（買方主動）' : ''">
      <template v-if="ratio">
        <span class="label down">內 {{ fmtLots(ratio.atBid) }}・{{ ratio.bidPct.toFixed(0) }}%</span>
        <div class="bar">
          <div class="seg down" :style="{ width: `${ratio.bidPct}%` }"></div>
          <div class="seg up" :style="{ width: `${ratio.askPct}%` }"></div>
        </div>
        <span class="label up">{{ ratio.askPct.toFixed(0) }}%・{{ fmtLots(ratio.atAsk) }} 外</span>
      </template>
      <span v-else class="muted">尚無內外盤資料</span>
    </div>

    <div v-if="hasBook" class="book">
      <div class="head">
        <span>委買量</span><span>買價</span><span>賣價</span><span>委賣量</span>
      </div>
      <div v-for="i in LEVELS" :key="i" class="row">
        <div class="side bid">
          <div class="fill" :style="{ width: bar(bids[i - 1]) }"></div>
          <span class="size">{{ fmtSize(bids[i - 1]) }}</span>
          <span class="price" :class="trend(bids[i - 1]?.price)">{{ fmtPrice(bids[i - 1]) }}</span>
        </div>
        <div class="side ask">
          <div class="fill" :style="{ width: bar(asks[i - 1]) }"></div>
          <span class="price" :class="trend(asks[i - 1]?.price)">{{ fmtPrice(asks[i - 1]) }}</span>
          <span class="size">{{ fmtSize(asks[i - 1]) }}</span>
        </div>
      </div>
    </div>
    <div v-else class="empty">尚無五檔資料</div>
  </div>
</template>

<style scoped>
.depth {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.ratio {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 16px;
  flex-shrink: 0;
}
.ratio .label {
  white-space: nowrap;
  font-size: 10px;
}
.bar {
  flex: 1;
  display: flex;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  background: var(--border);
}
.seg.down {
  background: var(--down);
}
.seg.up {
  background: var(--up);
}
.book {
  flex: 1;
  display: grid;
  grid-template-rows: auto repeat(5, 1fr);
  min-height: 0;
}
.head {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  color: var(--muted);
  font-size: 9px;
}
.head span:nth-child(1) {
  text-align: left;
}
.head span:nth-child(2) {
  text-align: right;
  padding-right: 6px;
}
.head span:nth-child(3) {
  padding-left: 6px;
}
.head span:nth-child(4) {
  text-align: right;
}
.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  min-height: 0;
}
.side {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 6px;
  border-radius: 3px;
  overflow: hidden;
}
.fill {
  position: absolute;
  top: 1px;
  bottom: 1px;
  pointer-events: none;
  opacity: 0.18;
}
/* Bars grow outward from the centre line. */
.bid .fill {
  right: 0;
  background: var(--down);
}
.ask .fill {
  left: 0;
  background: var(--up);
}
.size,
.price {
  position: relative;
}
.size {
  color: var(--text);
}
.price {
  font-weight: 600;
}
.up {
  color: var(--up);
}
.down {
  color: var(--down);
}
.flat {
  color: var(--flat);
}
.muted,
.empty {
  color: var(--muted);
}
.empty {
  flex: 1;
  display: grid;
  place-items: center;
}
</style>
