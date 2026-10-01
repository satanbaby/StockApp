import { load, type Store } from "@tauri-apps/plugin-store";
import type { MaPeriod } from "../indicators/ma";
import { isMac } from "../utils/platform";

export type ThemeSetting = "system" | "light" | "dark";

export interface AppSettings {
  apiKey: string;
  pinned: string[];
  alwaysOnTop: boolean;
  maVisible: Record<MaPeriod, boolean>;
  /** Global hotkey that toggles the panel; empty string = disabled. */
  shortcut: string;
  theme: ThemeSetting;
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: "",
  pinned: [],
  alwaysOnTop: false,
  maVisible: { 5: true, 10: true, 20: true, 60: false },
  shortcut: isMac ? "Super+Alt+S" : "Ctrl+Alt+S",
  theme: "system",
};

let storePromise: Promise<Store> | null = null;

function store(): Promise<Store> {
  storePromise ??= load("settings.json", { defaults: {}, autoSave: 200 });
  return storePromise;
}

export async function loadSettings(): Promise<AppSettings> {
  const s = await store();
  const result = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
    const v = await s.get(key);
    if (v !== undefined && v !== null) (result as any)[key] = v;
  }
  result.maVisible = { ...DEFAULT_SETTINGS.maVisible, ...result.maVisible };
  result.pinned = Array.isArray(result.pinned) ? result.pinned.slice(0, 4) : [];
  return result;
}

export async function saveSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
  const s = await store();
  await s.set(key, value);
}
