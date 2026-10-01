/**
 * In-memory cache keyed by string, entries valid for the current Taipei
 * trading date only (historical candles do not change within a day).
 */
export class DailyCache<T> {
  private entries = new Map<string, { day: string; value: Promise<T> }>();

  get(key: string, load: () => Promise<T>): Promise<T> {
    const day = taipeiDate();
    const hit = this.entries.get(key);
    if (hit && hit.day === day) return hit.value;
    const value = load();
    this.entries.set(key, { day, value });
    // Do not cache failures.
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    return value;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

const TAIPEI_OFFSET_MS = 8 * 3600_000;

/** `yyyy-MM-dd` in Asia/Taipei. */
export function taipeiDate(date: Date = new Date()): string {
  return new Date(date.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
