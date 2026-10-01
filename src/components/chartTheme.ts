import { ColorType, CrosshairMode, type ChartOptions, type DeepPartial } from "lightweight-charts";

export type ChartTheme = "light" | "dark";

export interface ChartColors {
  up: string;
  down: string;
  upFill: string;
  downFill: string;
  text: string;
  grid: string;
}

const PALETTE: Record<ChartTheme, ChartColors> = {
  dark: {
    up: "#f04747",
    down: "#2fb35a",
    upFill: "rgba(240, 71, 71, 0.28)",
    downFill: "rgba(47, 179, 90, 0.28)",
    text: "#8b93a1",
    grid: "rgba(255,255,255,0.05)",
  },
  light: {
    up: "#d32f2f",
    down: "#1b873f",
    upFill: "rgba(211, 47, 47, 0.18)",
    downFill: "rgba(27, 135, 63, 0.18)",
    text: "#6b7482",
    grid: "rgba(0,0,0,0.06)",
  },
};

export function chartColors(theme: ChartTheme): ChartColors {
  return PALETTE[theme];
}

/** Theme-dependent part of the chart options; safe to pass to `applyOptions` on theme change. */
export function themedChartOptions(theme: ChartTheme): DeepPartial<ChartOptions> {
  const c = PALETTE[theme];
  return {
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: c.text,
      fontSize: 10,
      attributionLogo: false,
    },
    grid: {
      vertLines: { visible: false },
      horzLines: { color: c.grid },
    },
  };
}

export function baseChartOptions(theme: ChartTheme): DeepPartial<ChartOptions> {
  return {
    ...themedChartOptions(theme),
    autoSize: true,
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
    crosshair: { mode: CrosshairMode.Magnet },
    handleScroll: false,
    handleScale: false,
  };
}
