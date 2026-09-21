import { useMemo, useState, type CSSProperties } from "react";
import type { Session } from "../models";
import { useStride } from "../state";
import {
  aggregate,
  dayKey,
  formatTime,
  intensity,
  parseDay,
  shiftDay,
  weekStart,
} from "../lib/analytics";
export default function Heatmap({
  sessions,
  onDay,
  title = "Study activity",
  color,
}: {
  sessions: Session[];
  onDay: (day: string) => void;
  title?: string;
  color?: string;
}) {
  const { data, now } = useStride();
  const today = dayKey(new Date(now));
  const [year, setYear] = useState(new Date(now).getFullYear());
  const [selected, setSelected] = useState<string>();
  const [anchor, setAnchor] = useState<{ x: number; y: number }>();
  const [hover, setHover] = useState<string | null>(null);
  const [focusedDay, setFocusedDay] = useState(today);
  const byDay = useMemo(() => {
    const included = new Map(sessions.map((s) => [s.id, s]));
    const result = new Map<
      string,
      { ids: Set<string>; subjects: Map<string, number> }
    >();
    for (const slice of data.slices) {
      const session = included.get(slice.session_id);
      if (!session) continue;
      const entry = result.get(slice.day) ?? {
        ids: new Set<string>(),
        subjects: new Map<string, number>(),
      };
      entry.ids.add(session.id);
      entry.subjects.set(
        session.subject_id,
        (entry.subjects.get(session.subject_id) ?? 0) + slice.seconds,
      );
      result.set(slice.day, entry);
    }
    return result;
  }, [sessions, data.slices]);
  const days = useMemo(
    () => aggregate(sessions, data.slices),
    [sessions, data.slices],
  );
  const start = weekStart(`${year}-01-01`, data.settings.weekStart);
  const end = `${year}-12-31`;
  const cells: string[] = [];
  for (let d = start; d <= end; d = shiftDay(d, 1)) cells.push(d);
  while (cells.length % 7) cells.push(shiftDay(cells.at(-1)!, 1));
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) =>
    cells.slice(i * 7, i * 7 + 7),
  );
  const yearSeconds = [...days].reduce(
    (n, [d, s]) => n + (d.startsWith(String(year)) ? s : 0),
    0,
  );
  const hoverSlices = data.slices.filter(
    (s) => s.day === hover && sessions.some((x) => x.id === s.session_id),
  );
  const hoverSessions = sessions.filter((s) =>
    hoverSlices.some((x) => x.session_id === s.id),
  );
  return (
    <section
      className="heatmap-panel"
      style={{ "--heat-accent": color ?? "var(--accent)" } as CSSProperties}
    >
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          <p>
            {formatTime(yearSeconds)} studied ·{" "}
            {
              [...days].filter(([d, s]) => d.startsWith(String(year)) && s > 0)
                .length
            }{" "}
            active days this year
          </p>
        </div>
        <select
          aria-label="Heatmap year"
          value={year}
          onChange={(e) => {
            setYear(Number(e.target.value));
            setFocusedDay(
              Number(e.target.value) === new Date(now).getFullYear()
                ? today
                : `${e.target.value}-12-31`,
            );
            setHover(null);
          }}
        >
          {Array.from(
            {
              length: Math.max(
                1,
                new Date(now).getFullYear() -
                  Number(
                    data.slices.map((s) => s.day.slice(0, 4)).sort()[0] ??
                      new Date(now).getFullYear(),
                  ) +
                  1,
              ),
            },
            (_, i) => new Date(now).getFullYear() - i,
          ).map((y) => (
            <option key={y}>{y}</option>
          ))}
        </select>
      </div>
      <div
        className="heatmap-scroll"
        onMouseLeave={() => setAnchor(undefined)}
        onScroll={() => setAnchor(undefined)}
      >
        <div className="heatmap">
          <div className="weekday-labels">
            <span />
            {Array.from({ length: 7 }, (_, i) => (
              <small key={i}>
                {i % 2 === 0
                  ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
                      (i + data.settings.weekStart) % 7
                    ]
                  : ""}
              </small>
            ))}
          </div>
          {weeks.map((week, w) => (
            <div className="heatmap-week" key={w}>
              <small>
                {week.find(
                  (d) =>
                    parseDay(d).getDate() === 1 && d.startsWith(String(year)),
                )
                  ? parseDay(
                      week.find(
                        (d) =>
                          parseDay(d).getDate() === 1 &&
                          d.startsWith(String(year)),
                      )!,
                    ).toLocaleDateString(undefined, { month: "short" })
                  : ""}
              </small>
              {week.map((day) => {
                const count = days.get(day) ?? 0;
                const detail = byDay.get(day);
                const tooltip = `${day}\n${formatTime(count)} studied · ${detail?.ids.size ?? 0} sessions\n${[...(detail?.subjects ?? [])].map(([id, seconds]) => `${data.subjects.find((s) => s.id === id)?.name ?? "Subject"} — ${formatTime(seconds)}`).join("\n")}`;
                return (
                  <button
                    key={day}
                    id={`heatmap-${day}`}
                    tabIndex={focusedDay === day ? 0 : -1}
                    disabled={!day.startsWith(String(year)) || day > today}
                    className={`cell level-${intensity(count)} ${day === today ? "today" : ""} ${selected === day ? "selected" : ""}`}
                    aria-label={`${day}: ${formatTime(count)} studied`}
                    aria-pressed={selected === day}
                    onMouseEnter={(e) => {
                      setHover(day);
                      const r = e.currentTarget.getBoundingClientRect();
                      setAnchor({
                        x: Math.min(
                          window.innerWidth - 290,
                          Math.max(12, r.left - 110),
                        ),
                        y: r.bottom + 10,
                      });
                    }}
                    onBlur={() => setAnchor(undefined)}
                    onFocus={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setAnchor({
                        x: Math.min(
                          window.innerWidth - 290,
                          Math.max(12, r.left - 110),
                        ),
                        y: r.bottom + 10,
                      });
                      setHover(day);
                      setFocusedDay(day);
                    }}
                    onKeyDown={(e) => {
                      const delta = {
                        ArrowUp: -1,
                        ArrowDown: 1,
                        ArrowLeft: -7,
                        ArrowRight: 7,
                      }[e.key];
                      if (delta === undefined) return;
                      e.preventDefault();
                      const next = shiftDay(day, delta);
                      if (next.startsWith(String(year)) && next <= today)
                        document.getElementById(`heatmap-${next}`)?.focus();
                    }}
                    onClick={() => {
                      setSelected(day);
                      setAnchor(undefined);
                      onDay(day);
                    }}
                    title={tooltip}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="heatmap-footer">
        <span>Select a day to view sessions. Arrow keys to navigate.</span>
        <div className="legend">
          Less{" "}
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <i key={n} className={`cell level-${n}`} />
          ))}{" "}
          More
        </div>
      </div>
      {anchor && hover && (
        <div
          role="tooltip"
          className="heatmap-tooltip"
          style={{ left: anchor.x, top: anchor.y }}
        >
          <strong>
            {parseDay(hover).toLocaleDateString(undefined, {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </strong>
          <span>
            {formatTime(days.get(hover) ?? 0)} studied · {hoverSessions.length}{" "}
            sessions
          </span>
          {data.subjects
            .filter((s) => hoverSessions.some((x) => x.subject_id === s.id))
            .map((s) => (
              <div className="row" key={s.id}>
                <span>{s.name}</span>
                <strong>
                  {formatTime(
                    hoverSlices
                      .filter((x) =>
                        hoverSessions.some(
                          (h) => h.id === x.session_id && h.subject_id === s.id,
                        ),
                      )
                      .reduce((n, x) => n + x.seconds, 0),
                  )}
                </strong>
              </div>
            ))}
          {!hoverSessions.length && <small>No study time recorded.</small>}
        </div>
      )}
    </section>
  );
}
