<script setup lang="ts">
import { MA_COLORS, MA_PERIODS } from "../indicators/ma";
import { useMarketStore } from "../stores/market";

const store = useMarketStore();
</script>

<template>
  <div class="ma">
    <label v-for="p in MA_PERIODS" :key="p" :style="{ color: MA_COLORS[p] }">
      <input type="checkbox" tabindex="-1" :checked="store.maVisible[p]" @change="store.toggleMa(p)" />
      MA{{ p }}
    </label>
  </div>
</template>

<style scoped>
.ma {
  display: flex;
  gap: 6px;
  font-size: 10px;
  line-height: 14px;
}
label {
  display: flex;
  align-items: center;
  gap: 2px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
input {
  margin: 0;
  width: 11px;
  height: 11px;
  accent-color: currentColor;
  cursor: pointer;
}
</style>
