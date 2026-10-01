export interface ValuePoint<T> {
  time: T;
  value: number;
}

/** Simple moving average of `values`; entries before the first full window are skipped. */
export function sma<T>(times: T[], values: number[], period: number): ValuePoint<T>[] {
  const out: ValuePoint<T>[] = [];
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out.push({ time: times[i], value: round(sum / period) });
  }
  return out;
}

function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}

export const MA_PERIODS = [5, 10, 20, 60] as const;
export type MaPeriod = (typeof MA_PERIODS)[number];

export const MA_COLORS: Record<MaPeriod, string> = {
  5: "#f5c542",
  10: "#4fc3f7",
  20: "#ba68c8",
  60: "#ff8a65",
};
