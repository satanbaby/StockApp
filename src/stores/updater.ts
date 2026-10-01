import { defineStore } from "pinia";
import { ref, shallowRef } from "vue";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const CHECK_INTERVAL_MS = 6 * 3600_000;
const FIRST_CHECK_DELAY_MS = 10_000;

export type UpdateState = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "error";

/**
 * In-app updates from GitHub Releases (latest.json produced by the release workflow).
 * Checks shortly after startup and every 6 hours; installing restarts the app.
 */
export const useUpdaterStore = defineStore("updater", () => {
  const currentVersion = ref("");
  const state = ref<UpdateState>("idle");
  const available = shallowRef<Update | null>(null);
  const progress = ref(0);
  const error = ref<string | null>(null);
  /** User clicked "稍後" for this version; hide the banner until the next version. */
  const dismissedVersion = ref<string | null>(null);

  async function init() {
    currentVersion.value = await getVersion();
    setTimeout(() => void checkNow(false), FIRST_CHECK_DELAY_MS);
    setInterval(() => void checkNow(false), CHECK_INTERVAL_MS);
  }

  /** `manual` checks surface errors and "already latest"; background ones stay quiet. */
  async function checkNow(manual = true) {
    if (state.value === "checking" || state.value === "downloading") return;
    state.value = "checking";
    error.value = null;
    try {
      const update = await check();
      available.value = update;
      state.value = update ? "available" : "up-to-date";
      if (manual && update) dismissedVersion.value = null;
    } catch (e) {
      available.value = null;
      state.value = manual ? "error" : "idle";
      error.value = manual ? `檢查更新失敗：${e}` : null;
    }
  }

  async function install() {
    const update = available.value;
    if (!update || state.value === "downloading") return;
    state.value = "downloading";
    progress.value = 0;
    let total = 0;
    let received = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        else if (event.event === "Progress") {
          received += event.data.chunkLength;
          if (total) progress.value = Math.min(100, Math.round((received / total) * 100));
        }
      });
      // On Windows the installer usually closes the app itself; relaunch covers the rest.
      await relaunch();
    } catch (e) {
      state.value = "error";
      error.value = `更新失敗：${e}`;
    }
  }

  function dismiss() {
    dismissedVersion.value = available.value?.version ?? null;
  }

  return { currentVersion, state, available, progress, error, dismissedVersion, init, checkNow, install, dismiss };
});
