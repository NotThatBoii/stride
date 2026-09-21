import { describe, it, expect } from "vitest";
import {
  aggregate,
  dayKey,
  shiftDay,
  splitSegments,
  streaks,
  weekStart,
  intensity,
} from "./analytics";
import { activeSegments, elapsed } from "./timer";
import type { Running, Session } from "../models";
const session = (id: string, subject = "math"): Session => ({
  id,
  subject_id: subject,
  started_at: "2026-09-21T00:00:00Z",
  ended_at: "2026-09-21T01:00:00Z",
  duration_seconds: 3600,
  session_title: "",
  notes: "",
  mode: "stopwatch",
  completed: 1,
});
describe("local calendar accounting", () => {
  it("splits at local midnight and excludes a pause", () => {
    const slices = splitSegments("a", [
      {
        start: new Date(2026, 8, 20, 23, 50).getTime(),
        end: new Date(2026, 8, 21, 0, 10).getTime(),
      },
      {
        start: new Date(2026, 8, 21, 0, 30).getTime(),
        end: new Date(2026, 8, 21, 0, 40).getTime(),
      },
    ]);
    expect(slices).toEqual([
      { session_id: "a", day: "2026-09-20", seconds: 600 },
      { session_id: "a", day: "2026-09-21", seconds: 1200 },
    ]);
  });
  it("handles calendar transitions", () => {
    expect(shiftDay("2024-03-01", -1)).toBe("2024-02-29");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(weekStart("2026-09-20", 1)).toBe("2026-09-14");
    expect(weekStart("2026-09-20", 0)).toBe("2026-09-20");
  });
  it("preserves fractions until totals are displayed", () =>
    expect(
      splitSegments("a", [
        { start: 1000, end: 1500 },
        { start: 2500, end: 3000 },
      ])[0].seconds,
    ).toBe(1));
  it("counts actual wall time over DST boundaries", () => {
    const start = new Date(2026, 2, 8, 0).getTime(),
      end = new Date(2026, 2, 9, 0).getTime();
    expect(splitSegments("a", [{ start, end }])[0]).toEqual({
      session_id: "a",
      day: dayKey(new Date(start)),
      seconds: (end - start) / 1000,
    });
  });
});
describe("derived streaks", () => {
  it("allows an incomplete today and resets after a missed day", () => {
    const days = new Map([
      ["2026-09-19", 1200],
      ["2026-09-20", 1200],
      ["2026-09-21", 1199],
    ]);
    expect(streaks(days, 20, "2026-09-21")).toEqual({ current: 2, longest: 2 });
    expect(streaks(days, 20, "2026-09-22")).toEqual({ current: 0, longest: 2 });
  });
  it("combines subjects overall but not for individual streaks", () => {
    const sessions = [session("a"), session("b", "java")];
    const slices = [
      { session_id: "a", day: "2026-09-21", seconds: 600 },
      { session_id: "b", day: "2026-09-21", seconds: 600 },
    ];
    expect(streaks(aggregate(sessions, slices), 20, "2026-09-21").current).toBe(
      1,
    );
    expect(
      streaks(aggregate([sessions[0]], slices), 20, "2026-09-21").current,
    ).toBe(0);
    expect(aggregate([], slices).size).toBe(0);
  });
  it("recalculates longest streak after deleting a middle day", () => {
    const days = new Map([
      ["2026-09-18", 1200],
      ["2026-09-19", 1200],
      ["2026-09-20", 1200],
      ["2026-09-21", 1200],
    ]);
    days.delete("2026-09-19");
    expect(streaks(days, 20, "2026-09-21")).toEqual({ current: 2, longest: 2 });
    expect(streaks(days, 21, "2026-09-21")).toEqual({ current: 0, longest: 0 });
  });
  it("never counts a future day", () =>
    expect(streaks(new Map([["2026-09-22", 1200]]), 20, "2026-09-21")).toEqual({
      current: 0,
      longest: 0,
    }));
  it("uses meaningful intensity boundaries", () =>
    expect([0, 1, 1199, 1200, 2700, 5400, 9000].map(intensity)).toEqual([
      0, 1, 1, 2, 3, 4, 5,
    ]));
});
describe("recoverable timers", () => {
  const timer: Running = {
    id: "t",
    subjectId: "s",
    startedAt: new Date(0).toISOString(),
    title: "",
    mode: "countdown",
    target: 60,
    segments: [{ start: 0, end: 10000 }],
    runningSince: 30000,
    notified: false,
  };
  it("caps recovered countdowns at their target", () => {
    expect(elapsed(timer, 999999)).toBe(60);
    expect(activeSegments(timer, 999999)).toEqual([
      { start: 0, end: 10000 },
      { start: 30000, end: 80000 },
    ]);
  });
  it("excludes time spent paused", () =>
    expect(elapsed({ ...timer, runningSince: null }, 999999)).toBe(10));
  it("restores stopwatch using wall time, independent of ticks", () =>
    expect(elapsed({ ...timer, mode: "stopwatch" }, 90000)).toBe(70));
  it("does not subtract time when the clock moves backward", () =>
    expect(elapsed(timer, 20000)).toBe(10));
});
