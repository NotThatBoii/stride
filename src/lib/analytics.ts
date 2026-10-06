import type { Segment, Session, Slice } from "../models";
import { isCalendarDate } from "./calendar-validation";
import { maximumSessionAllocations } from "./study-limits";
export const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const parseDay = (key: string) => new Date(`${key}T12:00:00`);
export function shiftDay(key: string, delta: number) {
  const d = parseDay(key);
  d.setDate(d.getDate() + delta);
  return dayKey(d);
}
export function weekStart(key: string, start = 1) {
  const weekday = parseDay(key).getDay();
  return shiftDay(key, -((weekday - start + 7) % 7));
}
export const formatTime = (seconds: number) =>
  seconds < 60
    ? `${Math.floor(seconds)}s`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m`
      : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
export const intensity = (seconds: number) =>
  seconds <= 0
    ? 0
    : seconds < 1200
      ? 1
      : seconds < 2700
        ? 2
        : seconds < 5400
          ? 3
          : seconds < 9000
            ? 4
            : 5;
// Split only active timer intervals at LOCAL midnight. Calendar arithmetic handles DST.
// Store each historical local day so later timezone changes do not rewrite history.
export function splitSegments(id: string, segments: Segment[]): Slice[] {
  const days = new Map<string, number>();
  for (const segment of segments) {
    if (
      !Number.isFinite(segment.start) ||
      !Number.isFinite(segment.end) ||
      !Number.isFinite(new Date(segment.start).getTime()) ||
      !Number.isFinite(new Date(segment.end).getTime()) ||
      segment.end < segment.start
    )
      throw new Error("Invalid timer interval. Its stored copy is preserved.");
    let cursor = segment.start;
    while (cursor < segment.end) {
      const date = new Date(cursor);
      const midnight = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate() + 1,
      ).getTime();
      const end = Math.min(midnight, segment.end);
      const key = dayKey(date);
      if (!Number.isFinite(end) || end <= cursor || !isCalendarDate(key))
        throw new Error(
          "Invalid timer interval. Its stored copy is preserved.",
        );
      if (!days.has(key) && days.size >= maximumSessionAllocations)
        throw new Error(
          "This timer spans more than 1,000 recorded days. Its stored copy and your backup are preserved; it cannot be saved as one session.",
        );
      days.set(key, (days.get(key) ?? 0) + (end - cursor) / 1000);
      cursor = end;
    }
  }
  return [...days].map(([day, seconds]) => ({ session_id: id, day, seconds }));
}
export function aggregate(sessions: Session[], slices: Slice[]) {
  const ids = new Set(sessions.filter((s) => s.completed).map((s) => s.id));
  const days = new Map<string, number>();
  for (const slice of slices)
    if (ids.has(slice.session_id))
      days.set(slice.day, (days.get(slice.day) ?? 0) + slice.seconds);
  return days;
}
export function streaks(
  days: Map<string, number>,
  minimum: number,
  today = dayKey(new Date()),
) {
  const eligible = [...days]
    .filter(([day, seconds]) => seconds >= minimum * 60 && day <= today)
    .map(([day]) => day)
    .sort();
  let longest = 0,
    run = 0,
    previous = "";
  for (const day of eligible) {
    run = previous && shiftDay(previous, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }
  // An unfinished today does not break yesterday's streak until midnight.
  let cursor =
    (days.get(today) ?? 0) >= minimum * 60 ? today : shiftDay(today, -1);
  let current = 0;
  while ((days.get(cursor) ?? 0) >= minimum * 60) {
    current++;
    cursor = shiftDay(cursor, -1);
  }
  return { current, longest };
}
export const sumDays = (days: Map<string, number>, from: string, to: string) =>
  [...days].reduce((n, [d, s]) => n + (d >= from && d <= to ? s : 0), 0);
