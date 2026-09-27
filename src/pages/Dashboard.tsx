import { useState } from "react";
import {
  Play,
  Plus,
  ArrowRight,
  BookOpen,
  Flame,
  CalendarDays,
  Clock3,
} from "lucide-react";
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
import { StudyArtwork } from "../components/Artwork";
import Heatmap from "../components/Heatmap";

export default function Dashboard({
  onAdd,
  onSubject,
  onFocus,
  onDay,
  onHistory,
}: {
  onAdd: () => void;
  onSubject: (id: string) => void;
  onFocus: (id?: string) => void;
  onDay: (day: string) => void;
  onHistory: () => void;
}) {
  const { data, now } = useStride();
  const today = dayKey(new Date(now));
  const subjects = data.subjects.filter((s) => !s.archived);
  const sessions = data.sessions
    .filter((s) => subjects.some((x) => x.id === s.subject_id))
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
  const days = aggregate(sessions, data.slices);
  const streak = streaks(days, data.settings.minimum, today);
  const time = days.get(today) ?? 0;
  const [chosen, setChosen] = useState(
    sessions[0]?.subject_id ?? subjects[0]?.id ?? "",
  );
  const selected = subjects.find((s) => s.id === chosen) ?? subjects[0];
  const progress = Math.min(1, time / (data.settings.goal * 60));
  return (
    <div className="dashboard-layout">
      <div className="dashboard-main">
        <div className="page-heading dashboard-heading">
          <div>
            <h1>
              Keep your <span>stride.</span>
            </h1>
            <p>
              {new Date(now).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
          <blockquote>
            A more focused you,
            <br />
            one day at a time.
          </blockquote>
        </div>
        <section className="today-overview" aria-label="Today’s study progress">
          <div className="today-primary">
            <div
              className="daily-ring"
              role="img"
              aria-label={`${Math.round(progress * 100)}% of daily study goal`}
            >
              <svg viewBox="0 0 120 120" aria-hidden="true">
                <circle className="ring-track" cx="60" cy="60" r="51" />
                <circle
                  className="ring-value"
                  cx="60"
                  cy="60"
                  r="51"
                  pathLength="100"
                  strokeDasharray={`${progress * 100} 100`}
                />
              </svg>
              <span>
                <BookOpen size={25} />
              </span>
            </div>
            <div>
              <span className="eyebrow">Today</span>
              <div className="today-value">
                {Math.floor(time / 60)}{" "}
                <span>
                  / {data.settings.goal} <small>min</small>
                </span>
              </div>
              <p>
                {time >= data.settings.minimum * 60
                  ? "✓ Minimum Day complete"
                  : `${Math.max(0, Math.ceil(data.settings.minimum - time / 60))} min to your Minimum Day`}
              </p>
            </div>
          </div>
          <div className="streak-summary">
            <Flame className="flame-icon" size={27} />
            <div>
              <span className="eyebrow">Current streak</span>
              <strong>
                {streak.current}{" "}
                <span>{streak.current === 1 ? "day" : "days"}</span>
              </strong>
              <p>Longest: {streak.longest} days</p>
              <span className="week-summary">
                {formatTime(
                  sumDays(
                    days,
                    weekStart(today, data.settings.weekStart),
                    today,
                  ),
                )}{" "}
                this week
              </span>
            </div>
          </div>
          <div className="quick-start">
            <div className="continue-label">
              <span className="book-tile">
                <BookOpen size={25} />
              </span>
              <div>
                <span>Continue studying</span>
                <p>
                  {selected
                    ? selected.name
                    : "Add a subject to start tracking your study sessions."}
                </p>
              </div>
            </div>
            {selected ? (
              <div className="start-controls">
                <button onClick={() => onFocus(selected.id)}>
                  <Play size={15} fill="currentColor" />
                  {data.running ? "Return to session" : "Start session"}
                </button>
                <select
                  aria-label="Quick start subject"
                  value={selected.id}
                  onChange={(e) => setChosen(e.target.value)}
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <button onClick={onAdd}>
                <Plus size={16} />
                Add subject
              </button>
            )}
          </div>
        </section>
        <Heatmap sessions={sessions} onDay={onDay} />
        <div className="section-heading">
          <h2>
            Subjects <span className="count">{subjects.length}</span>
          </h2>
          <button className="subtle" onClick={onAdd}>
            <Plus size={15} />
            Add subject
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
      </div>
      <aside className="dashboard-rail" aria-label="Session overview">
        <section className="rail-card next-session">
          <h2>
            <CalendarDays size={19} />
            Next session
          </h2>
          <StudyArtwork />
          <p>
            {selected ? (
              <>
                A little progress in <strong>{selected.name}</strong>.<br />
                Pick up where you left off.
              </>
            ) : (
              <>
                Add a subject to start tracking
                <br />
                your study sessions.
              </>
            )}
          </p>
          <button onClick={selected ? () => onFocus(selected.id) : onAdd}>
            {selected ? (
              <Play size={16} fill="currentColor" />
            ) : (
              <Plus size={19} />
            )}
            {selected
              ? data.running
                ? "Continue session"
                : "Let’s focus"
              : "Add subject"}
          </button>
        </section>
        <section className="rail-card recent-sessions">
          <div className="section-heading">
            <h2>
              <Clock3 size={19} />
              Recent sessions
            </h2>
            <button className="subtle" onClick={onHistory}>
              View all <ArrowRight size={14} />
            </button>
          </div>
          {sessions.slice(0, 4).map((s) => {
            const subject = subjects.find((x) => x.id === s.subject_id)!;
            return (
              <button
                className="recent-session"
                key={s.id}
                onClick={() => onDay(dayKey(new Date(s.started_at)))}
              >
                <i
                  className="subject-dot"
                  style={{ background: subject.color }}
                />
                <span>
                  <strong>{subject.name}</strong>
                  <small>
                    {new Date(s.started_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                    ,{" "}
                    {new Date(s.started_at).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </small>
                </span>
                <time>{formatTime(s.duration_seconds)}</time>
              </button>
            );
          })}
          {!sessions.length && (
            <div className="empty compact">
              <Clock3 size={25} />
              <h3>Your next chapter starts here.</h3>
              <p>
                Completed sessions will appear here.
                <br />
                One session at a time.
              </p>
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}
