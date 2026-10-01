<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useMarketStore } from "../stores/market";

const store = useMarketStore();
const list = ref<HTMLUListElement>();

function options(): HTMLButtonElement[] {
  return [...(list.value?.querySelectorAll<HTMLButtonElement>("button.option") ?? [])];
}

watch(
  () => store.replaceDialogOpen,
  async (open) => {
    if (!open) return;
    await nextTick();
    options()[0]?.focus();
  },
);

/** ↑/↓ move between choices, Enter picks (native button click), Esc cancels. */
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    store.cancelReplace();
    return;
  }
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "Tab") return;
  e.preventDefault();
  const opts = options();
  const i = opts.indexOf(document.activeElement as HTMLButtonElement);
  const step = e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey) ? -1 : 1;
  opts[(i + step + opts.length) % opts.length]?.focus();
}
</script>

<template>
  <div v-if="store.replaceDialogOpen" class="backdrop" @click.self="store.cancelReplace()" @keydown="onKey">
    <div class="dialog" role="dialog" aria-modal="true">
      <h3>常駐已滿 4 檔</h3>
      <p>選擇要被 <b>{{ store.dynamic }}</b> 取代的股票（↑/↓ 選擇、Enter 確認、Esc 取消）：</p>
      <ul ref="list">
        <li v-for="(sym, i) in store.pinned" :key="sym">
          <button class="option" @click="store.replacePinned(i)">
            <span class="sym">{{ sym }}</span>
            <span class="name">{{ store.stocks[sym]?.name }}</span>
          </button>
        </li>
      </ul>
      <div class="row">
        <button class="ghost" tabindex="-1" @click="store.cancelReplace()">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
ul {
  list-style: none;
  padding: 0;
  margin: 8px 0;
  display: grid;
  gap: 6px;
}
.option {
  width: 100%;
  display: flex;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text);
  cursor: pointer;
  text-align: left;
  outline: none;
}
.option:hover,
.option:focus {
  border-color: var(--accent);
  background: var(--accent-bg);
}
.sym {
  font-weight: 700;
}
.name {
  color: var(--muted);
}
</style>
