import { describe, expect, it } from "vitest";
import { defaults, type Data } from "../models";
import { isCalendarDate, isStudyTimestamp } from "./calendar-validation";
import { normalizeTimestamp } from "./sync/normalization";
import { parseBackup, validateData } from "./validation";
import { splitSegments } from "./analytics";
import { maximumSessionAllocations } from "./study-limits";

function sample(): Data {
  return {
    subjects: [
      {
        id: "legacy-subject",
        name: "Mathematics",
        description: "",
        color: "#8b91e8",
        icon: "book",
        archived: 0,
        created_at: "2026-09-21T10:00:00.000Z",
      },
    ],
    sessions: [
      {
        id: "legacy-session",
        subject_id: "legacy-subject",
        started_at: "2026-09-21T10:00:00.000Z",
        ended_at: "2026-09-21T10:30:00.000Z",
        duration_seconds: 1800,
        session_title: "Practice",
        notes: "Reviewed examples".padEnd(100, "x"),
        mode: "stopwatch",
        completed: 1,
      },
    ],
    slices: [
      { session_id: "legacy-session", day: "2026-09-21", seconds: 1800 },
    ],
    settings: { ...defaults, onboarded: true },
    running: null,
  };
}

const backup = (data: unknown, exportedAt = "2026-10-06T00:00:00.000Z") =>
  JSON.stringify(
    { format: "stride", version: 1, exportedAt, ...(data as object) },
    null,
    2,
  );

describe("security data validation", () => {
  it("rejects impossible calendar dates while retaining leap days and legacy timezones", () => {
    for (const value of [
      "2026-02-31",
      "2026-04-31",
      "2025-02-29",
      "1900-02-29",
      "2026-00-01",
      "2026-01-00",
    ])
      expect(isCalendarDate(value), value).toBe(false);
    for (const value of [
      "2000-02-29",
      "2024-02-29",
      "2026-01-01",
      "0000-01-01",
    ])
      expect(isCalendarDate(value), value).toBe(true);
    for (const value of [
      "2024-02-29T12:00:00Z",
      "2024-02-29T12:00:00+08:00",
      "2024-02-29T12:00:00",
    ])
      expect(normalizeTimestamp(value)).toBe(new Date(value).toISOString());
    expect(isStudyTimestamp("2026-02-31T12:00:00Z")).toBe(false);
    expect(() => normalizeTimestamp("2026-02-31T12:00:00Z")).toThrow(
      "Invalid study timestamp",
    );
  });

  it("rejects impossible dates in every backup timestamp before import", () => {
    const invalid = "2026-02-31T12:00:00.000Z";
    const data = sample();
    expect(() =>
      validateData({
        ...data,
        subjects: [{ ...data.subjects[0], created_at: invalid }],
      }),
    ).toThrow("Invalid timestamp");
    for (const field of ["started_at", "ended_at"])
      expect(() =>
        validateData({
          ...data,
          sessions: [{ ...data.sessions[0], [field]: invalid }],
        }),
      ).toThrow("Invalid timestamp");
    expect(() =>
      validateData({
        ...data,
        running: {
          id: "active-timer",
          subjectId: data.subjects[0].id,
          startedAt: invalid,
          title: "",
          mode: "stopwatch",
          target: 1500,
          segments: [],
          runningSince: null,
          notified: false,
        },
      }),
    ).toThrow("Invalid timestamp");
    expect(() => parseBackup(backup(data, invalid))).toThrow(
      "Choose a Stride version 1 JSON export",
    );
  });

  it("ignores credential-shaped and prototype fields rather than admitting them into study data", () => {
    const data = sample();
    const source = backup({
      ...data,
      access_token: "negative-fixture-access",
      refresh_token: "negative-fixture-refresh",
      password: "negative-fixture-password",
      subjects: [
        { ...data.subjects[0], access_token: "negative-fixture-access" },
      ],
      settings: { ...data.settings, refresh_token: "negative-fixture-refresh" },
    });
    const hostile = source.replace(
      '"format": "stride",',
      '"format": "stride", "__proto__": {"polluted": true},',
    );
    const parsed = parseBackup(hostile);
    expect(parsed).toEqual(data);
    expect(JSON.stringify(parsed)).not.toContain("negative-fixture");
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("round-trips representative 10,000-session history within the existing file budget", () => {
    const data = sample();
    const template = data.sessions[0];
    data.sessions = Array.from({ length: 10000 }, (_, index) => ({
      ...template,
      id: `release-session-${index}`,
      session_title: `Review ${index}`,
    }));
    data.slices = data.sessions.map((s) => ({
      session_id: s.id,
      day: "2026-09-21",
      seconds: 1800,
    }));
    const exported = backup(data);
    expect(new TextEncoder().encode(exported).byteLength).toBeLessThan(
      25 * 1024 * 1024,
    );
    expect(parseBackup(exported)).toEqual(data);
  });

  it("bounds timer day generation at the existing RPC allocation limit without truncation", () => {
    const start = new Date(2020, 0, 1).getTime();
    const last = new Date(start);
    last.setDate(last.getDate() + maximumSessionAllocations);
    expect(
      splitSegments("bounded", [{ start, end: last.getTime() }]),
    ).toHaveLength(maximumSessionAllocations);
    last.setDate(last.getDate() + 1);
    expect(() =>
      splitSegments("oversized", [{ start, end: last.getTime() }]),
    ).toThrow("more than 1,000 recorded days");
    expect(() => splitSegments("invalid", [{ start, end: 1e308 }])).toThrow(
      "Invalid timer interval",
    );
  });

  it("rejects tiny extreme stopwatch backups before an imported timer can reach day generation", () => {
    const data = sample();
    const start = Date.parse(data.subjects[0].created_at);
    for (const end of [Date.parse("9999-12-31T10:00:00Z"), 1e308]) {
      const text = backup({
        ...data,
        running: {
          id: "malicious-timer",
          subjectId: data.subjects[0].id,
          startedAt: data.subjects[0].created_at,
          title: "",
          mode: "stopwatch",
          target: 1500,
          segments: [{ start, end }],
          runningSince: null,
          notified: false,
        },
      });
      expect(text.length).toBeLessThan(2500);
      // Already stored damaged timer data must remain readable/exportable;
      // the stricter boundary applies before accepting a new imported backup.
      expect(validateData(JSON.parse(text)).running?.segments[0].end).toBe(end);
      expect(() => parseBackup(text)).toThrow();
      expect(data.running).toBeNull();
    }
  });

  it("preserves legitimate multi-day, clock-adjusted and countdown-clipped imported timers", () => {
    const data = sample();
    const start = Date.parse("2026-09-21T10:00:00Z");
    const timer = {
      id: "long-timer",
      subjectId: data.subjects[0].id,
      startedAt: "2026-09-21T10:00:00Z",
      title: "",
      mode: "stopwatch",
      target: 1500,
      segments: [{ start, end: start + 3 * 86400000 }],
      runningSince: null,
      notified: false,
    };
    // A paused interval after the export clock can be legitimate after a clock
    // adjustment. Do not impose a new exportedAt/future-time rejection rule.
    const multiDay = parseBackup(
      backup({ ...data, running: timer }, "2026-09-22T10:00:00Z"),
    );
    expect(multiDay.running?.segments).toEqual(timer.segments);
    const countdown = parseBackup(
      backup({
        ...data,
        running: {
          ...timer,
          mode: "countdown",
          segments: [{ start, end: Date.parse("9999-12-31T10:00:00Z") }],
        },
      }),
    );
    expect(countdown.running?.segments).toEqual([
      { start, end: start + 1500 * 1000 },
    ]);
    expect(countdown.running?.runningSince).toBeNull();
  });
});
