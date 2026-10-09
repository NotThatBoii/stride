import type { Running, Segment } from "../models";
// Keep recorded intervals in calendar order. Never shift or discard saved time
// to accommodate a wall-clock rollback.
export function assertTimerOrder(timer: Running): void {
  let end = Date.parse(timer.startedAt);
  for (const segment of timer.segments) {
    if (segment.start < end || segment.end < segment.start)
      throw new Error(
        "This timer contains overlapping time. Your progress is still saved. Export a recovery copy in Settings before discarding it.",
      );
    end = segment.end;
  }
  if (timer.runningSince !== null && timer.runningSince < end)
    throw new Error(
      "Your clock moved backward. Your progress is still saved. Correct the clock or wait until it catches up before resuming, or finish the paused session.",
    );
}

export function resumeTimer(timer: Running, now = Date.now()): Running {
  assertTimerOrder(timer);
  if (!Number.isFinite(new Date(now).getTime()))
    throw new Error("Choose a valid clock time before resuming.");
  const next = { ...timer, runningSince: now };
  assertTimerOrder(next);
  return next;
}

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
