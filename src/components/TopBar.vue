<script setup lang="ts">
import { computed, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useMarketStore } from "../stores/market";

const store = useMarketStore();
const input = ref("");

const statusText = computed(
  () =>
    ({
      idle: "未連線",
      connecting: "連線中",
      authenticating: "驗證中",
      open: "即時",
      reconnecting: "重新連線",
      "auth-failed": "API Key 無效",
    })[store.status],
);

/** Title-bar theme button: light → dark → glass → light. "System" joins the cycle at what it currently shows. */
const THEME_CYCLE = [
  { value: "light", icon: "☀", label: "淺色" },
  { value: "dark", icon: "🌙", label: "深色" },
  { value: "glass", icon: "◐", label: "毛玻璃" },
] as const;
const themeIndex = computed(() => {
  const current = store.theme === "system" ? store.resolvedTheme : store.theme;
  return THEME_CYCLE.findIndex((t) => t.value === current);
});
const currentTheme = computed(() => THEME_CYCLE[themeIndex.value]);
const nextTheme = computed(() => THEME_CYCLE[(themeIndex.value + 1) % THEME_CYCLE.length]);

function submit() {
  if (!input.value.trim()) return;
  if (store.setDynamic(input.value)) input.value = "";
}
</script>

<template>
  <header class="title">
    <span class="app-name">即時台股</span>
    <span class="status" :class="store.status" :title="statusText">● {{ statusText }}</span>
    <span class="spacer"></span>
    <button
      class="ghost icon"
      :class="{ active: store.alwaysOnTop }"
      tabindex="-1"
      :title="store.alwaysOnTop ? '取消釘住面板' : '釘住面板（置頂、點外面不收起）'"
      @click="store.setAlwaysOnTop(!store.alwaysOnTop)"
    >
      📌
    </button>
    <button
      class="ghost icon theme"
      tabindex="-1"
      :title="`主題：${currentTheme.label}・點一下切換為${nextTheme.label}`"
      @click="store.setTheme(nextTheme.value)"
    >
      {{ currentTheme.icon }}
    </button>
    <button class="ghost icon" tabindex="-1" title="設定" @click="store.settingsOpen = true">⚙</button>
    <button class="ghost icon" tabindex="-1" title="收起 (Esc)" @click="invoke('hide_panel_cmd')">✕</button>
  </header>
  <form class="search" @submit.prevent="submit">
    <input
      id="symbol-input"
      v-model="input"
      placeholder="輸入股票代號，Enter 查詢"
      maxlength="6"
      spellcheck="false"
      autocomplete="off"
      autofocus
    />
  </form>
  <div v-if="store.notice" class="notice">{{ store.notice }}</div>
</template>

<style scoped>
.title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: -2px 0 -2px;
}
.app-name {
  font-weight: 700;
  font-size: 13px;
}
.spacer {
  flex: 1;
}
.search input {
  width: 100%;
  box-sizing: border-box;
  background: var(--card);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 13px;
  outline: none;
}
.search input:focus {
  border-color: var(--accent);
}
.status {
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
}
.status.open {
  color: var(--down);
}
.status.auth-failed {
  color: var(--up);
}
.icon:not(.active) {
  filter: grayscale(1);
  opacity: 0.6;
}
.active {
  background: var(--accent-bg);
}
.notice {
  font-size: 12px;
  color: var(--accent);
}
</style>
