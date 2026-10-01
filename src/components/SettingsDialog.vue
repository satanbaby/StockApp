<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useMarketStore } from "../stores/market";
import type { ThemeSetting } from "../services/settings";
import ShortcutRecorder from "./ShortcutRecorder.vue";

const store = useMarketStore();
const key = ref(store.apiKey);
const keyInput = ref<HTMLInputElement>();

const THEMES: { value: ThemeSetting; label: string }[] = [
  { value: "system", label: "跟隨系統" },
  { value: "light", label: "☀ 淺色" },
  { value: "dark", label: "🌙 深色" },
];

watch(
  () => store.settingsOpen,
  async (open) => {
    if (!open) return;
    key.value = store.apiKey;
    await nextTick();
    keyInput.value?.focus();
  },
  { immediate: true },
);

function close() {
  if (!store.apiKey) return;
  store.settingsOpen = false;
  store.requestFocus(null);
}

/** Shortcut and theme apply instantly; only the API key needs saving. */
function save() {
  const trimmed = key.value.trim();
  if (!trimmed) return;
  if (trimmed !== store.apiKey) void store.setApiKey(trimmed);
  else close();
}
</script>

<template>
  <div v-if="store.settingsOpen" class="backdrop" @click.self="close()">
    <form class="dialog" @submit.prevent="save" @keydown.esc.prevent="close()">
      <h3>設定</h3>

      <section>
        <label for="api-key">Fugle API Key</label>
        <input
          id="api-key"
          ref="keyInput"
          v-model="key"
          type="password"
          placeholder="貼上 Fugle MarketData API Key"
        />
        <p class="help">於 Fugle 開發者平台申請。Key 只儲存在本機。</p>
      </section>

      <section>
        <label>叫出面板快捷鍵</label>
        <ShortcutRecorder :model-value="store.shortcut" @record="store.setShortcut($event)" />
        <p v-if="store.shortcutError" class="help error">{{ store.shortcutError }}</p>
        <p v-else class="help">在任何程式中按下即可開啟 / 收起面板。</p>
      </section>

      <section>
        <label>主題</label>
        <div class="seg">
          <button
            v-for="t in THEMES"
            :key="t.value"
            type="button"
            :class="{ active: store.theme === t.value }"
            @click="store.setTheme(t.value)"
          >
            {{ t.label }}
          </button>
        </div>
      </section>

      <div class="row">
        <button v-if="store.apiKey" type="button" class="ghost" @click="close()">關閉</button>
        <button type="submit" class="primary" :disabled="!key.trim()">儲存</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
section {
  display: grid;
  gap: 6px;
  margin-bottom: 12px;
}
label {
  font-size: 12px;
  color: var(--muted);
}
input {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 7px 10px;
  border-radius: 8px;
  outline: none;
}
input:focus {
  border-color: var(--accent);
}
.help {
  font-size: 11px;
  color: var(--muted);
}
.help.error {
  color: var(--up);
}
.seg {
  display: flex;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.seg button {
  flex: 1;
  border: none;
  background: none;
  color: var(--muted);
  padding: 6px 0;
  font-size: 12px;
  cursor: pointer;
}
.seg button + button {
  border-left: 1px solid var(--border);
}
.seg button.active {
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: 600;
}
</style>
