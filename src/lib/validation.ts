import { z } from "zod";
import type { Data } from "../models";
import { activeSegments } from "./timer";
import { isCalendarDate, isStudyTimestamp } from "./calendar-validation";
import { splitSegments } from "./analytics";
const id = z.string().min(1).max(200);
const timestamp = z.string().refine(isStudyTimestamp, "Invalid timestamp");
const flag = z.union([z.literal(0), z.literal(1)]);
const mode = z.enum(["stopwatch", "countdown"]);
const subject = z.object({
  id,
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500),
  icon: z.string().max(20),
  color: z.string().regex(/^#[\da-fA-F]{6}$/),
  created_at: timestamp,
  archived: flag,
});
const session = z.object({
  id,
  subject_id: id,
  started_at: timestamp,
  ended_at: timestamp,
  duration_seconds: z.number().finite().positive(),
  session_title: z.string().max(160),
  notes: z.string().max(4000),
  mode,
  completed: z.literal(1),
});
const settings = z.object({
  minimum: z.number().int().min(1).max(1440),
  goal: z.number().int().min(1).max(1440),
  presets: z.string().refine((s) => {
    const n = s.split(",").map(Number);
    return (
      n.length <= 6 &&
      n.length > 0 &&
      new Set(n).size === n.length &&
      n.every((x) => Number.isInteger(x) && x >= 1 && x <= 1440)
    );
  }),
  weekStart: z.union([z.literal(0), z.literal(1)]),
  theme: z.enum(["dark", "light"]),
  notifications: z.boolean(),
  onboarded: z.boolean(),
});
const timerTimestamp = z.number().finite().nonnegative();
const segment = z
  .object({
    start: timerTimestamp,
    end: timerTimestamp,
  })
  .refine((s) => s.end >= s.start);
const running = z.object({
  id,
  subjectId: id,
  startedAt: timestamp,
  title: z.string().max(160),
  mode,
  target: z.number().finite().min(60).max(86400),
  segments: z.array(segment).max(100000),
  runningSince: timerTimestamp.nullable(),
  notified: z.boolean(),
});
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate);
const schema = z.object({
  subjects: z.array(subject).max(10000),
  sessions: z.array(session).max(100000),
  slices: z
    .array(
      z.object({
        session_id: id,
        day,
        seconds: z.number().finite().nonnegative(),
      }),
    )
    .max(300000),
  settings,
  running: running.nullable(),
});
export function validateData(value: unknown): Data {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new Error(
      "Invalid Stride data: " +
        result.error.issues[0].path.join(".") +
        " — " +
        result.error.issues[0].message,
    );
  const data = result.data;
  const subjects = new Set(data.subjects.map((s) => s.id)),
    sessions = new Map(data.sessions.map((s) => [s.id, s]));
  if (
    subjects.size !== data.subjects.length ||
    sessions.size !== data.sessions.length
  )
    throw new Error("Duplicate record IDs.");
  const totals = new Map<string, number>(),
    keys = new Set<string>();
  for (const s of data.slices) {
    const key = JSON.stringify([s.session_id, s.day]);
    if (!sessions.has(s.session_id) || keys.has(key))
      throw new Error("Invalid or duplicate daily allocation.");
    keys.add(key);
    totals.set(s.session_id, (totals.get(s.session_id) ?? 0) + s.seconds);
  }
  for (const s of data.sessions) {
    if (
      !subjects.has(s.subject_id) ||
      Date.parse(s.ended_at) < Date.parse(s.started_at) ||
      s.duration_seconds >
        (Date.parse(s.ended_at) - Date.parse(s.started_at)) / 1000 + 0.01 ||
      Math.abs((totals.get(s.id) ?? 0) - s.duration_seconds) > 0.01
    )
      throw new Error(
        "Session dates, subject, or daily totals are inconsistent.",
      );
  }
  if (data.running) {
    const t = data.running;
    const owner = data.subjects.find((s) => s.id === t.subjectId);
    if (!owner || owner.archived || sessions.has(t.id))
      throw new Error("Invalid active timer.");
    let end = Date.parse(t.startedAt);
    for (const interval of t.segments) {
      if (interval.start < end) throw new Error("Overlapping timer intervals.");
      end = interval.end;
    }
    if (t.runningSince !== null && t.runningSince < end)
      throw new Error("Invalid running timer interval.");
  }
  return data;
}
export function parseBackup(text: string): Data {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(
      "This file is not valid JSON. Choose a Stride JSON export and try again.",
    );
  }
  const envelope = z
    .object({
      format: z.literal("stride"),
      version: z.literal(1),
      exportedAt: timestamp,
    })
    .safeParse(value);
  if (!envelope.success)
    throw new Error("Choose a Stride version 1 JSON export.");
  const data = validateData(value);
  // Restore paused at export time, never invent study time since the backup.
  if (data.running) {
    const at = Date.parse(envelope.data.exportedAt);
    if (at < Date.parse(data.running.startedAt))
      throw new Error("Export predates its active timer.");
    const timestamps = data.running.segments.flatMap(({ start, end }) => [
      start,
      end,
    ]);
    if (data.running.runningSince !== null)
      timestamps.push(data.running.runningSince);
    if (timestamps.some((value) => !Number.isFinite(new Date(value).getTime())))
      throw new Error(
        "Invalid timer timestamp. Your backup file is unchanged.",
      );
    data.running = {
      ...data.running,
      segments: activeSegments(data.running, at),
      runningSince: null,
    };
    // Validate the effective paused timer, including countdown clipping, before
    // admitting a backup. The same bounded partition is used when saving a
    // session; a tiny malicious interval must not generate millions of days.
    splitSegments(data.running.id, data.running.segments);
  }
  return validateData(data);
}
