<script setup lang="ts">
import { computed } from "vue";
import { useUpdaterStore } from "../stores/updater";

const updater = useUpdaterStore();

const visible = computed(
  () =>
    (updater.state === "available" && updater.available?.version !== updater.dismissedVersion) ||
    updater.state === "downloading",
);
</script>

<template>
  <div v-if="visible" class="banner">
    <template v-if="updater.state === 'downloading'">
      <span>下載更新中… {{ updater.progress }}%</span>
      <div class="bar"><div class="fill" :style="{ width: `${updater.progress}%` }"></div></div>
    </template>
    <template v-else>
      <span>🎉 新版本 v{{ updater.available?.version }} 可更新</span>
      <span class="spacer"></span>
      <button class="primary small" tabindex="-1" @click="updater.install()">立即更新</button>
      <button class="ghost" tabindex="-1" @click="updater.dismiss()">稍後</button>
    </template>
  </div>
</template>

<style scoped>
.banner {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--accent-bg);
  color: var(--accent);
  font-size: 12px;
}
.spacer {
  flex: 1;
}
.small {
  padding: 3px 10px;
  font-size: 12px;
}
.bar {
  flex-basis: 100%;
  height: 3px;
  border-radius: 2px;
  background: var(--border);
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s;
}
</style>
