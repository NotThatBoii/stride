import { useState } from "react";
import { Play, Plus, ArrowRight } from "lucide-react";
import { useStride } from "../state";
import {
  aggregate,
  dayKey,
  formatTime,
  streaks,
  sumDays,
  weekStart,
} from "../lib/analytics";
import { SubjectCard } from "../components/UI";
import Heatmap from "../components/Heatmap";
import { SessionList } from "../components/Sessions";
export default function Dashboard({
  onAdd,
  onSubject,
  onFocus,
  onDay,
}: {
  onAdd: () => void;
  onSubject: (id: string) => void;
  onFocus: (id?: string) => void;
  onDay: (day: string) => void;
}) {
  const { data, now } = useStride();
  const today = dayKey(new Date(now));
  const subjects = data.subjects.filter((s) => !s.archived);
  const sessions = data.sessions.filter((s) =>
    subjects.some((x) => x.id === s.subject_id),
  );
  const days = aggregate(sessions, data.slices);
  const streak = streaks(days, data.settings.minimum, today);
  const time = days.get(today) ?? 0;
  const complete = time >= data.settings.minimum * 60;
  const recent = sessions.find((s) =>
    subjects.some((x) => x.id === s.subject_id),
  )?.subject_id;
  const [chosen, setChosen] = useState(recent ?? subjects[0]?.id ?? "");
  const selected = subjects.some((s) => s.id === chosen)
    ? chosen
    : subjects[0]?.id;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Keep your stride.</h1>
          <p>
            {new Date(now).toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
        <span className="page-meta">Overview</span>
      </div>
      <section className="today-overview" aria-label="Today’s study progress">
        <div className="today-primary">
          <span className="eyebrow">Today</span>
          <div className="today-value">
            {Math.floor(time / 60)}{" "}
            <span>
              / {data.settings.goal} <small>min</small>
            </span>
          </div>
          <div className="progress-track">
            <i
              style={{
                width: `${Math.min(100, (time / (data.settings.goal * 60)) * 100)}%`,
              }}
            />
          </div>
          <p>
            {complete
              ? "✓ Minimum Day complete"
              : `${Math.max(0, Math.ceil(data.settings.minimum - time / 60))} min to your Minimum Day`}
          </p>
        </div>
        <div className="streak-summary">
          <span className="eyebrow">Consistency</span>
          <strong>
            {streak.current} <span>day streak</span>
          </strong>
          <p>Longest: {streak.longest} days</p>
          <span className="week-summary">
            {formatTime(
              sumDays(days, weekStart(today, data.settings.weekStart), today),
            )}{" "}
            this week
          </span>
        </div>
        <div className="quick-start">
          <span className="eyebrow">Next session</span>
          {subjects.length ? (
            <>
              <select
                aria-label="Quick start subject"
                value={selected}
                onChange={(e) => setChosen(e.target.value)}
              >
                {subjects.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button onClick={() => onFocus(selected)}>
                <Play size={14} />
                {data.running ? "Return to session" : "Start session"}
              </button>
            </>
          ) : (
            <>
              <p>Add a subject to start tracking.</p>
              <button onClick={onAdd}>
                <Plus size={14} /> Add subject
              </button>
            </>
          )}
        </div>
      </section>
      <Heatmap sessions={sessions} onDay={onDay} />
      <div className="section-heading">
        <h2>
          Subjects <span className="count">{subjects.length}</span>
        </h2>
        <button className="subtle" onClick={onAdd}>
          <Plus size={14} /> Add subject
        </button>
      </div>
      {subjects.length ? (
        <div className="subject-grid">
          {subjects.map((s) => (
            <SubjectCard
              key={s.id}
              subject={s}
              onClick={() => onSubject(s.id)}
            />
          ))}
        </div>
      ) : (
        <div className="empty">
          <h2>No subjects yet</h2>
          <p>Add a subject to organize your study sessions.</p>
          <button className="secondary" onClick={onAdd}>
            Add your first subject <ArrowRight size={14} />
          </button>
        </div>
      )}
      <div className="section-heading">
        <h2>Recent activity</h2>
        <span className="page-meta">Last 4 sessions</span>
      </div>
      <SessionList
        sessions={sessions
          .slice()
          .sort((a, b) => b.started_at.localeCompare(a.started_at))
          .slice(0, 4)}
      />
    </>
  );
}
