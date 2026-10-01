<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ (e: "record", accelerator: string): void }>();

const recording = ref(false);
const preview = ref("");

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "OS"]);

/** Map `KeyboardEvent.code` to the key name the Tauri global-shortcut parser accepts. */
function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  if (/^Numpad[0-9]$/.test(code)) return code;
  const named: Record<string, string> = {
    Space: "Space",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Insert: "Insert",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backslash: "\\",
  };
  return named[code] ?? null;
}

function modifiers(e: KeyboardEvent): string[] {
  const m: string[] = [];
  if (e.ctrlKey) m.push("Ctrl");
  if (e.altKey) m.push("Alt");
  if (e.shiftKey) m.push("Shift");
  if (e.metaKey) m.push("Super");
  return m;
}

function start() {
  recording.value = true;
  preview.value = "";
}

function stop() {
  recording.value = false;
  preview.value = "";
}

function onKeydown(e: KeyboardEvent) {
  if (!recording.value) return;
  e.preventDefault();
  e.stopPropagation();

  const mods = modifiers(e);
  if (e.key === "Escape" && mods.length === 0) {
    stop();
    return;
  }
  if (MODIFIER_KEYS.has(e.key)) {
    preview.value = mods.join("+") + "+…";
    return;
  }
  const key = keyName(e.code);
  if (!key) {
    preview.value = "不支援此按鍵";
    return;
  }
  // Plain keys would hijack normal typing everywhere; F-keys are the exception.
  if (mods.length === 0 && !/^F\d+$/.test(key)) {
    preview.value = "請搭配 Ctrl / Alt / Shift / Win";
    return;
  }
  stop();
  emit("record", [...mods, key].join("+"));
}
</script>

<template>
  <div class="recorder">
    <button
      type="button"
      class="field"
      :class="{ recording }"
      @click="recording ? stop() : start()"
      @keydown="onKeydown"
      @blur="stop()"
    >
      <template v-if="recording">{{ preview || "請按下組合鍵…（Esc 取消）" }}</template>
      <template v-else-if="props.modelValue">
        <kbd v-for="k in props.modelValue.split('+')" :key="k">{{ k }}</kbd>
      </template>
      <span v-else class="off">未設定</span>
    </button>
    <button v-if="props.modelValue && !recording" type="button" class="ghost" @click="emit('record', '')">清除</button>
  </div>
</template>

<style scoped>
.recorder {
  display: flex;
  gap: 6px;
  align-items: center;
}
.field {
  flex: 1;
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 4px 10px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
  text-align: left;
  outline: none;
}
.field:focus,
.field.recording {
  border-color: var(--accent);
}
.field.recording {
  color: var(--accent);
}
kbd {
  font-family: inherit;
  font-size: 11px;
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--card);
}
.off {
  color: var(--muted);
}
</style>
