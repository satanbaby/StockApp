<script setup lang="ts">
import { MA_COLORS, MA_PERIODS } from "../indicators/ma";
import { useMarketStore } from "../stores/market";

const store = useMarketStore();
</script>

<template>
  <!-- Compact "MA ☑5 ☑10 ☑20 ☑60" so it fits beside a 4-digit quote in the 400px window. -->
  <div class="ma">
    <span class="prefix">MA</span>
    <label v-for="p in MA_PERIODS" :key="p" :style="{ color: MA_COLORS[p] }" :title="`MA${p}`">
      <input type="checkbox" tabindex="-1" :checked="store.maVisible[p]" @change="store.toggleMa(p)" />
      {{ p }}
    </label>
  </div>
</template>

<style scoped>
.ma {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  line-height: 14px;
}
.prefix {
  color: var(--muted);
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
