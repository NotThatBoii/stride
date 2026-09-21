import type { Running, Segment } from "../models";
export function activeSegments(timer: Running, now = Date.now()): Segment[] {
  const segments = [...timer.segments];
  if (timer.runningSince !== null)
    segments.push({
      start: timer.runningSince,
      end: Math.max(timer.runningSince, now),
    });
  if (timer.mode === "stopwatch") return segments;
  let left = timer.target * 1000;
  return segments
    .map((s) => {
      const duration = Math.min(left, s.end - s.start);
      left -= duration;
      return { start: s.start, end: s.start + duration };
    })
    .filter((s) => s.end > s.start);
}
export const elapsed = (timer: Running, now = Date.now()) =>
  activeSegments(timer, now).reduce((n, s) => n + (s.end - s.start) / 1000, 0);
