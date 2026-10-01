import { describe, expect, it } from "vitest";
import { sma } from "../src/indicators/ma";

describe("sma", () => {
  it("averages each full window and skips warm-up entries", () => {
    const times = ["d1", "d2", "d3", "d4", "d5"];
    expect(sma(times, [1, 2, 3, 4, 5], 3)).toEqual([
      { time: "d3", value: 2 },
      { time: "d4", value: 3 },
      { time: "d5", value: 4 },
    ]);
  });

  it("returns nothing when there is less data than the period", () => {
    expect(sma(["a", "b"], [1, 2], 5)).toEqual([]);
  });
});
