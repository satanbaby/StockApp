<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { MAX_PINNED, useMarketStore } from "./stores/market";
import TopBar from "./components/TopBar.vue";
import StockCard from "./components/StockCard.vue";
import ReplacePinDialog from "./components/ReplacePinDialog.vue";
import SettingsDialog from "./components/SettingsDialog.vue";

const store = useMarketStore();
const emptySlots = computed(() => MAX_PINNED - store.pinned.length);
let lastFocusedSymbol: string | null = null;
let unlistenShown: UnlistenFn | null = null;

function symbolInput(): HTMLInputElement | null {
  return document.getElementById("symbol-input") as HTMLInputElement | null;
}

function cardEl(symbol: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.card[data-symbol="${CSS.escape(symbol)}"]`);
}

function focusTarget(symbol: string | null) {
  const el = (symbol && cardEl(symbol)) || symbolInput();
  el?.focus();
}

/** Write into the v-model'd input and let Vue pick it up. */
function setInputValue(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input"));
}

function onKeydown(e: KeyboardEvent) {
  // Dialogs own the keyboard while open.
  if (store.replaceDialogOpen || store.settingsOpen) return;
  const input = symbolInput();
  if (!input) return;
  const active = document.activeElement;

  // Typing a code from anywhere goes straight into the search box.
  if (/^[0-9A-Za-z]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey && active !== input) {
    e.preventDefault();
    input.focus();
    setInputValue(input, input.value + e.key);
    return;
  }

  if (e.key === "Escape") {
    e.preventDefault();
    if (active === input && input.value) setInputValue(input, "");
    else void invoke("hide_panel_cmd");
    return;
  }

  // Tab cycles input → cards only, skipping buttons inside cards.
  if (e.key === "Tab" && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    const stops: HTMLElement[] = [input, ...document.querySelectorAll<HTMLElement>(".card[data-symbol]")];
    const current = stops.findIndex((el) => el === active || (active && el.contains(active)));
    const step = e.shiftKey ? -1 : 1;
    const next = current < 0 ? (e.shiftKey ? stops.length - 1 : 0) : (current + step + stops.length) % stops.length;
    stops[next].focus();
  }
}

function onFocusIn(e: FocusEvent) {
  const card = (e.target as HTMLElement | null)?.closest<HTMLElement>(".card[data-symbol]");
  if (card) lastFocusedSymbol = card.dataset.symbol ?? null;
  else if (e.target === symbolInput()) lastFocusedSymbol = null;
}

watch(
  () => store.focusRequest,
  async (req) => {
    if (!req) return;
    await nextTick();
    focusTarget(req.symbol);
  },
);

onMounted(async () => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("focusin", onFocusIn);
  unlistenShown = await listen("panel-shown", async () => {
    await nextTick();
    const symbol = lastFocusedSymbol && store.watchlist.includes(lastFocusedSymbol) ? lastFocusedSymbol : null;
    focusTarget(symbol);
  });
  void store.init();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("focusin", onFocusIn);
  unlistenShown?.();
});
</script>

<template>
  <main class="app">
    <TopBar />
    <section v-if="store.ready" class="list">
      <StockCard v-if="store.dynamic" :key="`d-${store.dynamic}`" :symbol="store.dynamic" kind="dynamic" />
      <StockCard v-for="sym in store.pinned" :key="sym" :symbol="sym" kind="pinned" />
      <div v-if="emptySlots > 0" class="empty">
        常駐 {{ store.pinned.length }} / {{ MAX_PINNED }}・查詢股票後按 Enter 或「📌 釘選」加入
      </div>
    </section>
    <footer class="keys">打代號查詢・←/→ 圖表・Tab 換股・Enter 釘選・Del 取消釘選・Esc 收起</footer>
    <ReplacePinDialog />
    <SettingsDialog />
  </main>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  height: 100vh;
  box-sizing: border-box;
  border: 1px solid var(--border-strong);
}
.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  flex: 1;
  padding: 2px 2px 2px 0;
}
.empty {
  border: 1px dashed var(--border);
  border-radius: 10px;
  padding: 14px;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
}
.keys {
  font-size: 10px;
  color: var(--muted);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
