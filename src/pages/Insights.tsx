import { useStride } from "../state";
import {
  aggregate,
  dayKey,
  formatTime,
  parseDay,
  shiftDay,
  streaks,
  sumDays,
  weekStart,
} from "../lib/analytics";
import { Stat } from "../components/UI";
export default function Insights() {
  const { data, now } = useStride();
  const today = dayKey(new Date(now));
  const sessions = data.sessions.filter((s) =>
    data.subjects.some((x) => !x.archived && x.id === s.subject_id),
  );
  const days = aggregate(sessions, data.slices);
  const start = weekStart(today, data.settings.weekStart);
  const week = sumDays(days, start, shiftDay(start, 6));
  const previous = sumDays(days, shiftDay(start, -7), shiftDay(start, -1));
  const total = sessions.reduce((n, s) => n + s.duration_seconds, 0);
  const streak = streaks(days, data.settings.minimum, today);
  const distribution = data.subjects
    .filter((s) => !s.archived)
    .map((s) => ({
      ...s,
      seconds: sessions
        .filter((x) => x.subject_id === s.id)
        .reduce((n, x) => n + x.duration_seconds, 0),
    }))
    .sort((a, b) => b.seconds - a.seconds);
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    [...days]
      .filter(([d]) => parseDay(d).getDay() === i)
      .reduce((n, [, s]) => n + s, 0),
  );
  const productive = weekdays.indexOf(Math.max(...weekdays));
  const bars = Array.from({ length: 7 }, (_, i) => ({
    label: parseDay(shiftDay(start, i)).toLocaleDateString(undefined, {
      weekday: "short",
    }),
    seconds: days.get(shiftDay(start, i)) ?? 0,
  }));
  const trend = Array.from({ length: 8 }, (_, i) => {
    const d = shiftDay(start, (i - 7) * 7);
    return {
      label: parseDay(d).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
      seconds: sumDays(days, d, shiftDay(d, 6)),
    };
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ANALYTICS</span>
          <h1>Insights</h1>
          <p>Useful patterns from your active subjects.</p>
        </div>
        <span className="pill">All-time insights</span>
      </div>
      <div className="dashboard-stats">
        <Stat
          label="THIS WEEK"
          value={formatTime(week)}
          detail={
            previous
              ? `${Math.round(((week - previous) / previous) * 100)}% vs last week (${formatTime(previous)})`
              : `Last week: ${formatTime(previous)}`
          }
        />
        <Stat
          label="THIS MONTH"
          value={formatTime(sumDays(days, today.slice(0, 7) + "-01", today))}
          detail={`${formatTime(sumDays(days, today.slice(0, 7) + "-01", today) / new Date(now).getDate())} per calendar day this month`}
        />
        <Stat
          label="TOTAL SESSIONS"
          value={sessions.length}
          detail={`${formatTime(sessions.length ? total / sessions.length : 0)} average session`}
        />
      </div>
      <div className="insight-grid">
        <section className="panel">
          <h2>This week’s rhythm</h2>
          <p className="muted">Study time by day</p>
          <Bars values={bars} />
        </section>
        <section className="panel">
          <h2>Where your time goes</h2>
          <p className="muted">All-time subject distribution</p>
          <div className="distribution">
            {distribution.map((s) => (
              <div key={s.id}>
                <div className="row">
                  <span>{s.name}</span>
                  <strong>{formatTime(s.seconds)}</strong>
                </div>
                <div className="progress-track">
                  <i
                    style={{
                      width: `${total ? (s.seconds / total) * 100 : 0}%`,
                      background: s.color,
                    }}
                  />
                </div>
              </div>
            ))}
            {!total && <p className="hint">No study time recorded yet.</p>}
          </div>
        </section>
      </div>
      <section className="panel">
        <h2>Consistency over time</h2>
        <p className="muted">Weekly study time · last 8 weeks</p>
        <Bars values={trend} />
      </section>
      <div className="insight-facts">
        <Stat
          label="MOST STUDIED"
          value={distribution[0]?.seconds ? distribution[0].name : "—"}
        />
        <Stat
          label="LONGEST SESSION"
          value={formatTime(
            Math.max(0, ...sessions.map((s) => s.duration_seconds)),
          )}
        />
        <Stat
          label="MOST PRODUCTIVE DAY"
          value={
            total
              ? [
                  "Sunday",
                  "Monday",
                  "Tuesday",
                  "Wednesday",
                  "Thursday",
                  "Friday",
                  "Saturday",
                ][productive]
              : "—"
          }
        />
        <Stat
          label="YOUR STREAK"
          value={`${streak.current} days`}
          detail={`${streak.longest} days personal best`}
        />
      </div>
    </>
  );
}
function Bars({ values }: { values: { label: string; seconds: number }[] }) {
  const max = Math.max(1, ...values.map((v) => v.seconds));
  return (
    <div
      className="bars"
      role="img"
      aria-label={values
        .map((v) => `${v.label}: ${formatTime(v.seconds)}`)
        .join(", ")}
    >
      {values.map((v) => (
        <div className="bar-column" key={v.label}>
          <span>{formatTime(v.seconds)}</span>
          <div className="bar-track">
            <i
              style={{
                height: `${Math.max(v.seconds ? 2 : 0, (v.seconds / max) * 100)}%`,
              }}
            />
          </div>
          <small>{v.label}</small>
        </div>
      ))}
    </div>
  );
}
