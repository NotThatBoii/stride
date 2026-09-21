import { useState } from "react";
import { Plus, Settings2, Play, ArrowLeft } from "lucide-react";
import { useStride } from "../state";
import { Stat, SubjectCard } from "../components/UI";
import SubjectEditor from "../components/SubjectEditor";
import Heatmap from "../components/Heatmap";
import { SessionList } from "../components/Sessions";
import {
  aggregate,
  dayKey,
  formatTime,
  streaks,
  sumDays,
  weekStart,
} from "../lib/analytics";
export function Subjects({
  onAdd,
  onSubject,
}: {
  onAdd: () => void;
  onSubject: (id: string) => void;
}) {
  const { data } = useStride();
  const [archived, setArchived] = useState(false);
  const subjects = data.subjects.filter((s) => !!s.archived === archived);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">WORKSPACE</span>
          <h1>Subjects</h1>
          <p>Manage your subjects and review their activity.</p>
        </div>
        <button onClick={onAdd}>
          <Plus size={16} /> Add subject
        </button>
      </div>
      <div className="tabs">
        <button
          className={!archived ? "selected" : ""}
          onClick={() => setArchived(false)}
        >
          Active
        </button>
        <button
          className={archived ? "selected" : ""}
          onClick={() => setArchived(true)}
        >
          Archived
        </button>
      </div>
      <div className="subject-grid">
        {subjects.map((s) => (
          <SubjectCard key={s.id} subject={s} onClick={() => onSubject(s.id)} />
        ))}
      </div>
      {!subjects.length && (
        <div className="empty">
          <h2>{archived ? "No archived subjects." : "No subjects yet"}</h2>
          <p>
            {archived
              ? "Archived subjects keep all their study history."
              : "Add your first subject and start building consistency."}
          </p>
          {!archived && <button onClick={onAdd}>Add subject</button>}
        </div>
      )}
    </>
  );
}
export function SubjectDetail({
  id,
  onBack,
  onFocus,
  onDay,
}: {
  id: string;
  onBack: () => void;
  onFocus: (id: string) => void;
  onDay: (d: string) => void;
}) {
  const { data, now } = useStride();
  const [editing, setEditing] = useState(false);
  const subject = data.subjects.find((s) => s.id === id);
  if (!subject)
    return (
      <div className="empty">
        <h2>Subject removed</h2>
        <button onClick={onBack}>Back to subjects</button>
      </div>
    );
  const sessions = data.sessions.filter((s) => s.subject_id === id);
  const days = aggregate(sessions, data.slices);
  const today = dayKey(new Date(now));
  const streak = streaks(days, data.settings.minimum, today);
  const total = sessions.reduce((n, s) => n + s.duration_seconds, 0);
  return (
    <>
      <button className="subtle back" onClick={onBack}>
        <ArrowLeft size={16} /> All subjects
      </button>
      <div className="page-heading">
        <div>
          <span
            className={`eyebrow ${subject.archived ? "archived-caption" : ""}`}
          >
            {subject.archived ? "ARCHIVED SUBJECT" : "YOUR SUBJECT"}
          </span>
          <h1>{subject.name}</h1>
          <p>{subject.description || "Study activity and session history."}</p>
        </div>
        <div className="row gap">
          <button
            className="secondary"
            aria-label="Edit subject"
            onClick={() => setEditing(true)}
          >
            <Settings2 size={17} />
          </button>
          {!subject.archived && (
            <button onClick={() => onFocus(id)}>
              <Play size={16} /> Start session
            </button>
          )}
        </div>
      </div>
      <div className="subject-summary">
        <strong>
          {formatTime(sumDays(days, today.slice(0, 7) + "-01", today))}
        </strong>
        <span>this month</span>
        <span className="summary-divider" />
        <strong>{streak.current}</strong>
        <span>day streak</span>
      </div>
      <Heatmap
        title={`${subject.name} · activity`}
        sessions={sessions}
        onDay={onDay}
        color={subject.color}
      />
      <h2>Study statistics</h2>
      <div className="dashboard-stats">
        <Stat
          label="CURRENT STREAK"
          value={`${streak.current} ${streak.current === 1 ? "day" : "days"}`}
          detail={`Longest: ${streak.longest} ${streak.longest === 1 ? "day" : "days"}`}
        />
        <Stat
          label="TOTAL STUDY TIME"
          value={formatTime(total)}
          detail={`${sessions.length} sessions · ${formatTime(sessions.length ? total / sessions.length : 0)} average`}
        />
        <Stat
          label="THIS WEEK"
          value={formatTime(
            sumDays(days, weekStart(today, data.settings.weekStart), today),
          )}
          detail={`${formatTime(sumDays(days, today.slice(0, 7) + "-01", today))} this month`}
        />
      </div>
      <div className="section-heading">
        <h2>Study history</h2>
      </div>
      <SessionList sessions={sessions} />
      {editing && (
        <SubjectEditor subject={subject} onClose={() => setEditing(false)} />
      )}
    </>
  );
}
