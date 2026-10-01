export const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

const MAC_KEY_LABELS: Record<string, string> = { Super: "⌘", Alt: "⌥", Ctrl: "⌃", Shift: "⇧" };

/** Display label for one accelerator part, using ⌘⌥⌃⇧ on macOS. */
export function keyLabel(part: string): string {
  return isMac ? (MAC_KEY_LABELS[part] ?? part) : part === "Super" ? "Win" : part;
}
